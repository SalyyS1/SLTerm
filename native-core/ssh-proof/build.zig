const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{ .cpu_arch = .x86_64, .os_tag = .windows, .abi = .gnu });
    const source = b.option([]const u8, "libssh2-source", "Verified libssh2 source directory") orelse @panic("libssh2-source required");
    const library = b.option([]const u8, "libssh2-library", "Compiled static archive") orelse @panic("libssh2-library required");
    const module = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = target,
        .optimize = .ReleaseSafe,
        .link_libc = true,
    });
    module.addIncludePath(.{ .cwd_relative = b.pathJoin(&.{ source, "include" }) });
    module.addCSourceFile(.{ .file = b.path("ssh-client.c"), .flags = &.{ "-DLIBSSH2_STATIC", "-Wall", "-Wextra" } });
    module.addObjectFile(.{ .cwd_relative = library });
    for ([_][]const u8{ "ws2_32", "bcrypt", "crypt32" }) |name| module.linkSystemLibrary(name, .{});
    b.installArtifact(b.addExecutable(.{ .name = "slterm-ssh-proof", .root_module = module }));
}
