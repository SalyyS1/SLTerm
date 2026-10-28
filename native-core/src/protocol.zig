const std = @import("std");
const win = @import("win.zig");
const c = win.c;

pub const version = 1;
pub const max_frame = 64 * 1024;
pub const max_output_chunk = 4096;
pub const allocator = std.heap.page_allocator;

pub const Request = struct {
    version: u32,
    id: u64,
    method: []const u8,
    session_id: u64 = 0,
    executable: ?[]const u8 = null,
    args: []const []const u8 = &.{},
    cwd: ?[]const u8 = null,
    cols: i16 = 100,
    rows: i16 = 30,
    data: ?[]const u8 = null,
    sequence: u64 = 0,
};

pub const Emitter = struct {
    lock: c.SRWLOCK = std.mem.zeroes(c.SRWLOCK),
    handle: c.HANDLE,

    pub fn send(self: *Emitter, value: anytype) void {
        const json = std.json.Stringify.valueAlloc(allocator, value, .{}) catch return;
        defer allocator.free(json);
        c.AcquireSRWLockExclusive(&self.lock);
        defer c.ReleaseSRWLockExclusive(&self.lock);
        win.writeAll(self.handle, json) catch return;
        win.writeAll(self.handle, "\n") catch return;
    }

    pub fn ok(self: *Emitter, id: u64) void {
        self.send(.{ .version = version, .id = id, .ok = true });
    }

    pub fn fail(self: *Emitter, id: u64, message: []const u8) void {
        self.send(.{ .version = version, .id = id, .ok = false, .error_code = message });
    }
};

pub fn validate(request: Request) !void {
    if (request.version != version) return error.UnsupportedVersion;
    if (request.id == 0) return error.InvalidRequestId;
    if (request.cols < 1 or request.rows < 1) return error.InvalidDimensions;
}

test "protocol rejects incompatible versions and invalid terminal dimensions" {
    try std.testing.expectError(error.UnsupportedVersion, validate(.{ .version = 2, .id = 1, .method = "hello" }));
    try std.testing.expectError(error.InvalidRequestId, validate(.{ .version = 1, .id = 0, .method = "hello" }));
    try std.testing.expectError(error.InvalidDimensions, validate(.{ .version = 1, .id = 1, .method = "spawn", .cols = 0 }));
}
