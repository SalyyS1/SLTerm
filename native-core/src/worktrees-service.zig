const std = @import("std");
const rpc = @import("protocol.zig");
const worktrees = @import("git-worktrees.zig");
const a = rpc.allocator;

/// Git work is serialized on its own thread. The command loop remains free to
/// accept terminal input, resize, output ACKs and shutdown during checkout.
pub const Service = struct {
    thread: ?std.Thread = null,
    busy: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn deinit(self: *Service) void {
        if (self.thread) |thread| thread.join();
        self.thread = null;
    }

    pub fn handle(self: *Service, req: rpc.Request, emitter: *rpc.Emitter) !bool {
        if (!std.mem.startsWith(u8, req.method, "worktrees.")) return false;
        const prepare = std.mem.eql(u8, req.method, "worktrees.prepare");
        if (!prepare and !std.mem.eql(u8, req.method, "worktrees.inspect")) return error.UnknownMethod;
        if (self.busy.swap(true, .acq_rel)) return error.WorktreeOperationBusy;
        errdefer self.busy.store(false, .release);
        if (self.thread) |thread| thread.join();
        self.thread = null;
        const root = try a.dupe(u8, req.root orelse return error.MissingRoot);
        errdefer a.free(root);
        const task = try a.dupe(u8, req.task_id orelse return error.MissingTaskId);
        errdefer a.free(task);
        const base = if (req.base_revision) |value| try a.dupe(u8, value) else null;
        errdefer if (base) |value| a.free(value);
        const revision = if (req.if_match) |value| try a.dupe(u8, value) else null;
        errdefer if (revision) |value| a.free(value);
        const owned: rpc.Request = .{
            .version = req.version,
            .id = req.id,
            .method = if (prepare) "worktrees.prepare" else "worktrees.inspect",
            .root = root,
            .task_id = task,
            .base_revision = base,
            .if_match = revision,
        };
        self.thread = try std.Thread.spawn(.{}, worker, .{ self, owned, emitter });
        return true;
    }

    fn worker(self: *Service, req: rpc.Request, emitter: *rpc.Emitter) void {
        defer a.free(req.root.?);
        defer a.free(req.task_id.?);
        defer if (req.base_revision) |value| a.free(value);
        defer if (req.if_match) |value| a.free(value);
        const result = worktrees.execute(req) catch |err| {
            // Publish admission before the reply: the peer may send its next
            // request as soon as the writer delivers this frame.
            self.busy.store(false, .release);
            emitter.tryFail(req.id, @errorName(err)) catch emitter.writer.recordFailure();
            return;
        };
        defer result.deinit();
        self.busy.store(false, .release);
        emitter.trySend(.{ .version = rpc.version, .id = req.id, .ok = true, .result = result }) catch emitter.writer.recordFailure();
    }
};
