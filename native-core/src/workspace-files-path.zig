const std = @import("std");
const win = @import("win.zig");
const c = win.c;
pub const allocator = std.heap.page_allocator;
pub const max_file_bytes = 8 * 1024 * 1024;
pub const chunk_bytes = 16 * 1024;

pub fn windowsError() anyerror {
    return switch (c.GetLastError()) {
        c.ERROR_FILE_NOT_FOUND, c.ERROR_PATH_NOT_FOUND => error.FileNotFound,
        c.ERROR_ACCESS_DENIED => error.AccessDenied,
        c.ERROR_SHARING_VIOLATION, c.ERROR_LOCK_VIOLATION => error.FileBusy,
        else => error.FileOperationFailed,
    };
}

pub fn validateRelative(path: []const u8) !void {
    if (path.len > 4096 or std.mem.indexOfScalar(u8, path, 0) != null) return error.InvalidPath;
    if (path.len == 0) return;
    var parts = std.mem.splitAny(u8, path, "/\\");
    while (parts.next()) |part| {
        if (part.len == 0 or std.mem.eql(u8, part, ".") or std.mem.eql(u8, part, "..")) return error.PathOutsideWorkspace;
        if (part[part.len - 1] == '.' or part[part.len - 1] == ' ') return error.InvalidPath;
        for (part) |byte| if (byte < 32 or std.mem.indexOfScalar(u8, ":<>\"|?*", byte) != null) return error.InvalidPath;
        const stem = part[0 .. std.mem.indexOfScalar(u8, part, '.') orelse part.len];
        for ([_][]const u8{ "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$" }) |reserved|
            if (std.ascii.eqlIgnoreCase(stem, reserved)) return error.InvalidPath;
        if (stem.len == 4 and (std.ascii.eqlIgnoreCase(stem[0..3], "COM") or std.ascii.eqlIgnoreCase(stem[0..3], "LPT")) and stem[3] >= '1' and stem[3] <= '9') return error.InvalidPath;
    }
}

// Pin every directory component while resolving and using the path. Opening
// reparse points themselves prevents a junction or symlink from escaping root.
pub const Guard = struct {
    full: [:0]u16,
    root_end: usize,
    parent_end: usize,
    handles: [128]c.HANDLE = @splat(null),
    count: usize = 0,

    pub fn init(root: []const u8, path: []const u8, directory: bool) !Guard {
        try validateRelative(path);
        if (root.len < 3 or root.len > 4096 or !std.ascii.isAlphabetic(root[0]) or root[1] != ':' or (root[2] != '\\' and root[2] != '/') or std.mem.indexOfScalar(u8, root, 0) != null) return error.InvalidRoot;
        const wide_root = try std.unicode.utf8ToUtf16LeAllocZ(allocator, root);
        defer allocator.free(wide_root);
        var buffer: [32768]u16 = undefined;
        const length = c.GetFullPathNameW(wide_root.ptr, buffer.len, &buffer, null);
        if (length == 0 or length >= buffer.len) return error.InvalidRoot;
        var end: usize = length;
        while (end > 3 and buffer[end - 1] == '\\') end -= 1;
        const relative = try std.unicode.utf8ToUtf16LeAlloc(allocator, path);
        defer allocator.free(relative);
        const separator: usize = if (relative.len != 0 and buffer[end - 1] != '\\') 1 else 0;
        const full = try allocator.allocSentinel(u16, 4 + end + separator + relative.len, 0);
        @memcpy(full[0..4], &[_]u16{ '\\', '\\', '?', '\\' });
        @memcpy(full[4 .. 4 + end], buffer[0..end]);
        if (separator != 0) full[4 + end] = '\\';
        for (relative, 0..) |unit, index| full[4 + end + separator + index] = if (unit == '/') '\\' else unit;
        const parent_end = if (directory) full.len else std.mem.lastIndexOfScalar(u16, full, '\\').?;
        var self: Guard = .{ .full = full, .root_end = 4 + end, .parent_end = parent_end };
        errdefer self.deinit();
        // Drive roots cannot be renamed; pin all subsequent ancestors and the
        // final parent. Keeping them open denies deletion while staging saves.
        var index: usize = 7;
        while (index <= parent_end) : (index += 1) {
            if (index != parent_end and full[index] != '\\') continue;
            if (index == 7 and parent_end > 7) continue;
            if (self.count == self.handles.len) return error.PathTooDeep;
            const saved = full[index];
            full[index] = 0;
            const handle = c.CreateFileW(full.ptr, c.FILE_READ_ATTRIBUTES, c.FILE_SHARE_READ, null, c.OPEN_EXISTING, c.FILE_FLAG_BACKUP_SEMANTICS | c.FILE_FLAG_OPEN_REPARSE_POINT, null);
            full[index] = saved;
            if (handle == c.INVALID_HANDLE_VALUE) return windowsError();
            self.handles[self.count] = handle;
            self.count += 1;
            var info: c.BY_HANDLE_FILE_INFORMATION = undefined;
            if (c.GetFileInformationByHandle(handle, &info) == 0) return windowsError();
            if (info.dwFileAttributes & c.FILE_ATTRIBUTE_REPARSE_POINT != 0) return error.ReparsePointBlocked;
            if (info.dwFileAttributes & c.FILE_ATTRIBUTE_DIRECTORY == 0) return error.NotDirectory;
        }
        return self;
    }

    pub fn deinit(self: *Guard) void {
        for (self.handles[0..self.count]) |handle| win.close(handle);
        allocator.free(self.full);
        self.count = 0;
    }

    pub fn openFile(self: *const Guard, access: c.DWORD, share: c.DWORD) !c.HANDLE {
        const handle = c.CreateFileW(self.full.ptr, access, share, null, c.OPEN_EXISTING, c.FILE_FLAG_OPEN_REPARSE_POINT | c.FILE_FLAG_SEQUENTIAL_SCAN, null);
        if (handle == c.INVALID_HANDLE_VALUE) return windowsError();
        errdefer win.close(handle);
        var info: c.BY_HANDLE_FILE_INFORMATION = undefined;
        if (c.GetFileInformationByHandle(handle, &info) == 0) return windowsError();
        if (info.dwFileAttributes & c.FILE_ATTRIBUTE_REPARSE_POINT != 0) return error.ReparsePointBlocked;
        if (info.dwFileAttributes & c.FILE_ATTRIBUTE_DIRECTORY != 0) return error.NotFile;
        return handle;
    }
};

pub const Snapshot = struct { revision: [64]u8, total_bytes: u64 };

pub fn snapshot(handle: c.HANDLE) !Snapshot {
    var size: c.LARGE_INTEGER = undefined;
    if (c.GetFileSizeEx(handle, &size) == 0) return windowsError();
    if (size.QuadPart < 0 or size.QuadPart > max_file_bytes) return error.FileTooLarge;
    try seek(handle, 0);
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    var buffer: [chunk_bytes]u8 = undefined;
    var total: u64 = 0;
    while (true) {
        var received: c.DWORD = 0;
        if (c.ReadFile(handle, &buffer, buffer.len, &received, null) == 0) return windowsError();
        if (received == 0) break;
        total += received;
        if (total > max_file_bytes) return error.FileTooLarge;
        hash.update(buffer[0..received]);
    }
    if (total != size.QuadPart) return error.RevisionConflict;
    var digest: [32]u8 = undefined;
    hash.final(&digest);
    return .{ .revision = std.fmt.bytesToHex(digest, .lower), .total_bytes = total };
}

pub fn seek(handle: c.HANDLE, offset: u64) !void {
    var distance: c.LARGE_INTEGER = undefined;
    distance.QuadPart = @intCast(offset);
    if (c.SetFilePointerEx(handle, distance, null, c.FILE_BEGIN) == 0) return windowsError();
}
