const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const rpc = @import("protocol.zig");

// A successful input request means queued, not consumed by the child. Never let
// a synchronous ConPTY input write block the command/stop/ACK dispatcher.
pub const InputPump = struct {
    pub const capacity = 64 * 1024;
    handle: c.HANDLE,
    event: c.HANDLE,
    emitter: *rpc.Emitter,
    session_id: u64,
    thread: ?std.Thread = null,
    lock: c.SRWLOCK = std.mem.zeroes(c.SRWLOCK),
    buffer: [capacity]u8 = undefined,
    head: usize = 0,
    length: usize = 0,
    in_flight: usize = 0,
    closed: bool = false,

    pub fn init(handle: c.HANDLE, emitter: *rpc.Emitter, session_id: u64) !InputPump {
        return .{
            .handle = handle,
            .event = c.CreateEventW(null, c.FALSE, c.FALSE, null) orelse return error.CreateEvent,
            .emitter = emitter,
            .session_id = session_id,
        };
    }

    pub fn start(self: *InputPump) !void {
        self.thread = try std.Thread.spawn(.{}, run, .{self});
    }

    pub fn enqueue(self: *InputPump, bytes: []const u8) !void {
        if (bytes.len > 4096) return error.InputTooLarge;
        c.AcquireSRWLockExclusive(&self.lock);
        defer c.ReleaseSRWLockExclusive(&self.lock);
        if (self.closed) return error.SessionExited;
        if (bytes.len > capacity - self.length - self.in_flight) return error.InputBackpressure;
        const tail = (self.head + self.length) % capacity;
        const first = @min(bytes.len, capacity - tail);
        @memcpy(self.buffer[tail..][0..first], bytes[0..first]);
        @memcpy(self.buffer[0 .. bytes.len - first], bytes[first..]);
        self.length += bytes.len;
        _ = c.SetEvent(self.event);
    }

    pub fn stop(self: *InputPump) void {
        c.AcquireSRWLockExclusive(&self.lock);
        self.closed = true;
        c.ReleaseSRWLockExclusive(&self.lock);
        _ = c.SetEvent(self.event);
        // The process waiter closes ConPTY, breaking a blocked WriteFile.
        // A queue flag alone cannot cancel that synchronous OS operation.
    }

    pub fn join(self: *InputPump) void {
        if (self.thread) |thread| thread.join();
    }

    pub fn deinit(self: *InputPump) void {
        win.close(self.event);
    }

    fn reportUncertain(self: *InputPump, count: usize) void {
        if (count != 0) self.emitter.send(.{
            .version = rpc.version,
            .event = "input-error",
            .session_id = self.session_id,
            .error_code = "InputDeliveryUncertain",
            .affected_bytes = count,
        });
    }

    fn run(self: *InputPump) void {
        var chunk: [4096]u8 = undefined;
        while (true) {
            _ = c.WaitForSingleObject(self.event, c.INFINITE);
            c.AcquireSRWLockExclusive(&self.lock);
            if (self.closed) {
                const discarded = self.length;
                self.length = 0;
                c.ReleaseSRWLockExclusive(&self.lock);
                self.reportUncertain(discarded);
                return;
            }
            const count = @min(self.length, chunk.len);
            const first = @min(count, capacity - self.head);
            @memcpy(chunk[0..first], self.buffer[self.head..][0..first]);
            @memcpy(chunk[first..count], self.buffer[0 .. count - first]);
            self.head = (self.head + count) % capacity;
            self.length -= count;
            self.in_flight = count;
            c.ReleaseSRWLockExclusive(&self.lock);
            win.writeAll(self.handle, chunk[0..count]) catch {
                c.AcquireSRWLockExclusive(&self.lock);
                const uncertain = self.length + self.in_flight;
                self.closed = true;
                self.length = 0;
                self.in_flight = 0;
                c.ReleaseSRWLockExclusive(&self.lock);
                self.reportUncertain(uncertain);
                return;
            };
            c.AcquireSRWLockExclusive(&self.lock);
            self.in_flight = 0;
            const more = self.length != 0 or self.closed;
            c.ReleaseSRWLockExclusive(&self.lock);
            if (more) _ = c.SetEvent(self.event);
        }
    }
};
