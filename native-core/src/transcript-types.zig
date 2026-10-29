const std = @import("std");

pub const max_chunk_bytes = 16 * 1024;
pub const max_identity_bytes = 8 * 1024;
pub const max_error_bytes = 1024;
pub const schema_version = 1;

/// Raw payload quotas are independent of session/agent count. The physical
/// database ceiling also bounds identity and record overhead. DELETE journaling
/// can temporarily add at most one database preimage plus journal headers.
pub const Limits = struct {
    per_run_bytes: u64 = 8 * 1024 * 1024,
    aggregate_bytes: u64 = 48 * 1024 * 1024,
    database_bytes: u64 = 64 * 1024 * 1024,

    /// Includes a full rollback preimage and conservative journal framing for
    /// the fixed 4096-byte page size. No WAL, backup, or spill files are used.
    pub fn maximumDiskBytes(self: Limits) u64 {
        return self.database_bytes * 2 + 2 * 1024 * 1024;
    }

    pub fn validate(self: Limits) !void {
        if (self.per_run_bytes == 0 or self.per_run_bytes > self.aggregate_bytes or
            self.aggregate_bytes > 48 * 1024 * 1024 or self.database_bytes < 64 * 1024 or
            self.database_bytes > 64 * 1024 * 1024 or self.database_bytes % 4096 != 0)
            return error.InvalidTranscriptLimits;
    }
};

pub const AppendResult = struct {
    recorded: bool,
    recorded_bytes: u64,
    omitted_bytes: u64,
    truncated: bool,
};

pub const Metadata = struct {
    identity_json: []u8,
    stream_error: ?[]u8,
    created_unix_ms: i64,
    finished: bool,
    process_eof: bool,
    capture_complete: bool,
    truncated: bool,
    recorded_bytes: u64,
    omitted_bytes: u64,
    discarded_bytes: u64,
    last_sequence: u64,
    recorded_sequence: u64,
    exit_code: ?u32,

    pub fn deinit(self: Metadata, owner: std.mem.Allocator) void {
        owner.free(self.identity_json);
        if (self.stream_error) |value| owner.free(value);
    }
};

pub const ReadResult = struct {
    data: []u8,
    offset: u64,
    next_offset: u64,
    sequence: u64,
    chunk_offset: u64,
    /// Exhausted recorded bytes; this is independent of process EOF.
    eof: bool,

    pub fn deinit(self: ReadResult, owner: std.mem.Allocator) void {
        owner.free(self.data);
    }
};

pub fn validateRunId(run_id: []const u8) !void {
    if (run_id.len != 36) return error.InvalidRunId;
    for (run_id, 0..) |byte, index| {
        if (index == 8 or index == 13 or index == 18 or index == 23) {
            if (byte != '-') return error.InvalidRunId;
        } else if (!std.ascii.isDigit(byte) and (byte < 'a' or byte > 'f')) return error.InvalidRunId;
    }
    // UUID variant and version make the canonical run key unambiguous.
    if (run_id[14] < '1' or run_id[14] > '8' or
        (run_id[19] != '8' and run_id[19] != '9' and run_id[19] != 'a' and run_id[19] != 'b'))
        return error.InvalidRunId;
}
