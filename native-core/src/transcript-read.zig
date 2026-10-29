const std = @import("std");
const sql = @import("transcript-sql.zig");
const types = @import("transcript-types.zig");

pub fn metadata(context: *const sql.Context, run_id: []const u8, owner: std.mem.Allocator) !types.Metadata {
    try types.validateRunId(run_id);
    const statement = try context.prepare("SELECT identity_json,stream_error,created_unix_ms,finished,process_eof,truncated,recorded_bytes,omitted_bytes,discarded_bytes,last_sequence,recorded_sequence,exit_code FROM transcript_runs WHERE run_id=?");
    defer _ = context.api.finalize(statement);
    try context.bindText(statement, 1, run_id);
    const code = context.api.step(statement);
    if (code == sql.sqlite.done) return error.UnknownRun;
    if (code != sql.sqlite.row) {
        try sql.sqlite.check(code);
        return error.CorruptDatabase;
    }
    const identity = try context.text(statement, 0, owner, types.max_identity_bytes);
    errdefer owner.free(identity);
    const parsed = std.json.parseFromSlice(std.json.Value, owner, identity, .{}) catch return error.CorruptDatabase;
    defer parsed.deinit();
    if (parsed.value != .object) return error.CorruptDatabase;
    const stream_error = if (context.api.column_type(statement, 1) == 5) null else try context.text(statement, 1, owner, types.max_error_bytes);
    errdefer if (stream_error) |value| owner.free(value);
    const finished = try boolean(context, statement, 3);
    const process_eof = try boolean(context, statement, 4);
    const truncated = try boolean(context, statement, 5);
    const recorded = try context.nonnegative(statement, 6);
    const omitted = try context.nonnegative(statement, 7);
    const last_sequence = try context.nonnegative(statement, 9);
    const recorded_sequence = try context.nonnegative(statement, 10);
    const exit = if (context.api.column_type(statement, 11) == 5) null else try context.nonnegative(statement, 11);
    if (recorded_sequence > last_sequence or (exit != null and exit.? > std.math.maxInt(u32)) or
        (process_eof and (!finished or stream_error != null)) or finished != (exit != null)) return error.CorruptDatabase;
    return .{
        .identity_json = identity,
        .stream_error = stream_error,
        .created_unix_ms = @intCast(try context.nonnegative(statement, 2)),
        .finished = finished,
        .process_eof = process_eof,
        .capture_complete = finished and process_eof and !truncated and omitted == 0 and stream_error == null,
        .truncated = truncated,
        .recorded_bytes = recorded,
        .omitted_bytes = omitted,
        .discarded_bytes = try context.nonnegative(statement, 8),
        .last_sequence = last_sequence,
        .recorded_sequence = recorded_sequence,
        .exit_code = if (exit) |value| @intCast(value) else null,
    };
}

fn boolean(context: *const sql.Context, statement: *sql.sqlite.Statement, index: c_int) !bool {
    const value = try context.nonnegative(statement, index);
    if (value > 1) return error.CorruptDatabase;
    return value == 1;
}

pub fn read(context: *const sql.Context, run_id: []const u8, offset: u64, owner: std.mem.Allocator) !types.ReadResult {
    const meta = try metadata(context, run_id, owner);
    defer meta.deinit(owner);
    if (offset > meta.recorded_bytes) return error.InvalidOffset;
    if (offset == meta.recorded_bytes) return .{
        .data = try owner.alloc(u8, 0),
        .offset = offset,
        .next_offset = offset,
        .sequence = meta.recorded_sequence,
        .chunk_offset = 0,
        .eof = true,
    };
    const statement = try context.prepare("SELECT sequence,byte_offset,data FROM transcript_chunks WHERE run_id=? AND byte_offset<=? ORDER BY byte_offset DESC LIMIT 1");
    defer _ = context.api.finalize(statement);
    try context.bindText(statement, 1, run_id);
    try context.bindInteger(statement, 2, offset);
    const code = context.api.step(statement);
    if (code != sql.sqlite.row) {
        try sql.sqlite.check(code);
        return error.CorruptDatabase;
    }
    const sequence = try context.nonnegative(statement, 0);
    const start = try context.nonnegative(statement, 1);
    const length = context.api.column_bytes(statement, 2);
    if (context.api.column_type(statement, 2) != 4 or length < 1 or length > types.max_chunk_bytes or
        offset < start or offset - start >= length or sequence == 0 or sequence > meta.recorded_sequence) return error.CorruptDatabase;
    const pointer = context.column_blob(statement, 2) orelse return error.CorruptDatabase;
    const chunk_offset: usize = @intCast(offset - start);
    const next_offset = start + @as(u64, @intCast(length));
    if (next_offset > meta.recorded_bytes) return error.CorruptDatabase;
    return .{
        .data = try owner.dupe(u8, pointer[chunk_offset..@intCast(length)]),
        .offset = offset,
        .next_offset = next_offset,
        .sequence = sequence,
        .chunk_offset = chunk_offset,
        .eof = next_offset == meta.recorded_bytes,
    };
}
