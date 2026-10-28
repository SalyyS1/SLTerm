const std = @import("std");
const win = @import("win.zig");
const c = win.c;
const rpc = @import("protocol.zig");
const Session = @import("session.zig").Session;

// Keep only lightweight identity tombstones after a session exits. A late ACK
// must never target a different process that reused an old session identifier.
const Entry = struct { id: u64, session: ?*Session };

pub fn main() void {
    var emitter = rpc.Emitter{ .handle = c.GetStdHandle(c.STD_OUTPUT_HANDLE) };
    var sessions: std.ArrayList(Entry) = .empty;
    defer {
        for (sessions.items) |entry| if (entry.session) |session| session.destroy();
        sessions.deinit(rpc.allocator);
    }
    emitter.send(.{ .version = rpc.version, .event = "ready", .engine = "zig-conpty-proof", .pid = c.GetCurrentProcessId() });
    var frame: [rpc.max_frame]u8 = undefined;
    var length: usize = 0;
    var input: [4096]u8 = undefined;
    while (true) {
        var count: c.DWORD = 0;
        if (c.ReadFile(c.GetStdHandle(c.STD_INPUT_HANDLE), &input, input.len, &count, null) == 0 or count == 0) return;
        for (input[0..count]) |byte| {
            if (byte == '\n') {
                const parsed = std.json.parseFromSlice(rpc.Request, rpc.allocator, frame[0..length], .{}) catch {
                    emitter.fail(0, "MalformedRequest");
                    length = 0;
                    continue;
                };
                defer parsed.deinit();
                length = 0;
                const request = parsed.value;
                rpc.validate(request) catch |err| {
                    emitter.fail(request.id, @errorName(err));
                    continue;
                };
                if (std.mem.eql(u8, request.method, "shutdown")) {
                    for (sessions.items) |entry| if (entry.session) |session| session.destroy();
                    sessions.clearRetainingCapacity();
                    emitter.ok(request.id);
                    return;
                }
                dispatch(request, &sessions, &emitter) catch |err| emitter.fail(request.id, @errorName(err));
            } else {
                if (length == frame.len) {
                    emitter.fail(0, "FrameTooLarge");
                    return;
                }
                frame[length] = byte;
                length += 1;
            }
        }
    }
}

fn dispatch(req: rpc.Request, sessions: *std.ArrayList(Entry), emitter: *rpc.Emitter) !void {
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
        emitter.ok(req.id);
        return;
    }
    var existing: ?Entry = null;
    for (sessions.items) |entry| {
        if (entry.id == req.session_id) existing = entry;
    }
    if (std.mem.eql(u8, req.method, "spawn")) {
        if (existing != null) return error.DuplicateSession;
        const session = try Session.create(req, emitter);
        errdefer session.destroy();
        try sessions.append(rpc.allocator, .{ .id = req.session_id, .session = session });
    } else {
        const entry = existing orelse return error.UnknownSession;
        const session = entry.session orelse {
            if (std.mem.eql(u8, req.method, "stop")) {
                emitter.ok(req.id);
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
    emitter.ok(req.id);
}

test {
    _ = @import("command_line.zig");
    _ = @import("protocol.zig");
}
