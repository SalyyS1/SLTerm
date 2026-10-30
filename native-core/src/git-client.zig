const std = @import("std");
const process = @import("git-process.zig");
const paths = @import("git-worktree-path.zig");
const a = std.heap.page_allocator;

pub const Client = struct {
    executable: []const u8,
    deadline: u64,

    pub fn run(self: Client, cwd: []const u8, args: []const []const u8) !process.Result {
        const fixed = [_][]const u8{
            "--no-pager", "--no-optional-locks",
            "-c",         "core.hooksPath=NUL",
            "-c",         "core.fsmonitor=false",
            "-c",         "core.attributesFile=NUL",
            "-c",         "core.symlinks=false",
            "-c",         "submodule.recurse=false",
            "-c",         "protocol.allow=never",
            "-c",         "gc.auto=0",
            "-c",         "maintenance.auto=false",
            "-c",         "core.quotePath=false",
            "-c",         "core.autocrlf=false",
            "-c",         "core.protectNTFS=true",
            "-c",         "core.longpaths=true",
            "-c",         "core.sparseCheckout=false",
            "-c",         "checkout.workers=1",
        };
        const argv = try a.alloc([]const u8, fixed.len + args.len);
        defer a.free(argv);
        @memcpy(argv[0..fixed.len], &fixed);
        @memcpy(argv[fixed.len..], args);
        return process.run(self.executable, cwd, argv, self.deadline);
    }

    pub fn text(self: Client, cwd: []const u8, args: []const []const u8) ![]u8 {
        const result = try self.run(cwd, args);
        defer result.deinit();
        if (result.code != 0) return error.GitCommandFailed;
        return a.dupe(u8, std.mem.trim(u8, result.stdout, "\r\n"));
    }

    pub fn head(self: Client, cwd: []const u8) ![]u8 {
        const hash = try self.text(cwd, &.{ "rev-parse", "--verify", "HEAD" });
        errdefer a.free(hash);
        try paths.revision(hash);
        return hash;
    }

    // Includes can select configuration based on the new worktree path. Reject
    // them as well as any configured filters instead of invoking repo scripts.
    pub fn safeCheckout(self: Client, cwd: []const u8) !void {
        const result = try self.run(cwd, &.{ "config", "--includes", "--get-regexp", "^(filter\\.|include\\.|includeif\\.)" });
        defer result.deinit();
        if (result.code == 0) return error.UnsafeGitCheckoutConfiguration;
        if (result.code != 1) return error.GitCommandFailed;
    }
};
