const std = @import("std");
const win = @import("storage-win.zig");

pub const Database = opaque {};
pub const Statement = opaque {};
const Backup = opaque {};
pub const ok = 0;
pub const row = 100;
pub const done = 101;
pub const read_only = 0x1;
pub const read_write_create = 0x2 | 0x4;

/// The Windows SQLite C ABI is resolved only from System32. No DLL is bundled.
pub const Api = struct {
    library: win.Handle,
    open_v2: *const fn ([*:0]const u8, *?*Database, c_int, ?[*:0]const u8) callconv(.c) c_int,
    close_v2: *const fn (*Database) callconv(.c) c_int,
    busy_timeout: *const fn (*Database, c_int) callconv(.c) c_int,
    prepare_v2: *const fn (*Database, [*:0]const u8, c_int, *?*Statement, ?*?[*:0]const u8) callconv(.c) c_int,
    step: *const fn (*Statement) callconv(.c) c_int,
    finalize: *const fn (*Statement) callconv(.c) c_int,
    bind_int64: *const fn (*Statement, c_int, i64) callconv(.c) c_int,
    bind_text: *const fn (*Statement, c_int, [*]const u8, c_int, ?*const fn (?*anyopaque) callconv(.c) void) callconv(.c) c_int,
    column_int64: *const fn (*Statement, c_int) callconv(.c) i64,
    column_text: *const fn (*Statement, c_int) callconv(.c) ?[*]const u8,
    column_bytes: *const fn (*Statement, c_int) callconv(.c) c_int,
    column_type: *const fn (*Statement, c_int) callconv(.c) c_int,
    backup_init: *const fn (*Database, [*:0]const u8, *Database, [*:0]const u8) callconv(.c) ?*Backup,
    backup_step: *const fn (*Backup, c_int) callconv(.c) c_int,
    backup_finish: *const fn (*Backup) callconv(.c) c_int,
    errcode: *const fn (*Database) callconv(.c) c_int,
    libversion: *const fn () callconv(.c) [*:0]const u8,

    pub fn load() !Api {
        const library = win.LoadLibraryExW(std.unicode.utf8ToUtf16LeStringLiteral("winsqlite3.dll"), null, 0x800) orelse return error.SqliteUnavailable;
        errdefer _ = win.FreeLibrary(library);
        var result: Api = undefined;
        result.library = library;
        inline for (@typeInfo(Api).@"struct".field_names) |name| {
            if (comptime !std.mem.eql(u8, name, "library")) {
                @field(result, name) = @ptrCast(win.GetProcAddress(library, "sqlite3_" ++ name) orelse return error.SqliteSymbolMissing);
            }
        }
        return result;
    }

    pub fn unload(self: *const Api) void {
        _ = win.FreeLibrary(self.library);
    }

    pub fn open(self: *const Api, path: []const u8, flags: c_int) !*Database {
        const path_z = try std.heap.page_allocator.dupeSentinel(u8, path, 0);
        defer std.heap.page_allocator.free(path_z);
        var database: ?*Database = null;
        const code = self.open_v2(path_z, &database, flags | 0x10000 | 0x40000, null); // FULLMUTEX | PRIVATECACHE
        errdefer if (database) |db| {
            _ = self.close_v2(db);
        };
        try check(code);
        const db = database orelse return error.SqliteError;
        try check(self.busy_timeout(db, 5000));
        return db;
    }

    pub fn prepare(self: *const Api, db: *Database, sql: [:0]const u8) !*Statement {
        var statement: ?*Statement = null;
        try check(self.prepare_v2(db, sql, @intCast(sql.len), &statement, null));
        return statement orelse error.SqliteError;
    }

    pub fn exec(self: *const Api, db: *Database, sql: [:0]const u8) !void {
        const statement = try self.prepare(db, sql);
        defer _ = self.finalize(statement);
        const code = self.step(statement);
        if (code != done) {
            try check(code);
            return error.SqliteError;
        }
    }

    pub fn integer(self: *const Api, db: *Database, sql: [:0]const u8) !i64 {
        const statement = try self.prepare(db, sql);
        defer _ = self.finalize(statement);
        const code = self.step(statement);
        if (code != row) {
            try check(code);
            return error.CorruptDatabase;
        }
        if (self.column_type(statement, 0) != 1) return error.CorruptDatabase;
        const value = self.column_int64(statement, 0);
        const final = self.step(statement);
        if (final != done) {
            try check(final);
            return error.CorruptDatabase;
        }
        return value;
    }

    pub fn expectText(self: *const Api, db: *Database, sql: [:0]const u8, expected: []const u8) !void {
        const statement = try self.prepare(db, sql);
        defer _ = self.finalize(statement);
        const code = self.step(statement);
        if (code != row) {
            try check(code);
            return error.UnsupportedSchema;
        }
        const bytes = self.column_text(statement, 0) orelse return error.UnsupportedSchema;
        const length = self.column_bytes(statement, 0);
        if (length < 0 or !std.mem.eql(u8, bytes[0..@intCast(length)], expected)) return error.UnsupportedSchema;
        const final = self.step(statement);
        if (final != done) {
            try check(final);
            return error.UnsupportedSchema;
        }
    }
};

pub fn check(code: c_int) !void {
    return switch (code & 0xff) {
        0 => {},
        5, 6 => error.SqliteBusy,
        7 => error.OutOfMemory,
        8 => error.SqliteReadOnly,
        10, 14 => error.SqliteIo,
        11, 26 => error.CorruptDatabase,
        13 => error.SqliteDiskFull,
        23 => error.SqliteReadOnly,
        else => error.SqliteError,
    };
}
