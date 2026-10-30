const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const paths = @import("workspace-files-path.zig");
const a = std.heap.page_allocator;
pub const Guard = paths.Guard;

pub fn canonical(guard: *const Guard) ![]u8 {
    if (guard.count == 0) return error.InvalidRoot;
    var buffer: [32768]u16 = undefined;
    const len = c.GetFinalPathNameByHandleW(guard.handles[guard.count - 1], &buffer, buffer.len, 0);
    if (len < 7 or len >= buffer.len or !std.mem.eql(u16, buffer[0..4], &.{ '\\', '\\', '?', '\\' })) return error.InvalidRoot;
    return std.unicode.utf16LeToUtf8Alloc(a, buffer[4..len]);
}

pub fn equal(first: []const u8, second: []const u8) bool {
    const left = std.unicode.utf8ToUtf16LeAlloc(a, first) catch return false;
    defer a.free(left);
    const right = std.unicode.utf8ToUtf16LeAlloc(a, second) catch return false;
    defer a.free(right);
    for (left) |*ch| if (ch.* == '/') {
        ch.* = '\\';
    };
    for (right) |*ch| if (ch.* == '/') {
        ch.* = '\\';
    };
    return c.CompareStringOrdinal(left.ptr, @intCast(left.len), right.ptr, @intCast(right.len), c.TRUE) == c.CSTR_EQUAL;
}

pub fn exists(path: []const u8) !bool {
    const wide = try std.unicode.utf8ToUtf16LeAllocZ(a, path);
    defer a.free(wide);
    const attrs = c.GetFileAttributesW(wide.ptr);
    if (attrs == c.INVALID_FILE_ATTRIBUTES) {
        const err = paths.windowsError();
        if (err == error.FileNotFound) return false;
        return err;
    }
    if (attrs & c.FILE_ATTRIBUTE_REPARSE_POINT != 0) return error.ReparsePointBlocked;
    return true;
}

pub fn mkdir(path: []const u8) !void {
    const wide = try std.unicode.utf8ToUtf16LeAllocZ(a, path);
    defer a.free(wide);
    if (c.CreateDirectoryW(wide.ptr, null) == 0) return paths.windowsError();
}

pub fn uuid(value: []const u8) ![36]u8 {
    if (value.len != 36) return error.InvalidTaskId;
    var out: [36]u8 = undefined;
    for (value, 0..) |ch, i| {
        if (i == 8 or i == 13 or i == 18 or i == 23) {
            if (ch != '-') return error.InvalidTaskId;
        } else if (!std.ascii.isHex(ch)) return error.InvalidTaskId;
        out[i] = std.ascii.toLower(ch);
    }
    return out;
}

pub fn revision(value: []const u8) !void {
    if (value.len != 40 and value.len != 64) return error.InvalidBaseRevision;
    for (value) |ch| if (!std.ascii.isHex(ch) or std.ascii.isUpper(ch)) return error.InvalidBaseRevision;
}

pub const Receipt = struct { version: u32 = 1, root: []const u8, path: []const u8, branch: []const u8, base_revision: []const u8, complete: bool = false };

/// An exclusive writer handle also serializes separate core processes. Files
/// stay in Git's common metadata, never in the checked-out task directory.
pub const ReceiptFile = struct {
    handle: c.HANDLE,
    pub fn open(directory: []const u8, name: []const u8, create: bool) !ReceiptFile {
        var guard = try Guard.init(directory, name, false);
        defer guard.deinit();
        const access: c.DWORD = if (create) c.GENERIC_READ | c.GENERIC_WRITE else c.GENERIC_READ;
        const handle = c.CreateFileW(guard.full.ptr, access, c.FILE_SHARE_READ, null, if (create) c.CREATE_NEW else c.OPEN_EXISTING, c.FILE_FLAG_OPEN_REPARSE_POINT, null);
        if (handle == c.INVALID_HANDLE_VALUE) return paths.windowsError();
        errdefer win.close(handle);
        var info: c.BY_HANDLE_FILE_INFORMATION = undefined;
        if (c.GetFileInformationByHandle(handle, &info) == 0) return paths.windowsError();
        if (info.dwFileAttributes & (c.FILE_ATTRIBUTE_REPARSE_POINT | c.FILE_ATTRIBUTE_DIRECTORY) != 0 or info.nNumberOfLinks != 1) return error.InvalidWorktreeReceipt;
        return .{ .handle = handle };
    }
    pub fn close(self: ReceiptFile) void {
        win.close(self.handle);
    }
    pub fn read(self: ReceiptFile) !std.json.Parsed(Receipt) {
        var buffer: [16384]u8 = undefined;
        var size: c.LARGE_INTEGER = undefined;
        if (c.GetFileSizeEx(self.handle, &size) == 0 or size.QuadPart < 1 or size.QuadPart > buffer.len) return error.InvalidWorktreeReceipt;
        var got: c.DWORD = 0;
        if (c.ReadFile(self.handle, &buffer, @intCast(size.QuadPart), &got, null) == 0 or got != size.QuadPart) return error.InvalidWorktreeReceipt;
        return std.json.parseFromSlice(Receipt, a, buffer[0..got], .{ .allocate = .alloc_always }) catch error.InvalidWorktreeReceipt;
    }
    pub fn write(self: ReceiptFile, value: Receipt) !void {
        const json = try std.json.Stringify.valueAlloc(a, value, .{});
        defer a.free(json);
        const beginning: c.LARGE_INTEGER = .{ .QuadPart = 0 };
        if (c.SetFilePointerEx(self.handle, beginning, null, c.FILE_BEGIN) == 0) return error.WorktreeReceiptWriteFailed;
        try win.writeAll(self.handle, json);
        if (c.SetEndOfFile(self.handle) == 0) return error.WorktreeReceiptWriteFailed;
        if (c.FlushFileBuffers(self.handle) == 0) return error.WorktreeReceiptFlushFailed;
    }
};

test "task IDs are canonical UUIDs and never path fragments" {
    try std.testing.expectEqualStrings("a82a2720-b33d-42ed-8a99-0123456789ab", &(try uuid("A82A2720-B33D-42ED-8A99-0123456789AB")));
    try std.testing.expectError(error.InvalidTaskId, uuid("../unsafe"));
    try std.testing.expectError(error.InvalidTaskId, uuid("a82a2720/b33d-42ed-8a99-0123456789ab"));
}
