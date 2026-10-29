const std = @import("std");
const sql = @import("transcript-sql.zig");
const schema = @import("transcript-schema.zig");
const types = @import("transcript-types.zig");
const allocator = std.heap.page_allocator;

const State = struct { finished: bool, truncated: bool, recorded: u64, omitted: u64, sequence: u64 };

fn state(context: *const sql.Context, run_id: []const u8) !State {
    const statement = try context.prepare("SELECT finished,truncated,recorded_bytes,omitted_bytes,last_sequence FROM transcript_runs WHERE run_id=?");
    defer _ = context.api.finalize(statement);
    try context.bindText(statement, 1, run_id);
    const code = context.api.step(statement);
    if (code == sql.sqlite.done) return error.UnknownRun;
    if (code != sql.sqlite.row) {
        try sql.sqlite.check(code);
        return error.CorruptDatabase;
    }
    return .{
        .finished = try context.nonnegative(statement, 0) == 1,
        .truncated = try context.nonnegative(statement, 1) == 1,
        .recorded = try context.nonnegative(statement, 2),
        .omitted = try context.nonnegative(statement, 3),
        .sequence = try context.nonnegative(statement, 4),
    };
}

pub fn create(context: *const sql.Context, run_id: []const u8, identity_json: []const u8) !void {
    try types.validateRunId(run_id);
    if (identity_json.len == 0 or identity_json.len > types.max_identity_bytes or !std.unicode.utf8ValidateSlice(identity_json)) return error.InvalidRunIdentity;
    const identity = std.json.parseFromSlice(std.json.Value, allocator, identity_json, .{}) catch return error.InvalidRunIdentity;
    defer identity.deinit();
    if (identity.value != .object) return error.InvalidRunIdentity;
    try schema.begin(context);
    errdefer context.exec("ROLLBACK") catch {};
    if (state(context, run_id)) |_| return error.RunAlreadyExists else |err| {
        if (err != error.UnknownRun) return err;
    }
    const statement = try context.prepare("INSERT INTO transcript_runs(run_id,identity_json,created_unix_ms) VALUES(?,?,CAST(strftime('%s','now') AS INTEGER)*1000)");
    defer _ = context.api.finalize(statement);
    try context.bindText(statement, 1, run_id);
    try context.bindText(statement, 2, identity_json);
    try context.stepDone(statement);
    try context.exec("COMMIT");
}

/// Only whole original chunks enter the archive. Once a run loses its byte
/// quota, later chunks remain omitted so the captured stream is a true prefix.
pub fn append(context: *const sql.Context, run_id: []const u8, sequence: u64, bytes: []const u8) !types.AppendResult {
    try types.validateRunId(run_id);
    if (bytes.len == 0 or bytes.len > types.max_chunk_bytes) return error.InvalidTranscriptChunk;
    try schema.begin(context);
    errdefer context.exec("ROLLBACK") catch {};
    const previous = try state(context, run_id);
    if (previous.finished) return error.RunFinished;
    if (previous.sequence == std.math.maxInt(i64) or sequence != previous.sequence + 1) return error.InvalidTranscriptSequence;
    const aggregate: u64 = @intCast(try context.integer("SELECT COALESCE(sum(recorded_bytes),0) FROM transcript_runs"));
    if (previous.recorded > context.limits.per_run_bytes or aggregate > context.limits.aggregate_bytes) return error.TranscriptStoreTooLarge;
    const recorded = !previous.truncated and bytes.len <= context.limits.per_run_bytes - previous.recorded and bytes.len <= context.limits.aggregate_bytes - aggregate;
    if (recorded) {
        const chunk = try context.prepare("INSERT INTO transcript_chunks(run_id,sequence,byte_offset,data) VALUES(?,?,?,?)");
        defer _ = context.api.finalize(chunk);
        try context.bindText(chunk, 1, run_id);
        try context.bindInteger(chunk, 2, sequence);
        try context.bindInteger(chunk, 3, previous.recorded);
        try sql.sqlite.check(context.bind_blob(chunk, 4, bytes.ptr, @intCast(bytes.len), null));
        try context.stepDone(chunk);
    }
    const recorded_bytes = previous.recorded + if (recorded) bytes.len else @as(u64, 0);
    const omitted = std.math.add(u64, previous.omitted, if (recorded) @as(u64, 0) else bytes.len) catch return error.TranscriptOverflow;
    const update = try context.prepare("UPDATE transcript_runs SET recorded_bytes=?,omitted_bytes=?,last_sequence=?,recorded_sequence=CASE WHEN ? THEN ? ELSE recorded_sequence END,truncated=? WHERE run_id=?");
    defer _ = context.api.finalize(update);
    try context.bindInteger(update, 1, recorded_bytes);
    try context.bindInteger(update, 2, omitted);
    try context.bindInteger(update, 3, sequence);
    try context.bindInteger(update, 4, @intFromBool(recorded));
    try context.bindInteger(update, 5, sequence);
    try context.bindInteger(update, 6, @intFromBool(!recorded));
    try context.bindText(update, 7, run_id);
    try context.stepDone(update);
    try context.exec("COMMIT");
    return .{ .recorded = recorded, .recorded_bytes = recorded_bytes, .omitted_bytes = omitted, .truncated = !recorded };
}

pub fn finish(context: *const sql.Context, run_id: []const u8, exit_code: u32, last_sequence: u64, discarded_bytes: u64, stream_error: ?[]const u8) !void {
    try types.validateRunId(run_id);
    if (stream_error) |value| {
        if (value.len == 0 or value.len > types.max_error_bytes or !std.unicode.utf8ValidateSlice(value)) return error.InvalidTranscriptError;
    }
    try schema.begin(context);
    errdefer context.exec("ROLLBACK") catch {};
    const previous = try state(context, run_id);
    if (previous.finished) return error.RunFinished;
    // A capture failure may have prevented the last observed reads from entering
    // SQLite. Such finalization is conservative and never claims process EOF.
    if (last_sequence < previous.sequence or (stream_error == null and last_sequence != previous.sequence)) return error.InvalidTranscriptSequence;
    const update = try context.prepare("UPDATE transcript_runs SET finished=1,process_eof=?,exit_code=?,last_sequence=?,discarded_bytes=?,stream_error=? WHERE run_id=?");
    defer _ = context.api.finalize(update);
    try context.bindInteger(update, 1, @intFromBool(stream_error == null));
    try context.bindInteger(update, 2, exit_code);
    try context.bindInteger(update, 3, last_sequence);
    try context.bindInteger(update, 4, discarded_bytes);
    if (stream_error) |value| try context.bindText(update, 5, value);
    // Unbound parameters are SQLite NULL, preserving the absence of an error.
    try context.bindText(update, 6, run_id);
    try context.stepDone(update);
    try context.exec("COMMIT");
}
