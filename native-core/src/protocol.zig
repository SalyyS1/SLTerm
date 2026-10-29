const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const OutputWriter = @import("output-writer.zig").OutputWriter;

pub const version = 1;
pub const max_frame = 64 * 1024;
pub const max_output_chunk = 4096;
pub const allocator = std.heap.page_allocator;

pub const Request = @import("core-contract.zig").Request;

pub const Emitter = struct {
    writer: OutputWriter = .{},

    pub fn start(self: *Emitter, handle: c.HANDLE) !void {
        try self.writer.start(handle);
    }

    pub fn deinit(self: *Emitter) !void {
        try self.writer.deinit();
    }

    pub fn send(self: *Emitter, value: anytype) void {
        self.sendBlocking(value) catch |err| {
            self.writer.recordFailure();
            std.debug.print("{s}: frame delivery is unconfirmed\n", .{@errorName(err)});
        };
    }

    pub fn sendBlocking(self: *Emitter, value: anytype) !void {
        try self.sendValue(value, true);
    }

    pub fn trySend(self: *Emitter, value: anytype) !void {
        try self.sendValue(value, false);
    }

    fn sendValue(self: *Emitter, value: anytype, wait: bool) !void {
        const json = try std.json.Stringify.valueAlloc(allocator, value, .{});
        defer allocator.free(json);
        try self.writer.enqueue(json, wait);
    }

    pub fn ok(self: *Emitter, id: u64) !void {
        try self.trySend(.{ .version = version, .id = id, .ok = true });
    }

    pub fn tryFail(self: *Emitter, id: u64, message: []const u8) !void {
        try self.trySend(.{ .version = version, .id = id, .ok = false, .error_code = message });
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
