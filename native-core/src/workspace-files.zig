const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const rpc = @import("protocol.zig");
const paths = @import("workspace-files-path.zig");
const Upload = @import("workspace-files-upload.zig").Upload;
const allocator = paths.allocator;

const Entry = struct { name: []const u8, path: []const u8, kind: []const u8, total_bytes: u64 };

pub const Service = struct {
    uploads: std.ArrayList(Upload) = .empty,
    next_id: u64 = 1,
    staged_bytes: u64 = 0,

    pub fn init() Service {
        return .{};
    }

    pub fn deinit(self: *Service) void {
        for (self.uploads.items) |*upload| upload.deinit();
        self.uploads.deinit(allocator);
        self.* = .{};
    }

    pub fn handle(self: *Service, req: anytype, emitter: *rpc.Emitter) !bool {
        if (!std.mem.startsWith(u8, req.method, "files.")) return false;
        if (std.mem.eql(u8, req.method, "files.list")) {
            try list(req, emitter);
        } else if (std.mem.eql(u8, req.method, "files.read")) {
            try read(req, emitter);
        } else if (std.mem.eql(u8, req.method, "files.save.begin")) {
            if (req.upload_id) |token| {
                if (token.len == 0 or token.len > 80) return error.InvalidUploadId;
                for (token) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_') return error.InvalidUploadId;
                for (self.uploads.items) |upload| if (std.mem.eql(u8, upload.id, token)) return error.DuplicateUpload;
            } else {
                // A caller-supplied token may equal a later generated number.
                // Skip it so each live stage remains unambiguous.
                var generated: [20]u8 = undefined;
                while (true) {
                    const candidate = try std.fmt.bufPrint(&generated, "{d}", .{self.next_id});
                    var duplicate = false;
                    for (self.uploads.items) |upload| if (std.mem.eql(u8, upload.id, candidate)) {
                        duplicate = true;
                    };
                    if (!duplicate) break;
                    self.next_id += 1;
                }
            }
            if (self.uploads.items.len >= 16 or req.total_bytes > paths.max_file_bytes or req.total_bytes > paths.max_file_bytes - self.staged_bytes) return error.StagingLimit;
            try self.uploads.ensureUnusedCapacity(allocator, 1);
            const upload = try Upload.begin(self.next_id, req.upload_id, req.root orelse return error.MissingRoot, req.path orelse return error.MissingPath, req.if_match orelse return error.MissingRevision, req.total_bytes);
            self.uploads.appendAssumeCapacity(upload);
            self.next_id += 1;
            self.staged_bytes += req.total_bytes;
            try reply(emitter, req.id, .{ .upload_id = upload.id });
        } else if (std.mem.eql(u8, req.method, "files.save.chunk")) {
            const index = try self.find(req.upload_id);
            try self.uploads.items[index].chunk(req.offset, req.data orelse return error.MissingInput);
            const upload = self.uploads.items[index];
            try reply(emitter, req.id, .{ .upload_id = upload.id, .received_bytes = upload.received_bytes });
        } else if (std.mem.eql(u8, req.method, "files.save.commit")) {
            const index = try self.find(req.upload_id);
            const result = self.uploads.items[index].commit() catch |err| {
                defer self.remove(index);
                if (err == error.FileSaveNeedsRecovery) {
                    const recovery = self.uploads.items[index].recovery_path orelse "";
                    const message = try std.fmt.allocPrint(allocator, "Save and restore failed. Original bytes are retained in {s}; restore this recovery file before editing again.", .{recovery});
                    defer allocator.free(message);
                    try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = false, .error_code = "FileSaveNeedsRecovery", .message = message, .recovery_path = recovery });
                    return true;
                }
                return err;
            };
            self.remove(index);
            try reply(emitter, req.id, .{ .revision = &result.revision, .total_bytes = result.total_bytes });
        } else if (std.mem.eql(u8, req.method, "files.save.cancel")) {
            self.remove(try self.find(req.upload_id));
            try reply(emitter, req.id, .{ .cancelled = true });
        } else return error.UnknownMethod;
        return true;
    }

    fn find(self: *Service, id: ?[]const u8) !usize {
        const requested = id orelse return error.MissingUpload;
        for (self.uploads.items, 0..) |upload, index| if (std.mem.eql(u8, upload.id, requested)) return index;
        return error.UnknownUpload;
    }

    fn remove(self: *Service, index: usize) void {
        var upload = self.uploads.swapRemove(index);
        self.staged_bytes -= upload.total_bytes;
        upload.deinit();
    }
};

fn reply(emitter: *rpc.Emitter, id: u64, result: anytype) !void {
    try emitter.trySend(.{ .version = rpc.version, .id = id, .ok = true, .result = result });
}

fn list(req: anytype, emitter: *rpc.Emitter) !void {
    const path = req.path orelse return error.MissingPath;
    var guard = try paths.Guard.init(req.root orelse return error.MissingRoot, path, true);
    defer guard.deinit();
    const separator: usize = if (guard.full[guard.full.len - 1] == '\\') 0 else 1;
    const pattern = try allocator.allocSentinel(u16, guard.full.len + separator + 1, 0);
    defer allocator.free(pattern);
    @memcpy(pattern[0..guard.full.len], guard.full);
    if (separator != 0) pattern[guard.full.len] = '\\';
    pattern[guard.full.len + separator] = '*';
    var data: c.WIN32_FIND_DATAW = undefined;
    const search = c.FindFirstFileW(pattern.ptr, &data);
    if (search == c.INVALID_HANDLE_VALUE) return paths.windowsError();
    defer _ = c.FindClose(search);
    var entries: std.ArrayList(Entry) = .empty;
    defer {
        for (entries.items) |entry| {
            allocator.free(entry.name);
            allocator.free(entry.path);
        }
        entries.deinit(allocator);
    }
    var position: u64 = 0;
    var next: ?u64 = null;
    var json_bytes: usize = 0;
    while (true) {
        const wide_name = std.mem.sliceTo(&data.cFileName, 0);
        const dot = std.mem.eql(u16, wide_name, &[_]u16{'.'}) or std.mem.eql(u16, wide_name, &[_]u16{ '.', '.' });
        if (!dot) {
            const name = std.unicode.utf16LeToUtf8Alloc(allocator, wide_name) catch return error.InvalidFileName;
            defer allocator.free(name);
            // Never expose stages as editable files, including another upload
            // owned by this same core process.
            if (!std.mem.startsWith(u8, name, ".slterm-ade-")) {
                if (position >= req.cursor) {
                    const relative = if (path.len == 0) try allocator.dupe(u8, name) else try std.fmt.allocPrint(allocator, "{s}/{s}", .{ path, name });
                    errdefer allocator.free(relative);
                    for (relative) |*byte| if (byte.* == '\\') {
                        byte.* = '/';
                    };
                    const entry: Entry = .{
                        .name = try allocator.dupe(u8, name),
                        .path = relative,
                        .kind = if (data.dwFileAttributes & c.FILE_ATTRIBUTE_REPARSE_POINT != 0) "symlink" else if (data.dwFileAttributes & c.FILE_ATTRIBUTE_DIRECTORY != 0) "directory" else "file",
                        .total_bytes = (@as(u64, data.nFileSizeHigh) << 32) | data.nFileSizeLow,
                    };
                    errdefer allocator.free(entry.name);
                    const serialized = try std.json.Stringify.valueAlloc(allocator, entry, .{});
                    defer allocator.free(serialized);
                    if (entries.items.len == 24 or (entries.items.len != 0 and json_bytes + serialized.len > 32 * 1024)) {
                        allocator.free(entry.name);
                        allocator.free(entry.path);
                        next = position;
                        break;
                    }
                    json_bytes += serialized.len;
                    try entries.append(allocator, entry);
                }
                position += 1;
            }
        }
        if (c.FindNextFileW(search, &data) == 0) {
            if (c.GetLastError() != c.ERROR_NO_MORE_FILES) return paths.windowsError();
            break;
        }
    }
    try reply(emitter, req.id, .{ .entries = entries.items, .next_cursor = next });
}

fn read(req: anytype, emitter: *rpc.Emitter) !void {
    const path = req.path orelse return error.MissingPath;
    if (path.len == 0) return error.NotFile;
    var guard = try paths.Guard.init(req.root orelse return error.MissingRoot, path, false);
    defer guard.deinit();
    const handle = try guard.openFile(c.GENERIC_READ, c.FILE_SHARE_READ);
    defer win.close(handle);
    const current = try paths.snapshot(handle);
    if (req.offset > current.total_bytes) return error.InvalidReadOffset;
    try paths.seek(handle, req.offset);
    var buffer: [paths.chunk_bytes]u8 = undefined;
    var received: c.DWORD = 0;
    if (c.ReadFile(handle, &buffer, buffer.len, &received, null) == 0) return paths.windowsError();
    var encoded: [std.base64.standard.Encoder.calcSize(paths.chunk_bytes)]u8 = undefined;
    const data = std.base64.standard.Encoder.encode(&encoded, buffer[0..received]);
    try reply(emitter, req.id, .{ .data = data, .offset = req.offset, .total_bytes = current.total_bytes, .revision = &current.revision, .eof = req.offset + received == current.total_bytes });
}
