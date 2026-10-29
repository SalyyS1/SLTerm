const std = @import("std");
const rpc = @import("protocol.zig");
const c = @import("win.zig").c;
const archive = @import("transcript-store.zig");

/// Path ownership stays in the native host. Renderer requests identify runs,
/// never database paths, and cannot finalize a live process's archive.
pub const Service = struct {
    store: ?archive.Store = null,

    pub fn deinit(self: *Service) void {
        if (self.store) |*store| store.close();
        self.store = null;
    }

    pub fn database(self: *Service) !*archive.Store {
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
            if (!std.fs.path.isAbsolute(path)) return error.InvalidDatabasePath;
            const parent = std.fs.path.dirname(path) orelse return error.InvalidDatabasePath;
            const transcript_path = try std.fs.path.join(rpc.allocator, &.{ parent, "transcripts.sqlite3" });
            defer rpc.allocator.free(transcript_path);
            self.store = try archive.Store.open(transcript_path);
        }
        return &self.store.?;
    }

    pub fn handle(self: *Service, req: rpc.Request, emitter: *rpc.Emitter) !bool {
        if (!std.mem.startsWith(u8, req.method, "transcripts.")) return false;
        const store = try self.database();
        const run_id = req.run_id orelse return error.MissingRunId;
        if (std.mem.eql(u8, req.method, "transcripts.metadata")) {
            const metadata = try store.metadata(run_id, rpc.allocator);
            defer metadata.deinit(rpc.allocator);
            try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = metadata });
        } else if (std.mem.eql(u8, req.method, "transcripts.read")) {
            const chunk = try store.read(run_id, req.offset, rpc.allocator);
            defer chunk.deinit(rpc.allocator);
            var encoded: [std.base64.standard.Encoder.calcSize(archive.max_chunk_bytes)]u8 = undefined;
            try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = .{
                .data = std.base64.standard.Encoder.encode(&encoded, chunk.data),
                .offset = chunk.offset, .next_offset = chunk.next_offset,
                .sequence = chunk.sequence, .chunk_offset = chunk.chunk_offset, .eof = chunk.eof,
            } });
        } else return error.UnknownMethod;
        return true;
    }
};
