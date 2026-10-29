const sql = @import("transcript-sql.zig");
const types = @import("transcript-types.zig");
const application_id = 0x534c5452; // SLTR: isolated ADE terminal transcript archive.

pub const runs_sql = "CREATE TABLE transcript_runs (run_id TEXT PRIMARY KEY, identity_json TEXT NOT NULL CHECK(length(CAST(identity_json AS BLOB))<=8192), created_unix_ms INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0 CHECK(finished IN(0,1)), process_eof INTEGER NOT NULL DEFAULT 0 CHECK(process_eof IN(0,1)), truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN(0,1)), recorded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(recorded_bytes>=0), omitted_bytes INTEGER NOT NULL DEFAULT 0 CHECK(omitted_bytes>=0), discarded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(discarded_bytes>=0), last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence>=0), recorded_sequence INTEGER NOT NULL DEFAULT 0 CHECK(recorded_sequence>=0), exit_code INTEGER, stream_error TEXT CHECK(length(CAST(stream_error AS BLOB))<=1024))";
pub const chunks_sql = "CREATE TABLE transcript_chunks (run_id TEXT NOT NULL REFERENCES transcript_runs(run_id), sequence INTEGER NOT NULL CHECK(sequence>0), byte_offset INTEGER NOT NULL CHECK(byte_offset>=0), data BLOB NOT NULL CHECK(length(data)>0 AND length(data)<=16384), PRIMARY KEY(run_id,sequence), UNIQUE(run_id,byte_offset))";

pub fn inspect(context: *const sql.Context) !bool {
    const version = try context.integer("PRAGMA user_version");
    const identity = try context.integer("PRAGMA application_id");
    const objects = try context.integer("SELECT count(*) FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'");
    if (version == 0 and identity == 0 and objects == 0) return true;
    if (version != types.schema_version or identity != application_id or objects != 2) return error.UnsupportedSchema;
    const db = context.db orelse return error.StoreClosed;
    try context.api.expectText(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='transcript_runs'", runs_sql);
    try context.api.expectText(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='transcript_chunks'", chunks_sql);
    return false;
}

pub fn initialize(context: *const sql.Context) !void {
    const fresh = try inspect(context);
    // No mutating pragma or DDL runs until the existing database is recognized.
    if (!fresh and try context.integer("PRAGMA page_size") != 4096) return error.UnsupportedSchema;
    try context.exec("PRAGMA page_size=4096");
    try context.exec("PRAGMA synchronous=FULL");
    try context.exec("PRAGMA foreign_keys=ON");
    try context.pragmaLimit();
    if (fresh) {
        try context.exec("BEGIN IMMEDIATE");
        errdefer context.exec("ROLLBACK") catch {};
        if (try inspect(context)) {
            try context.exec(runs_sql);
            try context.exec(chunks_sql);
            try context.exec("PRAGMA application_id=1397511250");
            try context.exec("PRAGMA user_version=1");
        }
        try context.exec("COMMIT");
    }
    try context.api.expectText(context.db.?, "PRAGMA journal_mode=DELETE", "delete");
    if (try context.integer("PRAGMA synchronous") != 2) return error.SqliteError;
}

pub fn begin(context: *const sql.Context) !void {
    try context.exec("BEGIN IMMEDIATE");
    errdefer context.exec("ROLLBACK") catch {};
    if (try inspect(context)) return error.UnsupportedSchema;
}
