const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const rpc = @import("protocol.zig");
const command = @import("command_line.zig");
const InputPump = @import("input-pump.zig").InputPump;

const a = rpc.allocator;
pub const max_provider_chunk = 16 * 1024;
pub const max_provider_input = 64 * 1024;

/// Owns one ordinary-stdio app-server child. It is deliberately separate from
/// ConPTY sessions: app-server speaks NDJSON and must never receive terminal
/// escape sequences or a shell wrapper.
pub const Process = struct {
    id: u64,
    emitter: *rpc.Emitter,
    input: c.HANDLE,
    output: c.HANDLE,
    errors: c.HANDLE,
    process: c.HANDLE,
    thread: c.HANDLE,
    job: c.HANDLE,
    input_pump: InputPump,
    stdout_thread: ?std.Thread = null,
    stderr_thread: ?std.Thread = null,
    lock: c.SRWLOCK = std.mem.zeroes(c.SRWLOCK),
    exited: bool = false,
    exit_code: c.DWORD = 1,
    sequence: u64 = 0,
    stopping: bool = false,

    pub fn create(req: rpc.Request, emitter: *rpc.Emitter) !*Process {
        const id = req.provider_id orelse return error.MissingProviderId;
        if (id == 0) return error.InvalidProviderId;
        if (!std.mem.eql(u8, req.provider orelse "", "codex")) return error.UnsupportedProvider;
        const executable = req.executable orelse return error.MissingExecutable;
        const cwd = req.cwd orelse return error.MissingWorkingDirectory;
        if (!isAbsoluteWindows(executable) or std.mem.indexOfScalar(u8, executable, 0) != null) return error.InvalidExecutable;
        if (std.mem.indexOfScalar(u8, cwd, 0) != null) return error.InvalidWorkingDirectory;

        const exe_w = try std.unicode.utf8ToUtf16LeAllocZ(a, executable);
        defer a.free(exe_w);
        const cwd_w = try std.unicode.utf8ToUtf16LeAllocZ(a, cwd);
        defer a.free(cwd_w);
        const cmd_w = try command.encode(a, executable, req.args);
        defer a.free(cmd_w);

        var security = c.SECURITY_ATTRIBUTES{ .nLength = @sizeOf(c.SECURITY_ATTRIBUTES), .lpSecurityDescriptor = null, .bInheritHandle = c.TRUE };
        var input_read: c.HANDLE = null;
        var input_write: c.HANDLE = null;
        var output_read: c.HANDLE = null;
        var output_write: c.HANDLE = null;
        var error_read: c.HANDLE = null;
        var error_write: c.HANDLE = null;
        if (c.CreatePipe(&input_read, &input_write, &security, 65536) == 0) return error.ProviderPipeFailed;
        errdefer win.close(input_read);
        errdefer win.close(input_write);
        if (c.CreatePipe(&output_read, &output_write, &security, 65536) == 0) return error.ProviderPipeFailed;
        errdefer win.close(output_read);
        errdefer win.close(output_write);
        if (c.CreatePipe(&error_read, &error_write, &security, 65536) == 0) return error.ProviderPipeFailed;
        errdefer win.close(error_read);
        errdefer win.close(error_write);
        if (c.SetHandleInformation(input_write, c.HANDLE_FLAG_INHERIT, 0) == 0 or
            c.SetHandleInformation(output_read, c.HANDLE_FLAG_INHERIT, 0) == 0 or
            c.SetHandleInformation(error_read, c.HANDLE_FLAG_INHERIT, 0) == 0) return error.ProviderPipeFailed;

        const job = c.CreateJobObjectW(null, null) orelse return error.CreateJob;
        errdefer win.close(job);
        var limits: c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std.mem.zeroes(c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION);
        limits.BasicLimitInformation.LimitFlags = c.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (c.SetInformationJobObject(job, c.JobObjectExtendedLimitInformation, &limits, @sizeOf(@TypeOf(limits))) == 0) return error.ConfigureJob;

        var startup: c.STARTUPINFOEXW = std.mem.zeroes(c.STARTUPINFOEXW);
        startup.StartupInfo.cb = @sizeOf(c.STARTUPINFOEXW);
        startup.StartupInfo.dwFlags = c.STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = input_read;
        startup.StartupInfo.hStdOutput = output_write;
        startup.StartupInfo.hStdError = error_write;
        var info: c.PROCESS_INFORMATION = std.mem.zeroes(c.PROCESS_INFORMATION);
        if (c.CreateProcessW(exe_w.ptr, cmd_w.ptr, null, null, c.TRUE, c.CREATE_UNICODE_ENVIRONMENT | c.CREATE_NO_WINDOW, null, cwd_w.ptr, &startup.StartupInfo, &info) == 0) return error.ProviderCreateProcess;
        errdefer {
            _ = c.TerminateProcess(info.hProcess, 1);
            _ = c.WaitForSingleObject(info.hProcess, 1000);
            win.close(info.hThread);
            win.close(info.hProcess);
        }
        win.close(input_read);
        win.close(output_write);
        win.close(error_write);
        if (c.AssignProcessToJobObject(job, info.hProcess) == 0) return error.AssignJob;

        const self = try a.create(Process);
        errdefer a.destroy(self);
        self.* = .{
            .id = id, .emitter = emitter, .input = input_write, .output = output_read,
            .errors = error_read, .process = info.hProcess, .thread = info.hThread, .job = job,
            .input_pump = undefined,
        };
        self.input_pump = try InputPump.initProvider(input_write, emitter, id);
        errdefer self.input_pump.deinit();
        self.stdout_thread = try std.Thread.spawn(.{}, stdoutLoop, .{self});
        errdefer {
            self.stop();
            self.stdout_thread.?.join();
        }
        self.stderr_thread = try std.Thread.spawn(.{}, stderrLoop, .{self});
        try self.input_pump.start();
        return self;
    }

    pub fn send(self: *Process, bytes: []const u8) !void {
        if (bytes.len == 0 or bytes.len > max_provider_input) return error.ProviderInputTooLarge;
        try self.input_pump.enqueue(bytes);
    }

    pub fn hasExited(self: *Process) bool {
        c.AcquireSRWLockExclusive(&self.lock);
        defer c.ReleaseSRWLockExclusive(&self.lock);
        return self.exited;
    }

    pub fn stop(self: *Process) void {
        c.AcquireSRWLockExclusive(&self.lock);
        self.stopping = true;
        c.ReleaseSRWLockExclusive(&self.lock);
        self.input_pump.stop();
        _ = c.TerminateJobObject(self.job, 1);
    }

    pub fn destroy(self: *Process) void {
        self.stop();
        if (self.stdout_thread) |thread| thread.join();
        if (self.stderr_thread) |thread| thread.join();
        self.input_pump.join();
        self.input_pump.deinit();
        win.close(self.input);
        win.close(self.output);
        win.close(self.errors);
        win.close(self.thread);
        win.close(self.process);
        win.close(self.job);
        a.destroy(self);
    }

    fn stdoutLoop(self: *Process) void {
        var buffer: [max_provider_chunk]u8 = undefined;
        while (true) {
            var count: c.DWORD = 0;
            if (c.ReadFile(self.output, &buffer, buffer.len, &count, null) == 0 or count == 0) break;
            var encoded: [std.base64.standard.Encoder.calcSize(max_provider_chunk)]u8 = undefined;
            const data = std.base64.standard.Encoder.encode(&encoded, buffer[0..count]);
            c.AcquireSRWLockExclusive(&self.lock);
            self.sequence += 1;
            const sequence = self.sequence;
            c.ReleaseSRWLockExclusive(&self.lock);
            self.emitter.send(.{ .version = rpc.version, .event = "provider.output", .provider_id = self.id, .sequence = sequence, .data = data });
        }
        _ = c.WaitForSingleObject(self.process, 5000);
        var code: c.DWORD = 1;
        _ = c.GetExitCodeProcess(self.process, &code);
        c.AcquireSRWLockExclusive(&self.lock);
        self.exit_code = code;
        self.exited = true;
        c.ReleaseSRWLockExclusive(&self.lock);
        self.emitter.send(.{ .version = rpc.version, .event = "provider.exit", .provider_id = self.id, .exit_code = code, .last_sequence = self.sequence });
    }

    fn stderrLoop(self: *Process) void {
        var buffer: [4096]u8 = undefined;
        while (true) {
            var count: c.DWORD = 0;
            if (c.ReadFile(self.errors, &buffer, buffer.len, &count, null) == 0 or count == 0) break;
            // Drain stderr to prevent child deadlock. Raw provider diagnostics
            // never enter the user-facing chat stream.
        }
    }
};

fn isAbsoluteWindows(path: []const u8) bool {
    return path.len >= 3 and std.ascii.isAlphabetic(path[0]) and path[1] == ':' and (path[2] == '\\' or path[2] == '/');
}

test "provider executable validation never accepts a relative or shell path" {
    try std.testing.expect(!isAbsoluteWindows("codex.exe"));
    try std.testing.expect(!isAbsoluteWindows("C:codex.exe"));
    try std.testing.expect(isAbsoluteWindows("C:\\Program Files\\Codex\\codex.exe"));
}
