const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const rpc = @import("protocol.zig");
const Process = @import("conpty.zig").Process;
const InputPump = @import("input-pump.zig").InputPump;
const TranscriptStore = @import("transcript-store.zig").Store;

pub const Session = struct {
    id: u64,
    process: Process,
    emitter: *rpc.Emitter,
    lock: c.SRWLOCK = std.mem.zeroes(c.SRWLOCK),
    ack_event: c.HANDLE,
    stop_event: c.HANDLE,
    done_event: c.HANDLE,
    input_pump: InputPump,
    reader: ?std.Thread = null,
    waiter: ?std.Thread = null,
    sent: u64 = 0,
    acknowledged: u64 = 0,
    exit_code: c.DWORD = 0,
    exited: bool = false,
    archive: ?*TranscriptStore = null,
    run_id: ?[]u8 = null,
    /// Set before startup cleanup wakes the reader. An archive with this
    /// marker is deliberately incomplete even if the process handle reports
    /// its default exit code.
    startup_error: ?[]const u8 = null,

    pub fn create(request: rpc.Request, emitter: *rpc.Emitter, archive: ?*TranscriptStore) !*Session {
        if (request.session_id == 0) return error.InvalidSessionId;
        const self = try rpc.allocator.create(Session);
        errdefer rpc.allocator.destroy(self);
        const run_id = if (request.run_id) |id| try rpc.allocator.dupe(u8, id) else null;
        errdefer if (run_id) |id| rpc.allocator.free(id);
        const ack = c.CreateEventW(null, c.FALSE, c.FALSE, null) orelse return error.CreateEvent;
        errdefer win.close(ack);
        const stop_event = c.CreateEventW(null, c.TRUE, c.FALSE, null) orelse return error.CreateEvent;
        errdefer win.close(stop_event);
        const done = c.CreateEventW(null, c.TRUE, c.FALSE, null) orelse return error.CreateEvent;
        errdefer win.close(done);
        const process = try Process.create(request);
        self.* = .{
            .id = request.session_id,
            .process = process,
            .emitter = emitter,
            .ack_event = ack,
            .stop_event = stop_event,
            .done_event = done,
            .input_pump = undefined,
            .archive = archive,
            .run_id = run_id,
        };
        errdefer {
            self.process.terminate();
            if (self.process.console != null) {
                // No reader exists on this error path; close our output end
                // before ConPTY to avoid a final-frame flush deadlock.
                win.close(self.process.output);
                self.process.output = null;
                c.ClosePseudoConsole(self.process.console);
            }
            self.process.deinit();
        }
        if (archive) |store| {
            const identity = try std.json.Stringify.valueAlloc(rpc.allocator, .{
                .version = 1, .protocol_version = rpc.version,
                .execution_host = "windows-local", .provider = "shell",
                .cwd = request.cwd, .attempt_id = run_id.?,
                .workspace_id = request.workspace_id,
                .task_id = @as(?[]const u8, null), .worktree = @as(?[]const u8, null),
                .credential_reference = @as(?[]const u8, null),
                .initial_cols = request.cols, .initial_rows = request.rows,
            }, .{});
            defer rpc.allocator.free(identity);
            try store.create(run_id.?, identity);
        }
        self.input_pump = try InputPump.init(process.input, emitter, request.session_id);
        errdefer self.input_pump.deinit();
        self.reader = try std.Thread.spawn(.{}, readLoop, .{self});
        errdefer {
            self.startup_error = "SessionStartFailed";
            self.process.terminate();
            _ = c.SetEvent(stop_event);
            if (self.process.console != null) c.ClosePseudoConsole(self.process.console);
            self.process.console = null;
            _ = c.SetEvent(done);
            self.reader.?.join();
        }
        try self.input_pump.start();
        errdefer {
            self.startup_error = "InputPumpStartFailed";
            self.input_pump.stop();
            self.process.terminate();
            _ = c.SetEvent(stop_event);
            if (self.process.console != null) c.ClosePseudoConsole(self.process.console);
            self.process.console = null;
            self.input_pump.join();
        }
        if (c.ResumeThread(process.thread) == c.INFINITE) {
            self.startup_error = "ResumeProcessFailed";
            return error.ResumeProcess;
        }
        errdefer self.startup_error = "WaiterStartFailed";
        self.waiter = try std.Thread.spawn(.{}, waitLoop, .{self});
        return self;
    }

    pub fn acknowledge(self: *Session, sequence: u64) !void {
        c.AcquireSRWLockExclusive(&self.lock);
        defer c.ReleaseSRWLockExclusive(&self.lock);
        if (sequence != self.sent or sequence <= self.acknowledged) return error.InvalidAcknowledgement;
        self.acknowledged = sequence;
        _ = c.SetEvent(self.ack_event);
    }

    pub fn hasExited(self: *Session) bool {
        c.AcquireSRWLockExclusive(&self.lock);
        defer c.ReleaseSRWLockExclusive(&self.lock);
        return self.exited;
    }

    pub fn resize(self: *Session, cols: i16, rows: i16) !void {
        c.AcquireSRWLockExclusive(&self.lock);
        defer c.ReleaseSRWLockExclusive(&self.lock);
        if (self.process.console == null) return error.SessionExited;
        if (c.ResizePseudoConsole(self.process.console, .{ .X = cols, .Y = rows }) < 0) return error.ResizeFailed;
    }

    pub fn input(self: *Session, data: []const u8) !void {
        if (c.WaitForSingleObject(self.done_event, 0) == c.WAIT_OBJECT_0) return error.SessionExited;
        try self.input_pump.enqueue(data);
    }

    pub fn stop(self: *Session) void {
        // Wake a stalled consumer before waiting for a killed process to drain.
        _ = c.SetEvent(self.stop_event);
        self.input_pump.stop();
        self.process.terminate();
    }

    pub fn destroy(self: *Session) void {
        self.stop();
        if (self.waiter) |thread| thread.join();
        if (self.reader) |thread| thread.join();
        self.input_pump.deinit();
        self.process.deinit();
        win.close(self.ack_event);
        win.close(self.stop_event);
        win.close(self.done_event);
        if (self.run_id) |id| rpc.allocator.free(id);
        rpc.allocator.destroy(self);
    }

    fn waitLoop(self: *Session) void {
        _ = c.WaitForSingleObject(self.process.process, c.INFINITE);
        var code: c.DWORD = 1;
        _ = c.GetExitCodeProcess(self.process.process, &code);
        // A closed proof session must not retain detached descendants in its job.
        self.process.terminate();
        c.AcquireSRWLockExclusive(&self.lock);
        const console = self.process.console;
        self.process.console = null;
        self.exit_code = code;
        c.ReleaseSRWLockExclusive(&self.lock);
        self.input_pump.stop();
        // ClosePseudoConsole can block while flushing: a separate reader must stay alive.
        c.ClosePseudoConsole(console);
        self.input_pump.join();
        _ = c.SetEvent(self.done_event);
    }

    fn readLoop(self: *Session) void {
        var buffer: [rpc.max_output_chunk]u8 = undefined;
        var stopped = false;
        var discarded: u64 = 0;
        var capture_sequence: u64 = 0;
        var capture_error: ?[]const u8 = null;
        var pipe_error: ?[]const u8 = null;
        var truncation_reported = false;
        while (true) {
            var count: c.DWORD = 0;
            if (c.ReadFile(self.process.output, &buffer, buffer.len, &count, null) == 0) {
                const code = c.GetLastError();
                if (code != c.ERROR_BROKEN_PIPE and code != c.ERROR_HANDLE_EOF) {
                    pipe_error = "TerminalReadFailed";
                    self.warning("stream-error", "TerminalReadFailed", "Không đọc được toàn bộ output; phiên có thể thiếu dữ liệu.");
                }
                break;
            }
            if (count == 0) break;
            capture_sequence += 1;
            if (self.archive) |store| {
                if (capture_error == null) {
                    if (store.append(self.run_id.?, capture_sequence, buffer[0..count])) |result| {
                        if (result.truncated and !truncation_reported) {
                            truncation_reported = true;
                            self.warning("archive-warning", "TranscriptTruncated", "Kho lịch sử đạt giới hạn byte. Terminal vẫn chạy; output tiếp theo không được lưu đầy đủ.");
                        }
                    } else |err| {
                        capture_error = @errorName(err);
                        self.warning("archive-warning", @errorName(err), "Không lưu được đầy đủ lịch sử terminal. Không bảo đảm khôi phục output mới.");
                    }
                }
            }
            if (stopped) {
                discarded += count;
                continue;
            }
            var encoded: [std.base64.standard.Encoder.calcSize(rpc.max_output_chunk)]u8 = undefined;
            const base64 = std.base64.standard.Encoder.encode(&encoded, buffer[0..count]);
            c.AcquireSRWLockExclusive(&self.lock);
            self.sent += 1;
            const sequence = self.sent;
            c.ReleaseSRWLockExclusive(&self.lock);
            self.emitter.send(.{ .version = rpc.version, .event = "output", .session_id = self.id, .sequence = sequence, .data = base64 });
            const events = [_]c.HANDLE{ self.ack_event, self.stop_event };
            stopped = c.WaitForMultipleObjects(events.len, &events, c.FALSE, c.INFINITE) != c.WAIT_OBJECT_0;
        }
        _ = c.WaitForSingleObject(self.done_event, c.INFINITE);
        if (discarded != 0) self.emitter.send(.{ .version = rpc.version, .event = "gap", .session_id = self.id, .discarded_bytes = discarded });
        if (self.archive) |store| {
            store.finish(self.run_id.?, self.exit_code, capture_sequence, discarded,
                capture_error orelse pipe_error orelse self.startup_error) catch |err| {
                self.warning("archive-warning", @errorName(err), "Chưa xác nhận lưu output cuối. Lịch sử phiên sẽ được đánh dấu chưa hoàn tất.");
            };
        }
        self.emitter.send(.{ .version = rpc.version, .event = "exit", .session_id = self.id, .exit_code = self.exit_code, .last_sequence = self.sent });
        c.AcquireSRWLockExclusive(&self.lock);
        self.exited = true;
        c.ReleaseSRWLockExclusive(&self.lock);
    }

    fn warning(self: *Session, event: []const u8, code: []const u8, message: []const u8) void {
        self.emitter.send(.{ .version = rpc.version, .event = event, .session_id = self.id, .error_code = code, .message = message });
    }
};
