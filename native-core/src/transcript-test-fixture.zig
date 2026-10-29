const std = @import("std");
const win = @import("storage-win.zig");
const testing = std.testing;
var serial = std.atomic.Value(u64).init(0);

pub const first_id = "11111111-1111-4111-8111-111111111111";
pub const second_id = "22222222-2222-4222-8222-222222222222";

pub const Fixture = struct {
    directory: []u8,
    path: []u8,

    pub fn create() !Fixture {
        var buffer: [32768]u16 = undefined;
        const length = win.GetTempPathW(buffer.len, &buffer);
        if (length == 0 or length >= buffer.len) return error.TemporaryDirectoryFailed;
        const parent = try std.unicode.utf16LeToUtf8Alloc(testing.allocator, buffer[0..length]);
        defer testing.allocator.free(parent);
        const directory = try std.fmt.allocPrint(testing.allocator, "{s}slterm-ade-transcript-{d}-{d}-{d}", .{ parent, win.GetCurrentProcessId(), win.GetTickCount64(), serial.fetchAdd(1, .monotonic) });
        errdefer testing.allocator.free(directory);
        const wide = try win.wide(directory);
        defer std.heap.page_allocator.free(wide);
        if (win.CreateDirectoryW(wide, null) == 0) return error.TemporaryDirectoryFailed;
        return .{ .directory = directory, .path = try std.fmt.allocPrint(testing.allocator, "{s}\\lịch-sử.sqlite3", .{directory}) };
    }

    pub fn deinit(self: Fixture) void {
        for ([_][]const u8{ "", "-journal", "-wal", "-shm" }) |suffix| {
            const path = std.fmt.allocPrint(testing.allocator, "{s}{s}", .{ self.path, suffix }) catch unreachable;
            defer testing.allocator.free(path);
            win.remove(path);
        }
        const wide = win.wide(self.directory) catch unreachable;
        defer std.heap.page_allocator.free(wide);
        std.debug.assert(win.RemoveDirectoryW(wide) != 0);
        testing.allocator.free(self.path);
        testing.allocator.free(self.directory);
    }
};
