const std = @import("std");
const storage = @import("storage.zig");
const sqlite = @import("storage-sqlite.zig");
const win = @import("storage-win.zig");
const testing = std.testing;
var serial = std.atomic.Value(u64).init(0);

const Fixture = struct {
    directory: []u8,
    path: []u8,

    fn create() !Fixture {
        var buffer: [32768]u16 = undefined;
        const length = win.GetTempPathW(buffer.len, &buffer);
        if (length == 0 or length >= buffer.len) return error.TemporaryDirectoryFailed;
        const parent = try std.unicode.utf16LeToUtf8Alloc(testing.allocator, buffer[0..length]);
        defer testing.allocator.free(parent);
        const directory = try std.fmt.allocPrint(testing.allocator, "{s}slterm-ade-storage-{d}-{d}-{d}", .{ parent, win.GetCurrentProcessId(), win.GetTickCount64(), serial.fetchAdd(1, .monotonic) });
        errdefer testing.allocator.free(directory);
        const value = try win.wide(directory);
        defer std.heap.page_allocator.free(value);
        if (win.CreateDirectoryW(value, null) == 0) return error.TemporaryDirectoryFailed;
        const path = try std.fmt.allocPrint(testing.allocator, "{s}\\settings-kiểm-tra.sqlite3", .{directory});
        return .{ .directory = directory, .path = path };
    }

    fn deinit(self: Fixture) void {
        for ([_][]const u8{ "", "-wal", "-shm", "-journal", ".previous", ".previous-wal", ".previous-shm", ".previous-journal" }) |suffix| {
            const path = std.fmt.allocPrint(testing.allocator, "{s}{s}", .{ self.path, suffix }) catch unreachable;
            defer testing.allocator.free(path);
            win.remove(path);
        }
        const directory = win.wide(self.directory) catch unreachable;
        defer std.heap.page_allocator.free(directory);
        std.debug.assert(win.RemoveDirectoryW(directory) != 0);
        testing.allocator.free(self.path);
        testing.allocator.free(self.directory);
    }
};

fn expectDocument(store: *storage.Store, expected: []const u8, revision: u64) !void {
    const document = (try store.load(testing.allocator)) orelse return error.MissingDocument;
    defer document.deinit(testing.allocator);
    try testing.expectEqual(revision, document.revision);
    try testing.expectEqual(@as(u32, 1), document.version);
    try testing.expectEqualStrings(expected, document.json);
}

fn expectBackup(store: *storage.Store, json: ?[]const u8, revision: i64) !void {
    const db = try store.api.open(store.previous_path, sqlite.read_only);
    defer _ = store.api.close_v2(db);
    try testing.expectEqual(revision, try store.api.integer(db, "SELECT COALESCE((SELECT revision FROM ade_settings WHERE id=1),0)"));
    if (json) |expected| try store.api.expectText(db, "SELECT document FROM ade_settings WHERE id=1", expected);
    try store.api.expectText(db, "PRAGMA quick_check", "ok");
}

test "real System32 SQLite persists Unicode settings and preserves exact previous revision" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    defer store.close();
    std.debug.print("System32 winsqlite3 sqlite3_libversion={s}\n", .{store.sqliteVersion()});
    try store.api.expectText(store.db.?, "PRAGMA journal_mode", "wal");
    try testing.expectEqual(@as(i64, 2), try store.api.integer(store.db.?, "PRAGMA synchronous"));
    try testing.expect(try store.load(testing.allocator) == null);
    const first = "{\"version\":1,\"theme\":\"ánh sáng\",\"workspace\":[1,2]}";
    const second = "{\"version\":1,\"theme\":\"dark\",\"workspace\":[2,1]}";
    try testing.expectEqual(@as(u64, 1), try store.save(first, 0));
    try expectBackup(&store, null, 0);
    store.close();
    store = try storage.Store.open(fixture.path);
    try expectDocument(&store, first, 1);
    try testing.expectEqual(@as(u64, 2), try store.save(second, 1));
    try expectBackup(&store, first, 1);
    try testing.expectError(error.RevisionConflict, store.save(first, 1));
    try expectDocument(&store, second, 2);
    try expectBackup(&store, first, 1);
}

test "independent writers use compare and swap and busy is an explicit failure" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var first = try storage.Store.open(fixture.path);
    defer first.close();
    var second = try storage.Store.open(fixture.path);
    defer second.close();
    _ = try first.save("{\"writer\":1}", 0);
    try testing.expectError(error.RevisionConflict, second.save("{\"writer\":2}", 0));
    _ = try second.save("{\"writer\":2}", 1);
    try expectDocument(&first, "{\"writer\":2}", 2);
    try sqlite.check(second.api.busy_timeout(second.db.?, 1));
    try first.api.exec(first.db.?, "BEGIN IMMEDIATE");
    defer first.api.exec(first.db.?, "ROLLBACK") catch {};
    try testing.expectError(error.SqliteBusy, second.save("{}", 2));
}

test "unsupported schema and foreign databases are rejected before writes" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    _ = try store.save("{\"safe\":true}", 0);
    try store.api.exec(store.db.?, "PRAGMA user_version=9");
    try testing.expectError(error.UnsupportedSchema, store.save("{}", 1));
    try testing.expectError(error.UnsupportedSchema, store.load(testing.allocator));
    store.close();
    try testing.expectError(error.UnsupportedSchema, storage.Store.open(fixture.path));
    const api = try sqlite.Api.load();
    defer api.unload();
    const db = try api.open(fixture.path, sqlite.read_only);
    defer _ = api.close_v2(db);
    try testing.expectEqual(@as(i64, 9), try api.integer(db, "PRAGMA user_version"));
    try api.expectText(db, "SELECT document FROM ade_settings", "{\"safe\":true}");
}

test "foreign empty identity cannot be mistaken for a new ADE database" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    const api = try sqlite.Api.load();
    defer api.unload();
    const db = try api.open(fixture.path, sqlite.read_write_create);
    try api.exec(db, "CREATE TABLE unrelated(value TEXT)");
    try sqlite.check(api.close_v2(db));
    try testing.expectError(error.UnsupportedSchema, storage.Store.open(fixture.path));
    const verify = try api.open(fixture.path, sqlite.read_only);
    defer _ = api.close_v2(verify);
    try testing.expectEqual(@as(i64, 0), try api.integer(verify, "PRAGMA user_version"));
    try api.expectText(verify, "PRAGMA journal_mode", "delete");
    try testing.expectEqual(@as(i64, 1), try api.integer(verify, "SELECT count(*) FROM sqlite_master WHERE name='unrelated'"));
}

test "failed backup publication preserves existing backup and document" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    defer store.close();
    _ = try store.save("{\"before\":true}", 0);
    const previous = try win.wide(store.previous_path);
    defer std.heap.page_allocator.free(previous);
    // Hold the real previous backup without FILE_SHARE_DELETE so publication
    // fails at MoveFileExW while the old snapshot remains available to read.
    const held = win.CreateFileW(previous, 0x80000000, 0x1, null, 3, 0x80, null) orelse return error.BackupOpenFailed;
    if (@intFromPtr(held) == std.math.maxInt(usize)) return error.BackupOpenFailed;
    defer _ = win.CloseHandle(held);
    try testing.expectError(error.BackupPublishFailed, store.save("{\"after\":true}", 1));
    try expectDocument(&store, "{\"before\":true}", 1);
    try expectBackup(&store, null, 0);
}

test "read only SQLite failure invalid JSON and oversized document never succeed" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    defer store.close();
    _ = try store.save("{}", 0);
    try testing.expectError(error.InvalidDocument, store.save("{bad", 1));
    const large = try testing.allocator.alloc(u8, storage.max_document_bytes + 1);
    defer testing.allocator.free(large);
    @memset(large, ' ');
    try testing.expectError(error.DocumentTooLarge, store.save(large, 1));
    try store.api.exec(store.db.?, "PRAGMA query_only=ON");
    try testing.expectError(error.SqliteReadOnly, store.save("{\"changed\":true}", 1));
    try expectDocument(&store, "{}", 1);
    try testing.expectError(error.InvalidDatabasePath, storage.Store.open("relative.sqlite3"));
}

test "SQLite disk full is rolled back and reported" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    defer store.close();
    _ = try store.save("{\"before\":true}", 0);
    // WAL writes can fail on step, before COMMIT; either boundary must fail.
    // max_page_count makes a real SQLite SQLITE_FULL without filling the disk.
    const pages = try store.api.integer(store.db.?, "PRAGMA page_count");
    const sql = try std.fmt.allocPrintSentinel(testing.allocator, "PRAGMA max_page_count={d}", .{pages}, 0);
    defer testing.allocator.free(sql);
    _ = try store.api.integer(store.db.?, sql);
    const json = try testing.allocator.alloc(u8, 128 * 1024);
    defer testing.allocator.free(json);
    @memset(json, 'x');
    json[0] = '"';
    json[json.len - 1] = '"';
    try testing.expectError(error.SqliteDiskFull, store.save(json, 1));
    try expectDocument(&store, "{\"before\":true}", 1);
    try expectBackup(&store, "{\"before\":true}", 1);
}

fn rejectCommit(_: ?*anyopaque) callconv(.c) c_int {
    return 1;
}

test "real SQLite commit rejection never reports a saved revision" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    defer store.close();
    _ = try store.save("{\"before\":true}", 0);
    const Hook = *const fn (*sqlite.Database, ?*const fn (?*anyopaque) callconv(.c) c_int, ?*anyopaque) callconv(.c) ?*anyopaque;
    const commit_hook: Hook = @ptrCast(win.GetProcAddress(store.api.library, "sqlite3_commit_hook") orelse return error.SqliteSymbolMissing);
    _ = commit_hook(store.db.?, rejectCommit, null);
    defer _ = commit_hook(store.db.?, null, null);
    try testing.expectError(error.SqliteError, store.save("{\"after\":true}", 1));
    try expectDocument(&store, "{\"before\":true}", 1);
    try expectBackup(&store, "{\"before\":true}", 1);
}

test "corrupt stored documents preserve data and disable writes" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    defer store.close();
    _ = try store.save("{}", 0);
    try store.api.exec(store.db.?, "UPDATE ade_settings SET document='{invalid' WHERE id=1");
    try testing.expectError(error.CorruptDatabase, store.load(testing.allocator));
    try testing.expectError(error.CorruptDatabase, store.save("{}", 1));
    try store.api.expectText(store.db.?, "SELECT document FROM ade_settings", "{invalid");
}

test "exactly one MiB is accepted and a closed store fails explicitly" {
    const fixture = try Fixture.create();
    defer fixture.deinit();
    var store = try storage.Store.open(fixture.path);
    defer store.close();
    const json = try testing.allocator.alloc(u8, storage.max_document_bytes);
    defer testing.allocator.free(json);
    @memset(json, 'x');
    json[0] = '"';
    json[json.len - 1] = '"';
    try testing.expectEqual(@as(u64, 1), try store.save(json, 0));
    try expectDocument(&store, json, 1);
    store.close();
    try testing.expectError(error.StoreClosed, store.load(testing.allocator));
    try testing.expectError(error.StoreClosed, store.save("{}", 1));
}
