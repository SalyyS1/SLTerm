const std = @import("std");
const rpc = @import("protocol.zig");
const c = @import("win.zig").c;
const storage = @import("storage.zig");
const chunk_bytes = 16 * 1024;

/// The core is the only writer of the ADE preferences database. Incomplete
/// uploads never enter SQLite and are discarded when the transport closes.
pub const Service = struct {
    store: ?storage.Store = null,
    upload: ?Upload = null,
    serial: u64 = 0,

    const Upload = struct { id: []u8, bytes: []u8, received: usize = 0, expected_revision: u64 };

    pub fn deinit(self: *Service) void {
        self.cancel();
        if (self.store) |*store| store.close();
        self.store = null;
    }

    fn cancel(self: *Service) void {
        if (self.upload) |upload| {
            rpc.allocator.free(upload.id);
            rpc.allocator.free(upload.bytes);
        }
        self.upload = null;
    }

    fn database(self: *Service) !*storage.Store {
        if (self.store == null) {
            const name = std.unicode.utf8ToUtf16LeStringLiteral("SLTERM_ADE_DATABASE");
            const size = c.GetEnvironmentVariableW(name, null, 0);
            if (size == 0 or size > 32768) return error.ProfileNotConfigured;
            const wide = try rpc.allocator.alloc(u16, size);
            defer rpc.allocator.free(wide);
            const length = c.GetEnvironmentVariableW(name, wide.ptr, size);
            if (length == 0 or length >= size) return error.ProfileNotConfigured;
            const path = try std.unicode.utf16LeToUtf8Alloc(rpc.allocator, wide[0..length]);
            defer rpc.allocator.free(path);
            self.store = try storage.Store.open(path);
        }
        return &self.store.?;
    }

    pub fn handle(self: *Service, req: rpc.Request, emitter: *rpc.Emitter) !bool {
        if (!std.mem.startsWith(u8, req.method, "preferences.")) return false;
        const store = try self.database();
        if (std.mem.eql(u8, req.method, "preferences.load")) {
            const doc = try store.load(rpc.allocator);
            defer if (doc) |value| value.deinit(rpc.allocator);
            const bytes = if (doc) |value| value.json else "";
            if (req.offset > bytes.len) return error.InvalidOffset;
            const start: usize = @intCast(req.offset);
            const end = @min(start + chunk_bytes, bytes.len);
            var encoded: [std.base64.standard.Encoder.calcSize(chunk_bytes)]u8 = undefined;
            try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = .{
                .data = std.base64.standard.Encoder.encode(&encoded, bytes[start..end]),
                .revision = if (doc) |value| value.revision else @as(u64, 0),
                .total_bytes = bytes.len, .offset = start, .eof = end == bytes.len,
            } });
        } else if (std.mem.eql(u8, req.method, "preferences.save.begin")) {
            if (self.upload != null) return error.UploadInProgress;
            if (req.total_bytes == 0 or req.total_bytes > storage.max_document_bytes) return error.DocumentTooLarge;
            const bytes = try rpc.allocator.alloc(u8, @intCast(req.total_bytes));
            errdefer rpc.allocator.free(bytes);
            self.serial += 1;
            const id = if (req.upload_id) |requested| blk: {
                if (requested.len == 0 or requested.len > 100) return error.InvalidUploadId;
                for (requested) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-') return error.InvalidUploadId;
                break :blk try rpc.allocator.dupe(u8, requested);
            } else try std.fmt.allocPrint(rpc.allocator, "preferences-{d}", .{self.serial});
            self.upload = .{ .id = id, .bytes = bytes, .expected_revision = req.expected_revision };
            errdefer self.cancel();
            try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = .{ .upload_id = id } });
        } else if (std.mem.eql(u8, req.method, "preferences.save.cancel")) {
            _ = try self.current(req.upload_id);
            self.cancel();
            try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = .{ .cancelled = true } });
        } else if (std.mem.eql(u8, req.method, "preferences.save.chunk")) {
            const upload = try self.current(req.upload_id);
            if (req.offset != upload.received) return error.InvalidOffset;
            const data = req.data orelse return error.MissingInput;
            const length = std.base64.standard.Decoder.calcSizeForSlice(data) catch return error.InvalidBase64;
            if (length == 0 or length > chunk_bytes or length > upload.bytes.len - upload.received) return error.InvalidChunk;
            std.base64.standard.Decoder.decode(upload.bytes[upload.received..][0..length], data) catch return error.InvalidBase64;
            upload.received += length;
            try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = .{ .received_bytes = upload.received } });
        } else if (std.mem.eql(u8, req.method, "preferences.save.commit")) {
            const upload = try self.current(req.upload_id);
            if (upload.received != upload.bytes.len) return error.IncompleteUpload;
            // Leave failed uploads available for cancellation; never report a
            // revision until SQLite has committed the matching document.
            const revision = try store.save(upload.bytes, upload.expected_revision);
            self.cancel();
            try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = .{ .revision = revision } });
        } else return error.UnknownMethod;
        return true;
    }

    fn current(self: *Service, id: ?[]const u8) !*Upload {
        const upload = if (self.upload) |*value| value else return error.UnknownUpload;
        if (!std.mem.eql(u8, upload.id, id orelse return error.UnknownUpload)) return error.UnknownUpload;
        return upload;
    }
};
