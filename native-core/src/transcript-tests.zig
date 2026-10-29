const std = @import("std");
const archive = @import("transcript-store.zig");
const fixture = @import("transcript-test-fixture.zig");
const testing = std.testing;
const a = fixture.first_id;
const b = fixture.second_id;

comptime {
    _ = @import("transcript-failure-tests.zig");
}

test "raw Unicode split ANSI and NUL chunks survive reopen with exact boundaries" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    var store = try archive.Store.open(temp.path);
    defer store.close();
    const identity = "{\"profile\":\"ADE\",\"cwd\":\"D:\\\\kiểm-tra\",\"session\":9}";
    try store.create(a, identity);
    const chunks = [_][]const u8{ "\x1b[31m\xf0\x9f", "\x8c\x8d\x00\r\n", "\x1b[0m終" };
    var offset: u64 = 0;
    for (chunks, 0..) |chunk, index| {
        const saved = try store.append(a, index + 1, chunk);
        try testing.expect(saved.recorded);
    }
    store.close();
    store = try archive.Store.open(temp.path);
    var meta = try store.metadata(a, testing.allocator);
    defer meta.deinit(testing.allocator);
    try testing.expectEqualStrings(identity, meta.identity_json);
    try testing.expect(!meta.finished and !meta.process_eof and !meta.capture_complete);
    for (chunks, 0..) |chunk, index| {
        const replay = try store.read(a, offset, testing.allocator);
        defer replay.deinit(testing.allocator);
        try testing.expectEqualStrings(chunk, replay.data);
        try testing.expectEqual(index + 1, replay.sequence);
        try testing.expectEqual(@as(u64, 0), replay.chunk_offset);
        try testing.expectEqual(index == chunks.len - 1, replay.eof);
        offset = replay.next_offset;
    }
    const middle = try store.read(a, 2, testing.allocator);
    defer middle.deinit(testing.allocator);
    try testing.expectEqualStrings(chunks[0][2..], middle.data);
    try store.finish(a, 7, chunks.len, 23, null);
    store.close();
    store = try archive.Store.open(temp.path);
    const done = try store.metadata(a, testing.allocator);
    defer done.deinit(testing.allocator);
    try testing.expect(done.finished and done.process_eof and done.capture_complete);
    try testing.expectEqual(@as(?u32, 7), done.exit_code);
    try testing.expectEqual(@as(u64, 23), done.discarded_bytes);
    const eof = try store.read(a, offset, testing.allocator);
    defer eof.deinit(testing.allocator);
    try testing.expect(eof.eof and eof.data.len == 0);
    try testing.expectError(error.InvalidOffset, store.read(a, offset + 1, testing.allocator));
}

test "per run and aggregate byte quotas preserve prefixes and explicit omission" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    var store = try archive.Store.openWithLimits(temp.path, .{ .per_run_bytes = 5, .aggregate_bytes = 7 });
    defer store.close();
    try store.create(a, "{\"name\":\"first\"}");
    try store.create(b, "{\"name\":\"second\"}");
    try testing.expect((try store.append(a, 1, "abcd")).recorded);
    const omitted = try store.append(a, 2, "ef");
    try testing.expect(omitted.truncated and !omitted.recorded);
    try testing.expect(!(try store.append(a, 3, "g")).recorded);
    try testing.expect((try store.append(b, 1, "123")).recorded);
    try testing.expect(!(try store.append(b, 2, "4")).recorded);
    try store.finish(a, 0, 3, 0, null);
    const meta = try store.metadata(a, testing.allocator);
    defer meta.deinit(testing.allocator);
    try testing.expect(meta.finished and meta.process_eof and meta.truncated and !meta.capture_complete);
    try testing.expectEqual(@as(u64, 4), meta.recorded_bytes);
    try testing.expectEqual(@as(u64, 3), meta.omitted_bytes);
    try testing.expectEqual(@as(u64, 1), meta.recorded_sequence);
    try testing.expectEqual(@as(u64, 3), meta.last_sequence);
    const other = try store.metadata(b, testing.allocator);
    defer other.deinit(testing.allocator);
    try testing.expectEqualStrings("{\"name\":\"second\"}", other.identity_json);
    try testing.expectEqual(@as(u64, 1), other.omitted_bytes);
}

test "ordered writes immutable identity finalization and closed handles reject misuse" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    var store = try archive.Store.open(temp.path);
    defer store.close();
    try testing.expectError(error.InvalidRunId, store.create("NOT-A-UUID", "{}"));
    try testing.expectError(error.InvalidRunIdentity, store.create(a, "[]"));
    try testing.expectError(error.InvalidRunIdentity, store.create(a, "{invalid"));
    try testing.expectError(error.UnknownRun, store.append(a, 1, "x"));
    try store.create(a, "{\"original\":true}");
    try testing.expectError(error.RunAlreadyExists, store.create(a, "{}"));
    try testing.expectError(error.InvalidTranscriptSequence, store.append(a, 2, "x"));
    _ = try store.append(a, 1, "x");
    try testing.expectError(error.InvalidTranscriptSequence, store.append(a, 1, "x"));
    try testing.expectError(error.InvalidTranscriptSequence, store.finish(a, 0, 2, 0, null));
    try store.finish(a, 1, 3, 0, "SqliteDiskFull");
    const meta = try store.metadata(a, testing.allocator);
    defer meta.deinit(testing.allocator);
    try testing.expect(meta.finished and !meta.process_eof and !meta.capture_complete);
    try testing.expectEqualStrings("SqliteDiskFull", meta.stream_error.?);
    try testing.expectError(error.RunFinished, store.append(a, 4, "x"));
    try testing.expectError(error.RunFinished, store.finish(a, 0, 3, 0, null));
    store.close();
    try testing.expectError(error.StoreClosed, store.metadata(a, testing.allocator));
    try testing.expectError(error.StoreClosed, store.create(b, "{}"));
}

fn concurrentAppend(store: *archive.Store, run_id: []const u8, result: *?anyerror) void {
    for (1..9) |sequence| {
        _ = store.append(run_id, sequence, "independent output\r\n") catch |err| {
            result.* = err;
            return;
        };
    }
    store.finish(run_id, 0, 8, 0, null) catch |err| {
        result.* = err;
    };
}

test "concurrent terminal readers share one serialized store without identity or sequence mixing" {
    const temp = try fixture.Fixture.create();
    defer temp.deinit();
    var store = try archive.Store.open(temp.path);
    defer store.close();
    try store.create(a, "{\"session\":1}");
    try store.create(b, "{\"session\":2}");
    var first_error: ?anyerror = null;
    var second_error: ?anyerror = null;
    const first = try std.Thread.spawn(.{}, concurrentAppend, .{ &store, a, &first_error });
    const second = try std.Thread.spawn(.{}, concurrentAppend, .{ &store, b, &second_error });
    first.join();
    second.join();
    try testing.expect(first_error == null and second_error == null);
    for ([_][]const u8{ a, b }) |run_id| {
        const meta = try store.metadata(run_id, testing.allocator);
        defer meta.deinit(testing.allocator);
        try testing.expect(meta.capture_complete);
        try testing.expectEqual(@as(u64, 8), meta.last_sequence);
        try testing.expectEqual(@as(u64, 8 * "independent output\r\n".len), meta.recorded_bytes);
    }
}
