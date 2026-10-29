const std = @import("std");
pub const sqlite = @import("storage-sqlite.zig");
const win = @import("storage-win.zig");
const types = @import("transcript-types.zig");
const allocator = std.heap.page_allocator;

pub const Context = struct {
    api: sqlite.Api,
    db: ?*sqlite.Database,
    limits: types.Limits,
    bind_blob: *const fn (*sqlite.Statement, c_int, [*]const u8, c_int, ?*const fn (?*anyopaque) callconv(.c) void) callconv(.c) c_int,
    column_blob: *const fn (*sqlite.Statement, c_int) callconv(.c) ?[*]const u8,

    pub fn open(path: []const u8, limits: types.Limits) !Context {
        try limits.validate();
        if (!std.fs.path.isAbsolute(path) or std.mem.indexOfScalar(u8, path, 0) != null or !std.unicode.utf8ValidateSlice(path)) return error.InvalidDatabasePath;
        const api = try sqlite.Api.load();
        errdefer api.unload();
        const db = try api.open(path, sqlite.read_write_create);
        errdefer _ = api.close_v2(db);
        return .{
            .api = api,
            .db = db,
            .limits = limits,
            .bind_blob = @ptrCast(win.GetProcAddress(api.library, "sqlite3_bind_blob") orelse return error.SqliteSymbolMissing),
            .column_blob = @ptrCast(win.GetProcAddress(api.library, "sqlite3_column_blob") orelse return error.SqliteSymbolMissing),
        };
    }

    pub fn close(self: *Context) void {
        if (self.db) |db| {
            _ = self.api.close_v2(db);
            self.db = null;
            self.api.unload();
        }
    }

    pub fn prepare(self: *const Context, sql: [:0]const u8) !*sqlite.Statement {
        return self.api.prepare(self.db orelse return error.StoreClosed, sql);
    }

    pub fn exec(self: *const Context, sql: [:0]const u8) !void {
        try self.api.exec(self.db orelse return error.StoreClosed, sql);
    }

    pub fn integer(self: *const Context, sql: [:0]const u8) !i64 {
        return self.api.integer(self.db orelse return error.StoreClosed, sql);
    }

    pub fn bindText(self: *const Context, statement: *sqlite.Statement, index: c_int, bytes: []const u8) !void {
        try sqlite.check(self.api.bind_text(statement, index, bytes.ptr, @intCast(bytes.len), null));
    }

    pub fn bindInteger(self: *const Context, statement: *sqlite.Statement, index: c_int, value: u64) !void {
        if (value > std.math.maxInt(i64)) return error.TranscriptOverflow;
        try sqlite.check(self.api.bind_int64(statement, index, @intCast(value)));
    }

    pub fn stepDone(self: *const Context, statement: *sqlite.Statement) !void {
        const code = self.api.step(statement);
        if (code != sqlite.done) {
            try sqlite.check(code);
            return error.SqliteError;
        }
    }

    pub fn nonnegative(self: *const Context, statement: *sqlite.Statement, index: c_int) !u64 {
        if (self.api.column_type(statement, index) != 1) return error.CorruptDatabase;
        const value = self.api.column_int64(statement, index);
        if (value < 0) return error.CorruptDatabase;
        return @intCast(value);
    }

    pub fn text(self: *const Context, statement: *sqlite.Statement, index: c_int, owner: std.mem.Allocator, maximum: usize) ![]u8 {
        if (self.api.column_type(statement, index) != 3) return error.CorruptDatabase;
        const length = self.api.column_bytes(statement, index);
        if (length < 0 or length > maximum) return error.CorruptDatabase;
        const pointer = self.api.column_text(statement, index) orelse return error.CorruptDatabase;
        return owner.dupe(u8, pointer[0..@intCast(length)]);
    }

    pub fn pragmaLimit(self: *const Context) !void {
        const sql = try std.fmt.allocPrintSentinel(allocator, "PRAGMA max_page_count={d}", .{self.limits.database_bytes / 4096}, 0);
        defer allocator.free(sql);
        if (try self.integer(sql) > self.limits.database_bytes / 4096) return error.TranscriptStoreTooLarge;
    }
};
