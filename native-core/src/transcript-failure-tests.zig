const std = @import("std");
const archive = @import("transcript-store.zig");
const sqlite = @import("storage-sqlite.zig");
const win = @import("storage-win.zig");
const fixture = @import("transcript-test-fixture.zig");
const testing = std.testing;
const a = fixture.first_id;

test "SQLite full rolls back the raw chunk and sequence without claiming successful capture" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    var store = try archive.Store.open(temp.path);
    defer store.close();
    try store.create(a, "{}");
    _ = try store.append(a, 1, "before");
    const pages = try store.context.integer("PRAGMA page_count");
    const pragma = try std.fmt.allocPrintSentinel(testing.allocator, "PRAGMA max_page_count={d}", .{pages}, 0);
    defer testing.allocator.free(pragma);
    _ = try store.context.integer(pragma);
    const bytes = try testing.allocator.alloc(u8, archive.max_chunk_bytes);
    defer testing.allocator.free(bytes);
    @memset(bytes, 'x');
    try testing.expectError(error.SqliteDiskFull, store.append(a, 2, bytes));
    const meta = try store.metadata(a, testing.allocator);
    defer meta.deinit(testing.allocator);
    try testing.expect(!meta.finished and !meta.capture_complete);
    try testing.expectEqual(@as(u64, 1), meta.last_sequence);
    try testing.expectEqual(@as(u64, 6), meta.recorded_bytes);
    try store.finish(a, 1, 2, 0, "SqliteDiskFull");
    const failed = try store.metadata(a, testing.allocator);
    defer failed.deinit(testing.allocator);
    try testing.expect(!failed.process_eof and !failed.capture_complete);
}

test "query only and commit rejection never report a saved chunk or final EOF" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    var store = try archive.Store.open(temp.path);
    defer store.close();
    try store.create(a, "{}");
    try store.context.exec("PRAGMA query_only=ON");
    try testing.expectError(error.SqliteReadOnly, store.append(a, 1, "x"));
    try testing.expectError(error.SqliteReadOnly, store.finish(a, 0, 0, 0, null));
    try store.context.exec("PRAGMA query_only=OFF");
    const Hook = *const fn (*sqlite.Database, ?*const fn (?*anyopaque) callconv(.c) c_int, ?*anyopaque) callconv(.c) ?*anyopaque;
    const hook: Hook = @ptrCast(win.GetProcAddress(store.context.api.library, "sqlite3_commit_hook") orelse return error.SqliteSymbolMissing);
    _ = hook(store.context.db.?, rejectCommit, null);
    try testing.expectError(error.SqliteError, store.append(a, 1, "uncommitted"));
    try testing.expectError(error.SqliteError, store.finish(a, 0, 0, 0, null));
    _ = hook(store.context.db.?, null, null);
    const meta = try store.metadata(a, testing.allocator);
    defer meta.deinit(testing.allocator);
    try testing.expect(!meta.finished and !meta.process_eof);
    try testing.expectEqual(@as(u64, 0), meta.recorded_bytes);
    try testing.expectEqual(@as(u64, 0), meta.last_sequence);
}

fn rejectCommit(_: ?*anyopaque) callconv(.c) c_int {
    return 1;
}

test "foreign and future schemas are rejected without header or record changes" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    const api = try sqlite.Api.load();
    defer api.unload();
    const foreign = try api.open(temp.path, sqlite.read_write_create);
    try api.exec(foreign, "CREATE TABLE foreign_data(value TEXT)");
    try sqlite.check(api.close_v2(foreign));
    try testing.expectError(error.UnsupportedSchema, archive.Store.open(temp.path));
    const verify = try api.open(temp.path, sqlite.read_only);
    try testing.expectEqual(@as(i64, 0), try api.integer(verify, "PRAGMA user_version"));
    try api.expectText(verify, "PRAGMA journal_mode", "delete");
    try testing.expectEqual(@as(i64, 1), try api.integer(verify, "SELECT count(*) FROM sqlite_master WHERE name='foreign_data'"));
    try sqlite.check(api.close_v2(verify));

    const next = try fixture.Fixture.create();
    defer next.deinit();
    var store = try archive.Store.open(next.path);
    try store.create(a, "{\"safe\":true}");
    try store.context.exec("PRAGMA user_version=99");
    try testing.expectError(error.UnsupportedSchema, store.append(a, 1, "x"));
    try testing.expectError(error.UnsupportedSchema, store.metadata(a, testing.allocator));
    store.close();
    try testing.expectError(error.UnsupportedSchema, archive.Store.open(next.path));
    const future = try api.open(next.path, sqlite.read_only);
    defer _ = api.close_v2(future);
    try testing.expectEqual(@as(i64, 99), try api.integer(future, "PRAGMA user_version"));
    try api.expectText(future, "SELECT identity_json FROM transcript_runs", "{\"safe\":true}");
}

test "metadata alone exhausts a finite physical byte budget without a run count cap" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    var store = try archive.Store.openWithLimits(temp.path, .{ .per_run_bytes = 8, .aggregate_bytes = 16, .database_bytes = 64 * 1024 });
    defer store.close();
    const identity = try testing.allocator.alloc(u8, archive.types.max_identity_bytes);
    defer testing.allocator.free(identity);
    @memset(identity, 'x');
    @memcpy(identity[0..6], "{\"x\":\"");
    @memcpy(identity[identity.len - 2 ..], "\"}");
    var created: usize = 0;
    for (1..100) |index| {
        const run_id = try std.fmt.allocPrint(testing.allocator, "00000000-0000-4000-8000-{d:0>12}", .{index});
        defer testing.allocator.free(run_id);
        store.create(run_id, identity) catch |err| {
            try testing.expectEqual(error.SqliteDiskFull, err);
            break;
        };
        created += 1;
    }
    try testing.expect(created > 0 and created < 99);
    try testing.expect(try store.context.integer("PRAGMA page_count") * 4096 <= 64 * 1024);
}
