const std = @import("std");
const sqlite = @import("storage-sqlite.zig");
const backup = @import("storage-backup.zig");
const win = @import("storage-win.zig");
const allocator = std.heap.page_allocator;

pub const max_document_bytes = 1024 * 1024;
pub const schema_version = 1;
pub const document_version = 1;
const application_id = 0x534c4144; // SLAD: isolated ADE profile, never Electron.
const schema_sql = "CREATE TABLE ade_settings (id INTEGER PRIMARY KEY CHECK(id=1), document_version INTEGER NOT NULL CHECK(document_version=1), revision INTEGER NOT NULL CHECK(revision>0), document TEXT NOT NULL CHECK(length(CAST(document AS BLOB))<=1048576))";

pub const Document = struct {
    json: []u8,
    revision: u64,
    version: u32 = document_version,

    pub fn deinit(self: Document, owner: std.mem.Allocator) void {
        owner.free(self.json);
    }
};

/// Owns one isolated ADE database. The parent directory must already exist.
/// The latest successful pre-write snapshot is <path>.previous. Methods are
/// serialized; callers must finish using the Store before close or moving it.
pub const Store = struct {
    api: sqlite.Api,
    db: ?*sqlite.Database,
    path: []u8,
    previous_path: []u8,
    lock: usize = 0,

    pub fn open(path: []const u8) !Store {
        if (!std.fs.path.isAbsolute(path) or std.mem.indexOfScalar(u8, path, 0) != null or !std.unicode.utf8ValidateSlice(path)) return error.InvalidDatabasePath;
        const owned_path = try allocator.dupe(u8, path);
        errdefer allocator.free(owned_path);
        const previous = try std.fmt.allocPrint(allocator, "{s}.previous", .{path});
        errdefer allocator.free(previous);
        const api = try sqlite.Api.load();
        errdefer api.unload();
        const db = try api.open(path, sqlite.read_write_create);
        errdefer _ = api.close_v2(db);
        var self: Store = .{ .api = api, .db = db, .path = owned_path, .previous_path = previous };
        const fresh = try self.inspectSchema();
        try api.exec(db, "PRAGMA synchronous=FULL");
        if (fresh) {
            try api.exec(db, "BEGIN IMMEDIATE");
            errdefer api.exec(db, "ROLLBACK") catch {};
            // Another opener may have initialized while this one waited.
            if (try self.inspectSchema()) {
                try backup.create(&api, path, previous);
                try api.exec(db, schema_sql);
                try api.exec(db, "PRAGMA application_id=1397506372");
                try api.exec(db, "PRAGMA user_version=1");
            }
            try api.exec(db, "COMMIT");
        }
        // Changing journal mode mutates the database header, so first preserve
        // its committed state. The data/schema transactions have their own backup.
        api.expectText(db, "PRAGMA journal_mode", "wal") catch |err| {
            if (err != error.UnsupportedSchema) return err;
            try api.exec(db, "BEGIN IMMEDIATE");
            errdefer api.exec(db, "ROLLBACK") catch {};
            if (try self.inspectSchema()) return error.UnsupportedSchema;
            try backup.create(&api, path, previous);
            try api.exec(db, "COMMIT");
            try api.expectText(db, "PRAGMA journal_mode=WAL", "wal");
        };
        if (try api.integer(db, "PRAGMA synchronous") != 2) return error.SqliteError;
        return self;
    }

    pub fn close(self: *Store) void {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        if (self.db) |db| {
            _ = self.api.close_v2(db);
            self.db = null;
            self.api.unload();
            allocator.free(self.path);
            allocator.free(self.previous_path);
        }
    }

    pub fn sqliteVersion(self: *const Store) []const u8 {
        return std.mem.span(self.api.libversion());
    }

    pub fn load(self: *Store, owner: std.mem.Allocator) !?Document {
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        const db = self.db orelse return error.StoreClosed;
        try self.api.exec(db, "BEGIN");
        defer self.api.exec(db, "ROLLBACK") catch {};
        if (try self.inspectSchema()) return error.UnsupportedSchema;
        return self.readDocument(owner);
    }

    fn readDocument(self: *const Store, owner: std.mem.Allocator) !?Document {
        const db = self.db orelse return error.StoreClosed;
        const statement = try self.api.prepare(db, "SELECT document_version,revision,document FROM ade_settings WHERE id=1");
        defer _ = self.api.finalize(statement);
        const code = self.api.step(statement);
        if (code == sqlite.done) return null;
        if (code != sqlite.row) {
            try sqlite.check(code);
            return error.CorruptDatabase;
        }
        if (self.api.column_type(statement, 0) != 1 or self.api.column_int64(statement, 0) != document_version or self.api.column_type(statement, 1) != 1 or self.api.column_type(statement, 2) != 3) return error.CorruptDatabase;
        const revision = self.api.column_int64(statement, 1);
        const length = self.api.column_bytes(statement, 2);
        if (revision < 1 or length < 1 or length > max_document_bytes) return error.CorruptDatabase;
        const pointer = self.api.column_text(statement, 2) orelse return error.CorruptDatabase;
        const json = try owner.dupe(u8, pointer[0..@intCast(length)]);
        errdefer owner.free(json);
        if (!try std.json.validate(owner, json)) return error.CorruptDatabase;
        const final = self.api.step(statement);
        if (final != sqlite.done) {
            try sqlite.check(final);
            return error.CorruptDatabase;
        }
        return .{ .json = json, .revision = @intCast(revision) };
    }

    /// if_match=0 creates the first document. A stale revision never overwrites.
    /// Success is returned only after backup publication and SQLite COMMIT.
    pub fn save(self: *Store, json: []const u8, if_match: u64) !u64 {
        if (json.len > max_document_bytes) return error.DocumentTooLarge;
        if (!try std.json.validate(allocator, json)) return error.InvalidDocument;
        win.AcquireSRWLockExclusive(&self.lock);
        defer win.ReleaseSRWLockExclusive(&self.lock);
        const db = self.db orelse return error.StoreClosed;
        try self.api.exec(db, "BEGIN IMMEDIATE");
        errdefer self.api.exec(db, "ROLLBACK") catch {};
        if (try self.inspectSchema()) return error.UnsupportedSchema;
        const existing = try self.readDocument(allocator);
        defer if (existing) |document| document.deinit(allocator);
        const revision = if (existing) |document| document.revision else 0;
        if (revision != if_match) return error.RevisionConflict;
        if (revision == std.math.maxInt(i64)) return error.RevisionOverflow;
        try backup.create(&self.api, self.path, self.previous_path);
        const statement = try self.api.prepare(db, "INSERT OR REPLACE INTO ade_settings(id,document_version,revision,document) VALUES(1,1,?,?)");
        defer _ = self.api.finalize(statement);
        try sqlite.check(self.api.bind_int64(statement, 1, @intCast(revision + 1)));
        try sqlite.check(self.api.bind_text(statement, 2, json.ptr, @intCast(json.len), null));
        const code = self.api.step(statement);
        if (code != sqlite.done) {
            try sqlite.check(code);
            return error.SqliteError;
        }
        try self.api.exec(db, "COMMIT");
        return @intCast(revision + 1);
    }

    fn inspectSchema(self: *const Store) !bool {
        const db = self.db orelse return error.StoreClosed;
        const version = try self.api.integer(db, "PRAGMA user_version");
        const identity = try self.api.integer(db, "PRAGMA application_id");
        const objects = try self.api.integer(db, "SELECT count(*) FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'");
        if (version == 0 and identity == 0 and objects == 0) return true;
        if (version != schema_version or identity != application_id or objects != 1) return error.UnsupportedSchema;
        try self.api.expectText(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='ade_settings'", schema_sql);
        return false;
    }
};
