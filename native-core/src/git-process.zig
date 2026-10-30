const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const a = std.heap.page_allocator;
const command = @import("command_line.zig");
pub const output_limit = 128 * 1024;

pub fn environment(name: [:0]const u16) ![]u8 {
    const size = c.GetEnvironmentVariableW(name.ptr, null, 0);
    if (size == 0 or size > 32768) return error.MissingGitEnvironment;
    const wide = try a.alloc(u16, size);
    defer a.free(wide);
    const len = c.GetEnvironmentVariableW(name.ptr, wide.ptr, size);
    if (len == 0 or len >= size) return error.MissingGitEnvironment;
    return std.unicode.utf16LeToUtf8Alloc(a, wide[0..len]);
}

// No inherited Git configuration/environment can introduce a helper, hook,
// pager, prompt, shell or filter. Only Windows loader/temp values survive.
fn childEnvironment() ![:0]u16 {
    var bytes: std.ArrayList(u8) = .empty;
    defer bytes.deinit(a);
    // Windows environment blocks are sorted by variable name.
    try bytes.appendSlice(a, "GIT_ATTR_NOSYSTEM=1\x00GIT_CONFIG_GLOBAL=NUL\x00GIT_CONFIG_NOSYSTEM=1\x00GIT_LFS_SKIP_SMUDGE=1\x00GIT_NO_REPLACE_OBJECTS=1\x00GIT_OPTIONAL_LOCKS=0\x00GIT_TERMINAL_PROMPT=0\x00");
    for ([_][]const u8{ "SystemRoot", "TEMP", "TMP", "WINDIR" }) |name| {
        const key = try std.unicode.utf8ToUtf16LeAllocZ(a, name);
        defer a.free(key);
        const value = environment(key) catch continue;
        defer a.free(value);
        try bytes.appendSlice(a, name);
        try bytes.append(a, '=');
        try bytes.appendSlice(a, value);
        try bytes.append(a, 0);
    }
    return std.unicode.utf8ToUtf16LeAllocZ(a, bytes.items);
}

pub const Result = struct {
    stdout: []u8,
    stderr: []u8,
    code: u32,
    pub fn deinit(self: Result) void {
        a.free(self.stdout);
        a.free(self.stderr);
    }
};

fn drain(handle: c.HANDLE, output: *std.ArrayList(u8), total: *usize) !void {
    var buffer: [8192]u8 = undefined;
    while (true) {
        var available: c.DWORD = 0;
        if (c.PeekNamedPipe(handle, null, 0, null, &available, null) == 0) {
            if (c.GetLastError() == c.ERROR_BROKEN_PIPE) return;
            return error.GitPipeFailed;
        }
        if (available == 0) return;
        var received: c.DWORD = 0;
        if (c.ReadFile(handle, &buffer, @intCast(@min(available, buffer.len)), &received, null) == 0) return error.GitPipeFailed;
        total.* += received;
        if (total.* > output_limit) return error.GitOutputLimit;
        try output.appendSlice(a, buffer[0..received]);
    }
}

/// A single deadline covers every Git call in an operation. Pipes drain while
/// Git runs, and every exit/error terminates the owned job tree before closing.
pub fn run(executable: []const u8, cwd: []const u8, args: []const []const u8, deadline: u64) !Result {
    if (c.GetTickCount64() >= deadline) return error.WorktreeCompletionUnknown;
    const exe_w = try std.unicode.utf8ToUtf16LeAllocZ(a, executable);
    defer a.free(exe_w);
    const cwd_w = try std.unicode.utf8ToUtf16LeAllocZ(a, cwd);
    defer a.free(cwd_w);
    const cmd_w = try command.encode(a, executable, args);
    defer a.free(cmd_w);
    const env_w = try childEnvironment();
    defer a.free(env_w);
    var security = c.SECURITY_ATTRIBUTES{ .nLength = @sizeOf(c.SECURITY_ATTRIBUTES), .lpSecurityDescriptor = null, .bInheritHandle = c.TRUE };
    var out_read: c.HANDLE = null;
    var out_write: c.HANDLE = null;
    var err_read: c.HANDLE = null;
    var err_write: c.HANDLE = null;
    if (c.CreatePipe(&out_read, &out_write, &security, 65536) == 0) return error.GitPipeFailed;
    defer win.close(out_read);
    defer win.close(out_write);
    if (c.SetHandleInformation(out_read, c.HANDLE_FLAG_INHERIT, 0) == 0) return error.GitPipeFailed;
    if (c.CreatePipe(&err_read, &err_write, &security, 65536) == 0) return error.GitPipeFailed;
    defer win.close(err_read);
    defer win.close(err_write);
    if (c.SetHandleInformation(err_read, c.HANDLE_FLAG_INHERIT, 0) == 0) return error.GitPipeFailed;
    const input = c.CreateFileW(std.unicode.utf8ToUtf16LeStringLiteral("NUL"), c.GENERIC_READ, c.FILE_SHARE_READ | c.FILE_SHARE_WRITE, &security, c.OPEN_EXISTING, 0, null);
    if (input == c.INVALID_HANDLE_VALUE) return error.GitPipeFailed;
    defer win.close(input);
    var attr_size: c.SIZE_T = 0;
    _ = c.InitializeProcThreadAttributeList(null, 1, 0, &attr_size);
    const memory = c.VirtualAlloc(null, attr_size, c.MEM_COMMIT | c.MEM_RESERVE, c.PAGE_READWRITE) orelse return error.AllocateAttributes;
    defer _ = c.VirtualFree(memory, 0, c.MEM_RELEASE);
    const attributes: c.LPPROC_THREAD_ATTRIBUTE_LIST = @ptrCast(memory);
    if (c.InitializeProcThreadAttributeList(attributes, 1, 0, &attr_size) == 0) return error.InitializeAttributes;
    defer c.DeleteProcThreadAttributeList(attributes);
    var handles = [_]c.HANDLE{ input, out_write, err_write };
    if (c.UpdateProcThreadAttribute(attributes, 0, c.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles, @sizeOf(@TypeOf(handles)), null, null) == 0) return error.AttachGitHandles;
    const job = c.CreateJobObjectW(null, null) orelse return error.CreateJob;
    defer win.close(job);
    var limits: c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std.mem.zeroes(c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION);
    limits.BasicLimitInformation.LimitFlags = c.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (c.SetInformationJobObject(job, c.JobObjectExtendedLimitInformation, &limits, @sizeOf(@TypeOf(limits))) == 0) return error.ConfigureJob;
    var startup: c.STARTUPINFOEXW = std.mem.zeroes(c.STARTUPINFOEXW);
    startup.StartupInfo.cb = @sizeOf(c.STARTUPINFOEXW);
    startup.StartupInfo.dwFlags = c.STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input;
    startup.StartupInfo.hStdOutput = out_write;
    startup.StartupInfo.hStdError = err_write;
    startup.lpAttributeList = attributes;
    var info: c.PROCESS_INFORMATION = std.mem.zeroes(c.PROCESS_INFORMATION);
    if (c.CreateProcessW(exe_w.ptr, cmd_w.ptr, null, null, c.TRUE, c.EXTENDED_STARTUPINFO_PRESENT | c.CREATE_SUSPENDED | c.CREATE_UNICODE_ENVIRONMENT | c.CREATE_NO_WINDOW, env_w.ptr, cwd_w.ptr, &startup.StartupInfo, &info) == 0) return error.GitCreateProcess;
    defer win.close(info.hThread);
    defer win.close(info.hProcess);
    defer {
        _ = c.TerminateJobObject(job, 1);
        _ = c.TerminateProcess(info.hProcess, 1);
        _ = c.WaitForSingleObject(info.hProcess, 1000);
    }
    if (c.AssignProcessToJobObject(job, info.hProcess) == 0) return error.AssignJob;
    if (c.ResumeThread(info.hThread) == 0xffffffff) return error.GitResumeProcess;
    var stdout: std.ArrayList(u8) = .empty;
    errdefer stdout.deinit(a);
    var stderr: std.ArrayList(u8) = .empty;
    errdefer stderr.deinit(a);
    var total: usize = 0;
    while (true) {
        try drain(out_read, &stdout, &total);
        try drain(err_read, &stderr, &total);
        const state = c.WaitForSingleObject(info.hProcess, 0);
        if (state == c.WAIT_OBJECT_0) break;
        if (state != c.WAIT_TIMEOUT) return error.GitWaitFailed;
        if (c.GetTickCount64() >= deadline) return error.WorktreeCompletionUnknown;
        c.Sleep(2);
    }
    try drain(out_read, &stdout, &total);
    try drain(err_read, &stderr, &total);
    var code: c.DWORD = 0;
    if (c.GetExitCodeProcess(info.hProcess, &code) == 0) return error.GitWaitFailed;
    const stdout_bytes = try stdout.toOwnedSlice(a);
    errdefer a.free(stdout_bytes);
    return .{ .stdout = stdout_bytes, .stderr = try stderr.toOwnedSlice(a), .code = code };
}

test "bounded child process drains pipe bursts without waiting for process exit" {
    const system = try environment(std.unicode.utf8ToUtf16LeStringLiteral("SystemRoot"));
    defer a.free(system);
    const executable = try std.fmt.allocPrint(a, "{s}\\System32\\where.exe", .{system});
    defer a.free(executable);
    // Enumerating the Windows installation produces more than a pipe buffer;
    // the cap must fire during enumeration, before the child can finish.
    try std.testing.expectError(error.GitOutputLimit, run(executable, system, &.{ "/R", system, "*" }, c.GetTickCount64() + 9000));
}

test "bounded child process terminates its job on deadline" {
    const system = try environment(std.unicode.utf8ToUtf16LeStringLiteral("SystemRoot"));
    defer a.free(system);
    const executable = try std.fmt.allocPrint(a, "{s}\\System32\\ping.exe", .{system});
    defer a.free(executable);
    try std.testing.expectError(error.WorktreeCompletionUnknown, run(executable, system, &.{ "-n", "30", "127.0.0.1" }, c.GetTickCount64() + 200));
}
