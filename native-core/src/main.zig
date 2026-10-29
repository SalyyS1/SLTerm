const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const rpc = @import("protocol.zig");
const Session = @import("session.zig").Session;
const Preferences = @import("preferences-service.zig").Service;
const Files = @import("workspace-files.zig").Service;
const History = @import("terminal-history-service.zig").Service;

// Keep only lightweight identity tombstones after a session exits. A late ACK
// must never target a different process that reused an old session identifier.
const Entry = struct { id: u64, session: ?*Session };

pub fn main() u8 {
    var emitter: rpc.Emitter = .{};
    emitter.start(c.GetStdHandle(c.STD_OUTPUT_HANDLE)) catch return 1;
    const status = run(&emitter);
    // Queueing the final reply is insufficient: success requires the writer to
    // finish delivering every frame, including the shutdown acknowledgement.
    emitter.deinit() catch return 1;
    return status;
}

fn run(emitter: *rpc.Emitter) u8 {
    var preferences: Preferences = .{};
    defer preferences.deinit();
    var files = Files.init();
    defer files.deinit();
    var history: History = .{};
    defer history.deinit();
    var sessions: std.ArrayList(Entry) = .empty;
    defer {
        stopAll(sessions.items);
        for (sessions.items) |entry| if (entry.session) |session| session.destroy();
        sessions.deinit(rpc.allocator);
    }
    emitter.trySend(.{ .version = rpc.version, .event = "ready", .engine = "zig-conpty-proof", .pid = c.GetCurrentProcessId() }) catch return 1;
    var frame: [rpc.max_frame]u8 = undefined;
    var length: usize = 0;
    var input: [4096]u8 = undefined;
    while (true) {
        var count: c.DWORD = 0;
        if (c.ReadFile(c.GetStdHandle(c.STD_INPUT_HANDLE), &input, input.len, &count, null) == 0 or count == 0) return 0;
        for (input[0..count]) |byte| {
            if (byte == '\n') {
                const parsed = std.json.parseFromSlice(rpc.Request, rpc.allocator, frame[0..length], .{}) catch {
                    emitter.tryFail(0, "MalformedRequest") catch |err| return abortTransport(sessions.items, emitter, 0, err);
                    length = 0;
                    continue;
                };
                defer parsed.deinit();
                length = 0;
                const request = parsed.value;
                rpc.validate(request) catch |err| {
                    emitter.tryFail(request.id, @errorName(err)) catch |transport_err| return abortTransport(sessions.items, emitter, request.id, transport_err);
                    continue;
                };
                if (std.mem.eql(u8, request.method, "shutdown")) {
                    stopAll(sessions.items);
                    for (sessions.items) |entry| if (entry.session) |session| session.destroy();
                    sessions.clearRetainingCapacity();
                    emitter.sendBlocking(.{ .version = rpc.version, .id = request.id, .ok = true }) catch |err| {
                        std.debug.print("{s}: shutdown acknowledgement is unconfirmed\n", .{@errorName(err)});
                        return 1;
                    };
                    return 0;
                }
                dispatch(request, &sessions, &preferences, &files, &history, emitter) catch |err| {
                    if (err == error.TransportBackpressure or err == error.TransportClosed)
                        return abortTransport(sessions.items, emitter, request.id, err);
                    emitter.tryFail(request.id, @errorName(err)) catch |transport_err| return abortTransport(sessions.items, emitter, request.id, transport_err);
                };
            } else {
                if (length == frame.len) {
                    emitter.tryFail(0, "FrameTooLarge") catch |err| return abortTransport(sessions.items, emitter, 0, err);
                    return 0;
                }
                frame[length] = byte;
                length += 1;
            }
        }
    }
}

fn stopAll(sessions: []const Entry) void {
    // Stop every owned job before joining any producer that may await stdout.
    for (sessions) |entry| if (entry.session) |session| session.stop();
}

fn abortTransport(sessions: []const Entry, emitter: *rpc.Emitter, id: u64, reason: anyerror) u8 {
    stopAll(sessions);
    // The failed request and the unprocessed request suffix are explicit. Keep
    // queued frames intact and wait for a paused peer to resume draining them.
    std.debug.print("{s}: transport stopped; pending requests and shutdown acknowledgement are unconfirmed\n", .{@errorName(reason)});
    emitter.fail(id, @errorName(reason));
    const message = if (reason == error.TransportBackpressure)
        "Core output transport is full. Pending requests were not processed; shutdown acknowledgement is unconfirmed."
    else
        "Core output transport failed. Pending requests were not processed; shutdown acknowledgement is unconfirmed.";
    emitter.send(.{ .version = rpc.version, .event = "transport_error", .error_code = @errorName(reason), .message = message, .pending_requests_unprocessed = true });
    return 1;
}

fn dispatch(req: rpc.Request, sessions: *std.ArrayList(Entry), preferences: *Preferences, files: *Files, history: *History, emitter: *rpc.Emitter) !void {
    // Only the command owner reaps: reader/waiter threads must never join
    // themselves. Completed sessions release buffers/handles at the next RPC.
    for (sessions.items) |*entry| {
        if (entry.session) |session| {
            if (session.hasExited()) {
                session.destroy();
                entry.session = null;
            }
        }
    }
    if (std.mem.eql(u8, req.method, "hello")) {
        try emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = .{
            .protocol_version = rpc.version,
            .capabilities = .{ "terminal.conpty", "preferences.sqlite", "files.local.revisions", "terminal.transcripts" },
        } });
        return;
    }
    if (try preferences.handle(req, emitter)) return;
    if (try files.handle(req, emitter)) return;
    if (try history.handle(req, emitter)) return;
    var existing: ?Entry = null;
    for (sessions.items) |entry| {
        if (entry.id == req.session_id) existing = entry;
    }
    if (std.mem.eql(u8, req.method, "spawn")) {
        if (existing != null) return error.DuplicateSession;
        const archive = if (req.run_id != null) try history.database() else null;
        const session = try Session.create(req, emitter, archive);
        errdefer session.destroy();
        try sessions.append(rpc.allocator, .{ .id = req.session_id, .session = session });
    } else {
        const entry = existing orelse return error.UnknownSession;
        const session = entry.session orelse {
            if (std.mem.eql(u8, req.method, "stop")) {
                try emitter.ok(req.id);
                return;
            }
            return error.SessionExited;
        };
        if (std.mem.eql(u8, req.method, "input")) {
            try session.input(req.data orelse return error.MissingInput);
        } else if (std.mem.eql(u8, req.method, "resize")) {
            try session.resize(req.cols, req.rows);
        } else if (std.mem.eql(u8, req.method, "ack")) {
            try session.acknowledge(req.sequence);
        } else if (std.mem.eql(u8, req.method, "stop")) {
            session.stop();
        } else return error.UnknownMethod;
    }
    try emitter.ok(req.id);
}

test {
    _ = @import("command_line.zig");
    _ = @import("protocol.zig");
    _ = @import("workspace-files-recovery.zig");
    _ = @import("transcript-tests.zig");
}
