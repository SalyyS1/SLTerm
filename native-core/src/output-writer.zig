const std = @import("std");
const win = @import("win.zig");
const c = win.c;

// Keep OS writes off the command dispatcher. The queue has a byte budget;
// the writer owns at most one additional frame while WriteFile is blocked.
pub const OutputWriter = struct {
    pub const capacity = 256 * 1024;
    pub const max_frame = 64 * 1024;
    handle: c.HANDLE = null,
    work_event: c.HANDLE = null,
    space_event: c.HANDLE = null,
    done_event: c.HANDLE = null,
    thread: ?std.Thread = null,
    lock: c.SRWLOCK = std.mem.zeroes(c.SRWLOCK),
    buffer: [capacity]u8 = undefined,
    head: usize = 0,
    length: usize = 0,
    closing: bool = false,
    failed: bool = false,

    pub fn start(self: *OutputWriter, handle: c.HANDLE) !void {
        self.handle = handle;
        self.work_event = c.CreateEventW(null, c.FALSE, c.FALSE, null) orelse return error.CreateEvent;
        errdefer win.close(self.work_event);
        self.space_event = c.CreateEventW(null, c.TRUE, c.TRUE, null) orelse return error.CreateEvent;
        errdefer win.close(self.space_event);
        self.done_event = c.CreateEventW(null, c.TRUE, c.FALSE, null) orelse return error.CreateEvent;
        errdefer win.close(self.done_event);
        self.thread = try std.Thread.spawn(.{}, run, .{self});
    }

    pub fn deinit(self: *OutputWriter) !void {
        c.AcquireSRWLockExclusive(&self.lock);
        self.closing = true;
        c.ReleaseSRWLockExclusive(&self.lock);
        _ = c.SetEvent(self.work_event);
        if (c.WaitForSingleObject(self.done_event, 1000) == c.WAIT_TIMEOUT)
            std.debug.print("TransportDrainPending: queued delivery and shutdown acknowledgement are unconfirmed until stdout resumes\n", .{});
        if (self.thread) |thread| thread.join();
        win.close(self.work_event);
        win.close(self.space_event);
        win.close(self.done_event);
        if (self.failed) return error.TransportWriteFailed;
    }

    pub fn recordFailure(self: *OutputWriter) void {
        c.AcquireSRWLockExclusive(&self.lock);
        self.failed = true;
        c.ReleaseSRWLockExclusive(&self.lock);
        _ = c.SetEvent(self.space_event);
    }

    pub fn enqueue(self: *OutputWriter, json: []const u8, wait: bool) !void {
        if (json.len + 1 > max_frame) return error.OutputFrameTooLarge;
        while (true) {
            c.AcquireSRWLockExclusive(&self.lock);
            if (self.failed or self.closing) {
                c.ReleaseSRWLockExclusive(&self.lock);
                return error.TransportClosed;
            }
            if (json.len + 5 <= capacity - self.length) {
                var prefix: [4]u8 = undefined;
                std.mem.writeInt(u32, &prefix, @intCast(json.len + 1), .little);
                self.push(&prefix);
                self.push(json);
                self.push("\n");
                c.ReleaseSRWLockExclusive(&self.lock);
                _ = c.SetEvent(self.work_event);
                return;
            }
            if (!wait) {
                c.ReleaseSRWLockExclusive(&self.lock);
                return error.TransportBackpressure;
            }
            _ = c.ResetEvent(self.space_event);
            c.ReleaseSRWLockExclusive(&self.lock);
            _ = c.WaitForSingleObject(self.space_event, c.INFINITE);
        }
    }

    fn push(self: *OutputWriter, bytes: []const u8) void {
        const tail = (self.head + self.length) % capacity;
        const first = @min(bytes.len, capacity - tail);
        @memcpy(self.buffer[tail..][0..first], bytes[0..first]);
        @memcpy(self.buffer[0 .. bytes.len - first], bytes[first..]);
        self.length += bytes.len;
    }

    fn pop(self: *OutputWriter, bytes: []u8) void {
        const first = @min(bytes.len, capacity - self.head);
        @memcpy(bytes[0..first], self.buffer[self.head..][0..first]);
        @memcpy(bytes[first..], self.buffer[0 .. bytes.len - first]);
        self.head = (self.head + bytes.len) % capacity;
        self.length -= bytes.len;
    }

    fn run(self: *OutputWriter) void {
        defer _ = c.SetEvent(self.done_event);
        var frame: [max_frame]u8 = undefined;
        while (true) {
            c.AcquireSRWLockExclusive(&self.lock);
            if (self.length == 0) {
                const closing = self.closing;
                c.ReleaseSRWLockExclusive(&self.lock);
                if (closing) return;
                _ = c.WaitForSingleObject(self.work_event, c.INFINITE);
                continue;
            }
            var prefix: [4]u8 = undefined;
            self.pop(&prefix);
            const count = std.mem.readInt(u32, &prefix, .little);
            self.pop(frame[0..count]);
            c.ReleaseSRWLockExclusive(&self.lock);
            _ = c.SetEvent(self.space_event);
            win.writeAll(self.handle, frame[0..count]) catch {
                c.AcquireSRWLockExclusive(&self.lock);
                self.failed = true;
                c.ReleaseSRWLockExclusive(&self.lock);
                _ = c.SetEvent(self.space_event);
                std.debug.print("TransportWriteFailed: queued delivery and shutdown acknowledgement are unconfirmed\n", .{});
                return;
            };
        }
    }
};
