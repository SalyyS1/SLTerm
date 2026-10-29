const std = @import("std");
const win = @import("storage-win.zig");
const sql = @import("transcript-sql.zig");
const schema = @import("transcript-schema.zig");
const write = @import("transcript-write.zig");
const query = @import("transcript-read.zig");
pub const types = @import("transcript-types.zig");
pub const Limits = types.Limits;
pub const Metadata = types.Metadata;
pub const ReadResult = types.ReadResult;
pub const AppendResult = types.AppendResult;
pub const max_chunk_bytes = types.max_chunk_bytes;

/// One core-owned store serves all terminal readers. Move only before sharing a
/// pointer, then join those readers before close. All calls serialize on lock.
/// Each successful write includes a synchronous SQLite COMMIT; unfinished runs
/// survive close/reopen as incomplete and are never silently finalized.
pub const Store = struct {
    context: sql.Context,
    lock: usize = 0,

    pub fn open(absolute_db_path: []const u8) !Store {
        return openWithLimits(absolute_db_path, .{});
    }

    pub fn openWithLimits(absolute_db_path: []const u8, limits: Limits) !Store {
        var context = try sql.Context.open(absolute_db_path, limits);
        errdefer context.close();
        try schema.initialize(&context);
        return .{ .context = context };
    }

    pub fn close(self: *Store) void {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        self.context.close();
    }

    pub fn create(self: *Store, run_id: []const u8, identity_json: []const u8) !void {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        try write.create(&self.context, run_id, identity_json);
    }

    pub fn append(self: *Store, run_id: []const u8, sequence: u64, bytes: []const u8) !AppendResult {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        return write.append(&self.context, run_id, sequence, bytes);
    }

    pub fn finish(self: *Store, run_id: []const u8, exit_code: u32, last_sequence: u64, discarded_bytes: u64, stream_error: ?[]const u8) !void {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        try write.finish(&self.context, run_id, exit_code, last_sequence, discarded_bytes, stream_error);
    }

    pub fn metadata(self: *Store, run_id: []const u8, owner: std.mem.Allocator) !Metadata {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        try self.context.exec("BEGIN");
        defer self.context.exec("ROLLBACK") catch {};
        if (try schema.inspect(&self.context)) return error.UnsupportedSchema;
        return query.metadata(&self.context, run_id, owner);
    }

    /// Reads exact raw bytes without decoding Unicode/ANSI, ACKs, or processes.
    /// Each response stops at an original read boundary and is at most 16KiB.
    pub fn read(self: *Store, run_id: []const u8, offset: u64, owner: std.mem.Allocator) !ReadResult {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        try self.context.exec("BEGIN");
        defer self.context.exec("ROLLBACK") catch {};
        if (try schema.inspect(&self.context)) return error.UnsupportedSchema;
        return query.read(&self.context, run_id, offset, owner);
    }
};
