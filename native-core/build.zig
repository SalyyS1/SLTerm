const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{ .default_target = .{ .cpu_arch = .x86_64, .os_tag = .windows, .abi = .gnu } });
    const optimize = b.standardOptimizeOption(.{});
    const module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    module.linkSystemLibrary("kernel32", .{});
    module.linkSystemLibrary("advapi32", .{});
    // Zig 0.17 translates C headers at build time, not through @cImport.
    const bindings = b.addTranslateC(.{
        .root_source_file = b.path("src/windows-api.h"),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("windows-api", bindings.createModule());
    const exe = b.addExecutable(.{ .name = "slterm-core-proof", .root_module = module });
    b.installArtifact(exe);
    const tests = b.addTest(.{ .root_module = module });
    b.step("test", "Run core protocol and quoting tests").dependOn(&b.addRunArtifact(tests).step);
}
