const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const paths = @import("workspace-files-path.zig");
const allocator = paths.allocator;

// A flushed original-byte copy survives an interrupted in-place save. Its ACL
// is supplied at creation, so the recovery copy never broadens file access.
pub const Recovery = struct {
    handle: c.HANDLE,
    relative_path: []const u8,
    keep: bool = false,

    pub fn create(original: c.HANDLE, guard: *const paths.Guard, id: []const u8) !Recovery {
        const descriptor = try securityDescriptor(original);
        defer allocator.free(descriptor);
        var security: c.SECURITY_ATTRIBUTES = .{ .nLength = @sizeOf(c.SECURITY_ATTRIBUTES), .lpSecurityDescriptor = descriptor.ptr, .bInheritHandle = 0 };
        const leaf = guard.full[guard.parent_end + 1 ..];
        var leaf_length = @min(leaf.len, 80);
        if (leaf_length != 0 and leaf[leaf_length - 1] >= 0xd800 and leaf[leaf_length - 1] <= 0xdbff) leaf_length -= 1;
        const name = try std.fmt.allocPrint(allocator, ".slterm-recovery-{d}-{s}-", .{ c.GetCurrentProcessId(), id });
        defer allocator.free(name);
        const wide_name = try std.unicode.utf8ToUtf16LeAlloc(allocator, name);
        defer allocator.free(wide_name);
        const full = try allocator.allocSentinel(u16, guard.parent_end + 1 + wide_name.len + leaf_length + 4, 0);
        defer allocator.free(full);
        @memcpy(full[0..guard.parent_end], guard.full[0..guard.parent_end]);
        full[guard.parent_end] = '\\';
        @memcpy(full[guard.parent_end + 1 ..][0..wide_name.len], wide_name);
        @memcpy(full[guard.parent_end + 1 + wide_name.len ..][0..leaf_length], leaf[0..leaf_length]);
        @memcpy(full[full.len - 4 ..], &[_]u16{ '.', 'b', 'a', 'k' });
        const relative_start = guard.root_end + @as(usize, if (full[guard.root_end] == '\\') 1 else 0);
        const relative_path = try std.unicode.utf16LeToUtf8Alloc(allocator, full[relative_start..]);
        errdefer allocator.free(relative_path);
        for (relative_path) |*byte| if (byte.* == '\\') {
            byte.* = '/';
        };
        const handle = c.CreateFileW(full.ptr, c.GENERIC_READ | c.GENERIC_WRITE | c.DELETE, 0, &security, c.CREATE_NEW, @as(c.DWORD, c.FILE_ATTRIBUTE_NORMAL) | c.FILE_FLAG_WRITE_THROUGH, null);
        if (handle == c.INVALID_HANDLE_VALUE) return error.RecoveryCreateFailed;
        var recovery: Recovery = .{ .handle = handle, .relative_path = relative_path };
        // The path allocation remains owned by the outer errdefer on failure.
        errdefer recovery.close();
        try copyAndFlush(original, handle);
        return recovery;
    }

    pub fn deinit(self: *Recovery) void {
        self.close();
        allocator.free(self.relative_path);
    }

    fn close(self: *Recovery) void {
        if (!self.keep) {
            var disposition: c.FILE_DISPOSITION_INFO = .{ .DeleteFileA = 1 };
            _ = c.SetFileInformationByHandle(self.handle, c.FileDispositionInfo, &disposition, @sizeOf(c.FILE_DISPOSITION_INFO));
        }
        win.close(self.handle);
    }
};

pub fn securityDescriptor(handle: c.HANDLE) ![]align(8) u8 {
    var needed: c.DWORD = 0;
    _ = c.GetKernelObjectSecurity(handle, c.DACL_SECURITY_INFORMATION, null, 0, &needed);
    if (needed == 0 or needed > 1024 * 1024) return error.RecoverySecurityFailed;
    const descriptor = try allocator.alignedAlloc(u8, .fromByteUnits(8), needed);
    errdefer allocator.free(descriptor);
    if (c.GetKernelObjectSecurity(handle, c.DACL_SECURITY_INFORMATION, descriptor.ptr, needed, &needed) == 0) return error.RecoverySecurityFailed;
    return descriptor;
}

pub fn copyAndFlush(source: c.HANDLE, destination: c.HANDLE) !void {
    try paths.seek(source, 0);
    try paths.seek(destination, 0);
    var buffer: [paths.chunk_bytes]u8 = undefined;
    var copied: u64 = 0;
    while (true) {
        var received: c.DWORD = 0;
        if (c.ReadFile(source, &buffer, buffer.len, &received, null) == 0) return error.SaveReadFailed;
        if (received == 0) break;
        copied += received;
        if (copied > paths.max_file_bytes) return error.FileTooLarge;
        try win.writeAll(destination, buffer[0..received]);
    }
    if (c.SetEndOfFile(destination) == 0) return error.SaveTruncateFailed;
    if (c.FlushFileBuffers(destination) == 0) return error.SaveFlushFailed;
}

test "flushed recovery preserves protected DACL and restores original bytes" {
    var temp: [32768]u16 = undefined;
    const temp_length = c.GetTempPathW(temp.len, &temp);
    try std.testing.expect(temp_length > 0 and temp_length < temp.len);
    const temp_utf8 = try std.unicode.utf16LeToUtf8Alloc(allocator, temp[0..temp_length]);
    defer allocator.free(temp_utf8);
    const root = try std.fmt.allocPrint(allocator, "{s}slterm-recovery-unit-{d}-{d}", .{ temp_utf8, c.GetCurrentProcessId(), c.GetTickCount64() });
    defer allocator.free(root);
    const wide_root = try std.unicode.utf8ToUtf16LeAllocZ(allocator, root);
    defer allocator.free(wide_root);
    try std.testing.expect(c.CreateDirectoryW(wide_root.ptr, null) != 0);
    defer _ = c.RemoveDirectoryW(wide_root.ptr);
    var guard = try paths.Guard.init(root, "bảo vệ.txt", false);
    defer guard.deinit();
    const original = c.CreateFileW(guard.full.ptr, c.GENERIC_READ | c.GENERIC_WRITE | c.WRITE_DAC, 0, null, c.CREATE_NEW, c.FILE_ATTRIBUTE_NORMAL, null);
    try std.testing.expect(original != c.INVALID_HANDLE_VALUE);
    defer {
        win.close(original);
        _ = c.DeleteFileW(guard.full.ptr);
    }
    try win.writeAll(original, "original Unicode bytes 日本語");
    const original_revision = try paths.snapshot(original);
    const initial = try securityDescriptor(original);
    defer allocator.free(initial);
    try std.testing.expect(c.SetKernelObjectSecurity(original, @as(c.DWORD, c.DACL_SECURITY_INFORMATION) | c.PROTECTED_DACL_SECURITY_INFORMATION, initial.ptr) != 0);
    const protected = try securityDescriptor(original);
    defer allocator.free(protected);
    var backup = try Recovery.create(original, &guard, "known-test-id");
    var backup_open = true;
    defer if (backup_open) backup.deinit();
    const backup_acl = try securityDescriptor(backup.handle);
    defer allocator.free(backup_acl);
    try std.testing.expectEqualSlices(u8, protected, backup_acl);
    try std.testing.expectEqualSlices(u8, &original_revision.revision, &(try paths.snapshot(backup.handle)).revision);
    try paths.seek(original, 0);
    try win.writeAll(original, "changed");
    try std.testing.expect(c.SetEndOfFile(original) != 0);
    try copyAndFlush(backup.handle, original);
    try std.testing.expectEqualSlices(u8, &original_revision.revision, &(try paths.snapshot(original)).revision);
    const recovery_path = try allocator.dupe(u8, backup.relative_path);
    defer allocator.free(recovery_path);
    backup.keep = true;
    backup.deinit();
    backup_open = false;
    var recovery_guard = try paths.Guard.init(root, recovery_path, false);
    defer recovery_guard.deinit();
    defer _ = c.DeleteFileW(recovery_guard.full.ptr);
    const retained = try recovery_guard.openFile(c.GENERIC_READ, c.FILE_SHARE_READ);
    defer win.close(retained);
    try std.testing.expectEqualSlices(u8, &original_revision.revision, &(try paths.snapshot(retained)).revision);
}
