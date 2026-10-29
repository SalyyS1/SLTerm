const std = @import("std");
const sqlite = @import("storage-sqlite.zig");
const win = @import("storage-win.zig");
const allocator = std.heap.page_allocator;
var serial = std.atomic.Value(u64).init(0);

/// Caller holds BEGIN IMMEDIATE on a different writer connection. Readers see
/// the exact committed preimage and competing writers cannot change it.
pub fn create(api: *const sqlite.Api, path: []const u8, previous: []const u8) !void {
    const pending = try std.fmt.allocPrint(allocator, "{s}.pending-{d}-{d}-{d}", .{ previous, win.GetCurrentProcessId(), win.GetTickCount64(), serial.fetchAdd(1, .monotonic) });
    defer allocator.free(pending);
    try win.reserve(pending);
    defer win.remove(pending);
    const source = try api.open(path, sqlite.read_only);
    defer _ = api.close_v2(source);
    const destination = try api.open(pending, sqlite.read_write_create);
    var open = true;
    defer if (open) {
        _ = api.close_v2(destination);
    };
    try api.exec(destination, "PRAGMA synchronous=FULL");
    const backup = api.backup_init(destination, "main", source, "main") orelse {
        try sqlite.check(api.errcode(destination));
        return error.BackupFailed;
    };
    const step = api.backup_step(backup, -1);
    const finish = api.backup_finish(backup);
    // finish can be OK after BUSY/LOCKED or an unfinished backup. Both results
    // must be checked before a snapshot may be published.
    if (step != sqlite.done) {
        try sqlite.check(step);
        return error.BackupFailed;
    }
    try sqlite.check(finish);
    try api.expectText(destination, "PRAGMA journal_mode=DELETE", "delete");
    try api.expectText(destination, "PRAGMA quick_check", "ok");
    try sqlite.check(api.close_v2(destination));
    open = false;
    try win.publish(pending, previous);
}
