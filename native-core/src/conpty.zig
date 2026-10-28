const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const rpc = @import("protocol.zig");
const command = @import("command_line.zig");

pub const Process = struct {
    input: c.HANDLE,
    output: c.HANDLE,
    process: c.HANDLE,
    thread: c.HANDLE,
    job: c.HANDLE,
    console: c.HPCON,

    pub fn create(req: rpc.Request) !Process {
        const a = rpc.allocator;
        const executable = req.executable orelse return error.MissingExecutable;
        const cwd = req.cwd orelse return error.MissingWorkingDirectory;
        if (std.mem.indexOfScalar(u8, cwd, 0) != null) return error.InvalidWorkingDirectory;
        const exe_w = try std.unicode.utf8ToUtf16LeAllocZ(a, executable);
        defer a.free(exe_w);
        const cwd_w = try std.unicode.utf8ToUtf16LeAllocZ(a, cwd);
        defer a.free(cwd_w);
        const cmd_w = try command.encode(a, executable, req.args);
        defer a.free(cmd_w);

        var input_read: c.HANDLE = null;
        var input_write: c.HANDLE = null;
        var output_read: c.HANDLE = null;
        var output_write: c.HANDLE = null;
        if (c.CreatePipe(&input_read, &input_write, null, 65536) == 0) return error.CreateInputPipe;
        defer win.close(input_read);
        errdefer win.close(input_write);
        if (c.CreatePipe(&output_read, &output_write, null, 65536) == 0) return error.CreateOutputPipe;
        defer win.close(output_write);
        errdefer win.close(output_read);

        var console: c.HPCON = null;
        const size = c.COORD{ .X = req.cols, .Y = req.rows };
        if (c.CreatePseudoConsole(size, input_read, output_write, 0, &console) < 0) return error.CreateConsole;
        errdefer c.ClosePseudoConsole(console);

        var attr_size: c.SIZE_T = 0;
        _ = c.InitializeProcThreadAttributeList(null, 1, 0, &attr_size);
        const memory = c.VirtualAlloc(null, attr_size, c.MEM_COMMIT | c.MEM_RESERVE, c.PAGE_READWRITE) orelse return error.AllocateAttributes;
        defer _ = c.VirtualFree(memory, 0, c.MEM_RELEASE);
        const attributes: c.LPPROC_THREAD_ATTRIBUTE_LIST = @ptrCast(memory);
        if (c.InitializeProcThreadAttributeList(attributes, 1, 0, &attr_size) == 0) return error.InitializeAttributes;
        defer c.DeleteProcThreadAttributeList(attributes);
        if (c.UpdateProcThreadAttribute(attributes, 0, c.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, console, @sizeOf(c.HPCON), null, null) == 0)
            return error.AttachConsole;

        const job = c.CreateJobObjectW(null, null) orelse return error.CreateJob;
        errdefer win.close(job);
        var limits: c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std.mem.zeroes(c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION);
        limits.BasicLimitInformation.LimitFlags = c.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (c.SetInformationJobObject(job, c.JobObjectExtendedLimitInformation, &limits, @sizeOf(@TypeOf(limits))) == 0)
            return error.ConfigureJob;

        var startup: c.STARTUPINFOEXW = std.mem.zeroes(c.STARTUPINFOEXW);
        startup.StartupInfo.cb = @sizeOf(c.STARTUPINFOEXW);
        // Explicit null std handles prevent Windows from duplicating our JSONL
        // pipes into a console child despite bInheritHandles=false. ConPTY then
        // supplies console handles (see microsoft/terminal discussion 15814).
        startup.StartupInfo.dwFlags = c.STARTF_USESTDHANDLES;
        startup.lpAttributeList = attributes;
        var info: c.PROCESS_INFORMATION = std.mem.zeroes(c.PROCESS_INFORMATION);
        if (c.CreateProcessW(exe_w.ptr, cmd_w.ptr, null, null, c.FALSE, c.EXTENDED_STARTUPINFO_PRESENT | c.CREATE_SUSPENDED | c.CREATE_UNICODE_ENVIRONMENT, null, cwd_w.ptr, &startup.StartupInfo, &info) == 0)
            return error.CreateProcess;
        errdefer {
            _ = c.TerminateProcess(info.hProcess, 1);
            _ = c.WaitForSingleObject(info.hProcess, 5000);
            win.close(info.hProcess);
            win.close(info.hThread);
        }
        if (c.AssignProcessToJobObject(job, info.hProcess) == 0) return error.AssignJob;
        return .{ .input = input_write, .output = output_read, .process = info.hProcess, .thread = info.hThread, .job = job, .console = console };
    }

    pub fn terminate(self: *Process) void {
        _ = c.TerminateJobObject(self.job, 1);
    }

    pub fn deinit(self: *Process) void {
        win.close(self.input);
        win.close(self.output);
        win.close(self.thread);
        win.close(self.process);
        win.close(self.job);
    }
};
