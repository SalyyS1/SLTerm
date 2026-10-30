const std = @import("std");
const c = @import("win.zig").c;
const rpc = @import("protocol.zig");
const paths = @import("git-worktree-path.zig");
const process = @import("git-process.zig");
const Client = @import("git-client.zig").Client;
const a = rpc.allocator;

pub const Result = struct {
    root: []u8,
    path: []u8,
    branch: []u8,
    base_revision: []u8,
    head_revision: []u8,
    exists: bool = false,
    ready: bool = false,
    completion_unknown: bool = false,
    pub fn deinit(self: Result) void {
        inline for (.{ "root", "path", "branch", "base_revision", "head_revision" }) |name| a.free(@field(self, name));
    }
};

fn commonDirectory(git: Client, cwd: []const u8) ![]u8 {
    const raw = try git.text(cwd, &.{ "rev-parse", "--path-format=absolute", "--git-common-dir" });
    defer a.free(raw);
    var guard = try paths.Guard.init(raw, "", true);
    defer guard.deinit();
    return paths.canonical(&guard);
}

fn verify(git: Client, result: *Result, common: []const u8) !void {
    var guard = try paths.Guard.init(result.path, "", true);
    defer guard.deinit();
    const actual = try paths.canonical(&guard);
    defer a.free(actual);
    if (!paths.equal(actual, result.path)) return error.WorktreePathCollision;
    const top = try git.text(result.path, &.{ "rev-parse", "--show-toplevel" });
    defer a.free(top);
    if (!paths.equal(top, result.path)) return error.WorktreePathCollision;
    const actual_common = try commonDirectory(git, result.path);
    defer a.free(actual_common);
    if (!paths.equal(actual_common, common)) return error.WorktreeRepositoryMismatch;
    const branch = try git.text(result.path, &.{ "symbolic-ref", "--quiet", "--short", "HEAD" });
    defer a.free(branch);
    if (!std.mem.eql(u8, branch, result.branch)) return error.WorktreeBranchMismatch;
    const head = try git.head(result.path);
    a.free(result.head_revision);
    result.head_revision = head;
    // The ownership receipt also requires Git's administrative worktree record
    // to name exactly this directory, rather than a copied .git pointer.
    const gitdir = try git.text(result.path, &.{ "rev-parse", "--path-format=absolute", "--git-dir" });
    defer a.free(gitdir);
    var meta = try paths.Guard.init(gitdir, "", true);
    defer meta.deinit();
    var pointer = try paths.Guard.init(gitdir, "gitdir", false);
    defer pointer.deinit();
    const handle = try pointer.openFile(c.GENERIC_READ, c.FILE_SHARE_READ);
    defer @import("win.zig").close(handle);
    var buffer: [16384]u8 = undefined;
    var got: c.DWORD = 0;
    if (c.ReadFile(handle, &buffer, buffer.len, &got, null) == 0 or got == buffer.len) return error.InvalidWorktreeMetadata;
    const expected = try std.fmt.allocPrint(a, "{s}\\.git", .{result.path});
    defer a.free(expected);
    if (!paths.equal(std.mem.trim(u8, buffer[0..got], "\r\n"), expected)) return error.WorktreePathCollision;
    result.exists = true;
    result.ready = true;
}

pub fn execute(req: rpc.Request) !Result {
    const task = try paths.uuid(req.task_id orelse return error.MissingTaskId);
    const prepare = std.mem.eql(u8, req.method, "worktrees.prepare");
    if (prepare) try paths.revision(req.base_revision orelse return error.MissingBaseRevision);
    var root_guard = try paths.Guard.init(req.root orelse return error.MissingRoot, "", true);
    defer root_guard.deinit();
    const root = try paths.canonical(&root_guard);
    var result_owned = false;
    errdefer if (!result_owned) a.free(root);
    const executable = try process.environment(std.unicode.utf8ToUtf16LeStringLiteral("SLTERM_GIT_EXECUTABLE"));
    defer a.free(executable);
    const parent = std.fs.path.dirname(executable) orelse return error.InvalidGitExecutable;
    if (!std.ascii.eqlIgnoreCase(std.fs.path.basename(executable), "git.exe")) return error.InvalidGitExecutable;
    if (executable.len > root.len and paths.equal(executable[0..root.len], root) and (executable[root.len] == '/' or executable[root.len] == '\\')) return error.UntrustedGitExecutable;
    var executable_guard = try paths.Guard.init(parent, std.fs.path.basename(executable), false);
    defer executable_guard.deinit();
    const pinned_executable = try executable_guard.openFile(c.GENERIC_READ, c.FILE_SHARE_READ);
    defer @import("win.zig").close(pinned_executable);
    const git = Client{ .executable = executable, .deadline = c.GetTickCount64() + 9000 };
    const top = try git.text(root, &.{ "rev-parse", "--show-toplevel" });
    defer a.free(top);
    if (!paths.equal(top, root)) return error.RepositoryRootRequired;
    const head = try git.head(root);
    errdefer if (!result_owned) a.free(head);
    const path = try std.fmt.allocPrint(a, "{s}.slterm-worktrees\\{s}", .{ root, task });
    errdefer if (!result_owned) a.free(path);
    const branch = try std.fmt.allocPrint(a, "slterm/task/{s}", .{task});
    errdefer if (!result_owned) a.free(branch);
    var result: Result = .{
        .root = root,
        .path = path,
        .branch = branch,
        .base_revision = try a.dupe(u8, head),
        .head_revision = head,
    };
    // From here Result owns root/head and all its allocations.
    result_owned = true;
    errdefer result.deinit();
    const sibling = std.fs.path.dirname(result.path).?;
    var existing_sibling: ?paths.Guard = null;
    defer if (existing_sibling) |*guard| guard.deinit();
    if (try paths.exists(sibling)) existing_sibling = try paths.Guard.init(sibling, "", true);
    const common = try commonDirectory(git, root);
    defer a.free(common);
    var common_guard = try paths.Guard.init(common, "", true);
    defer common_guard.deinit();
    const receipts = try std.fmt.allocPrint(a, "{s}\\slterm-tasks", .{common});
    defer a.free(receipts);
    const receipt_name = try std.fmt.allocPrint(a, "{s}.json", .{task});
    defer a.free(receipt_name);
    var receipt: ?paths.ReceiptFile = null;
    defer if (receipt) |file| file.close();
    if (try paths.exists(receipts)) {
        receipt = paths.ReceiptFile.open(receipts, receipt_name, false) catch |err| if (err == error.FileNotFound) null else return err;
    }
    const target_exists = try paths.exists(result.path);
    if (receipt) |file| {
        const parsed = try file.read();
        defer parsed.deinit();
        const saved = parsed.value;
        if (saved.version != 1 or !paths.equal(saved.root, root) or !paths.equal(saved.path, result.path) or !std.mem.eql(u8, saved.branch, result.branch)) return error.WorktreeReceiptMismatch;
        try paths.revision(saved.base_revision);
        const base = try a.dupe(u8, saved.base_revision);
        a.free(result.base_revision);
        result.base_revision = base;
        if (prepare and !std.mem.eql(u8, req.base_revision.?, base)) return error.BaseRevisionChanged;
        // Git metadata can exist before checkout finishes. Only the flushed
        // completion receipt authorizes reuse of an already populated task.
        if (!saved.complete) {
            result.exists = target_exists;
            result.completion_unknown = true;
            if (prepare) return error.WorktreeCompletionUnknown;
            return result;
        }
        if (target_exists) {
            const dot_git = try std.fmt.allocPrint(a, "{s}\\.git", .{result.path});
            defer a.free(dot_git);
            if (!try paths.exists(dot_git)) {
                result.exists = true;
                result.completion_unknown = true;
                if (prepare) return error.WorktreeCompletionUnknown;
                return result;
            }
            try verify(git, &result, common);
            if (prepare and !std.mem.eql(u8, req.if_match orelse return error.MissingWorktreeRevision, result.head_revision)) return error.WorktreeRevisionChanged;
        } else {
            result.completion_unknown = true;
            if (prepare) return error.WorktreeCompletionUnknown;
        }
        return result;
    }
    if (target_exists) return error.WorktreePathCollision;
    const reference = try std.fmt.allocPrint(a, "refs/heads/{s}", .{result.branch});
    defer a.free(reference);
    const branch_check = try git.run(root, &.{ "show-ref", "--verify", "--quiet", reference });
    defer branch_check.deinit();
    if (branch_check.code == 0) return error.WorktreeBranchCollision;
    if (branch_check.code != 1) return error.GitCommandFailed;
    if (!prepare) return result;
    if (!std.mem.eql(u8, req.base_revision.?, head)) return error.BaseRevisionChanged;
    try git.safeCheckout(root);
    if (!try paths.exists(sibling)) try paths.mkdir(sibling);
    var sibling_guard = try paths.Guard.init(sibling, "", true);
    defer sibling_guard.deinit();
    if (!try paths.exists(receipts)) try paths.mkdir(receipts);
    var receipt_guard = try paths.Guard.init(receipts, "", true);
    defer receipt_guard.deinit();
    const latest = try git.head(root);
    defer a.free(latest);
    if (!std.mem.eql(u8, latest, head)) return error.BaseRevisionChanged;
    receipt = try paths.ReceiptFile.open(receipts, receipt_name, true);
    try receipt.?.write(.{ .root = root, .path = result.path, .branch = result.branch, .base_revision = head });
    // Reserve and pin an empty directory before Git can populate it. A junction
    // cannot be substituted between validation and checkout.
    try paths.mkdir(result.path);
    var target_guard = try paths.Guard.init(result.path, "", true);
    defer target_guard.deinit();
    // Git for Windows passes this argument to its checkout child's GIT_DIR.
    // Keep that internal string short while the receipt and guards retain the
    // canonical absolute destination; Git rejects long explicit GIT_DIR values.
    const relative_target = try std.fmt.allocPrint(a, "..\\{s}.slterm-worktrees\\{s}", .{ std.fs.path.basename(root), task });
    defer a.free(relative_target);
    const created = try git.run(root, &.{ "worktree", "add", "--no-track", "-b", result.branch, "--", relative_target, head });
    defer created.deinit();
    if (created.code != 0) return error.WorktreeCompletionUnknown;
    try verify(git, &result, common);
    try receipt.?.write(.{ .root = root, .path = result.path, .branch = result.branch, .base_revision = result.base_revision, .complete = true });
    return result;
}
