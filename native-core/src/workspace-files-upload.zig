const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const paths = @import("workspace-files-path.zig");
const allocator = paths.allocator;
const recovery_files = @import("workspace-files-recovery.zig");

pub const Upload = struct {
    id: []const u8,
    guard: paths.Guard,
    handle: c.HANDLE,
    expected: [64]u8,
    total_bytes: u64,
    received_bytes: u64 = 0,
    failed: bool = false,
    recovery_path: ?[]const u8 = null,

    pub fn begin(id: u64, token: ?[]const u8, root: []const u8, path: []const u8, expected: []const u8, total: u64) !Upload {
        if (path.len == 0) return error.NotFile;
        if (total > paths.max_file_bytes) return error.FileTooLarge;
        if (expected.len != 64) return error.InvalidRevision;
        for (expected) |byte| if (!std.ascii.isHex(byte)) return error.InvalidRevision;
        var guard = try paths.Guard.init(root, path, false);
        errdefer guard.deinit();
        const original = try guard.openFile(c.GENERIC_READ, c.FILE_SHARE_READ);
        defer win.close(original);
        const current = try paths.snapshot(original);
        if (!std.mem.eql(u8, &current.revision, expected)) return error.RevisionConflict;
        const id_text = if (token) |value| try allocator.dupe(u8, value) else try std.fmt.allocPrint(allocator, "{d}", .{id});
        errdefer allocator.free(id_text);
        const basename = try std.fmt.allocPrint(allocator, ".slterm-ade-{d}-{d}.tmp", .{ c.GetCurrentProcessId(), id });
        defer allocator.free(basename);
        const wide_name = try std.unicode.utf8ToUtf16LeAlloc(allocator, basename);
        defer allocator.free(wide_name);
        const temporary = try allocator.allocSentinel(u16, guard.parent_end + 1 + wide_name.len, 0);
        defer allocator.free(temporary);
        @memcpy(temporary[0..guard.parent_end], guard.full[0..guard.parent_end]);
        temporary[guard.parent_end] = '\\';
        @memcpy(temporary[guard.parent_end + 1 ..], wide_name);
        const descriptor = recovery_files.securityDescriptor(original) catch return error.StageSecurityFailed;
        defer allocator.free(descriptor);
        var security: c.SECURITY_ATTRIBUTES = .{ .nLength = @sizeOf(c.SECURITY_ATTRIBUTES), .lpSecurityDescriptor = descriptor.ptr, .bInheritHandle = 0 };
        const handle = c.CreateFileW(temporary.ptr, c.GENERIC_READ | c.GENERIC_WRITE | c.DELETE, 0, &security, c.CREATE_NEW, c.FILE_ATTRIBUTE_HIDDEN | c.FILE_ATTRIBUTE_TEMPORARY | c.FILE_FLAG_DELETE_ON_CLOSE, null);
        if (handle == c.INVALID_HANDLE_VALUE) return paths.windowsError();
        return .{ .id = id_text, .guard = guard, .handle = handle, .expected = expected[0..64].*, .total_bytes = total };
    }

    pub fn deinit(self: *Upload) void {
        win.close(self.handle);
        self.guard.deinit();
        allocator.free(self.id);
        if (self.recovery_path) |path| allocator.free(path);
    }

    pub fn chunk(self: *Upload, offset: u64, encoded: []const u8) !void {
        if (self.failed) return error.StageWriteFailed;
        if (offset != self.received_bytes) return error.InvalidUploadOffset;
        const decoded_length = std.base64.standard.Decoder.calcSizeForSlice(encoded) catch return error.InvalidBase64;
        if (decoded_length == 0 or decoded_length > paths.chunk_bytes) return error.InvalidChunkSize;
        if (decoded_length > self.total_bytes - self.received_bytes) return error.UploadTooLarge;
        var buffer: [paths.chunk_bytes]u8 = undefined;
        std.base64.standard.Decoder.decode(buffer[0..decoded_length], encoded) catch return error.InvalidBase64;
        // Advance only after every byte is written; failed partial writes make
        // the stage unusable and the caller cancels it instead of committing.
        win.writeAll(self.handle, buffer[0..decoded_length]) catch {
            self.failed = true;
            return error.StageWriteFailed;
        };
        self.received_bytes += decoded_length;
    }

    pub fn commit(self: *Upload) !paths.Snapshot {
        if (self.failed) return error.StageWriteFailed;
        if (self.received_bytes != self.total_bytes) return error.IncompleteUpload;
        if (c.FlushFileBuffers(self.handle) == 0) return error.StageFlushFailed;
        const replacement = try paths.snapshot(self.handle);
        const original = self.guard.openFile(c.GENERIC_READ | c.GENERIC_WRITE, 0) catch |err| {
            if (err == error.FileNotFound) return error.RevisionConflict;
            return err;
        };
        defer win.close(original);
        var original_info: c.BY_HANDLE_FILE_INFORMATION = undefined;
        if (c.GetFileInformationByHandle(original, &original_info) == 0) return paths.windowsError();
        if (original_info.nNumberOfLinks > 1) return error.HardLinkedFileBlocked;
        const current = try paths.snapshot(original);
        if (!std.mem.eql(u8, &current.revision, &self.expected)) return error.RevisionConflict;
        // Windows atomic replacement requires delete sharing and would reopen
        // a competing-rename race after this hash check. Keep the original
        // exclusively open instead, and flush a recoverable original copy
        // before touching its bytes. The original identity and ACL stay intact.
        var backup = try recovery_files.Recovery.create(original, &self.guard, self.id);
        defer backup.deinit();
        self.recovery_path = try allocator.dupe(u8, backup.relative_path);
        backup.keep = true;
        recovery_files.copyAndFlush(self.handle, original) catch {
            recovery_files.copyAndFlush(backup.handle, original) catch return error.FileSaveNeedsRecovery;
            backup.keep = false;
            allocator.free(self.recovery_path.?);
            self.recovery_path = null;
            return error.FileSaveFailedRestored;
        };
        backup.keep = false;
        allocator.free(self.recovery_path.?);
        self.recovery_path = null;
        return replacement;
    }
};
