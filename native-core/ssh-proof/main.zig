const std = @import("std");

extern "c" fn libssh2_init(c_int) c_int;
extern "c" fn libssh2_exit() void;
extern "c" fn libssh2_version(c_int) ?[*:0]const u8;
extern "c" fn ssh_proof_run() c_int;

// Deliberately isolated C ABI spike; no application or credential integration.
pub fn main() u8 {
    const version = libssh2_version(0) orelse return 1;
    if (!std.mem.eql(u8, std.mem.span(version), "1.11.2_DEV")) return 1;
    if (libssh2_init(0) != 0) return 1;
    defer libssh2_exit();
    return @intCast(ssh_proof_run());
}
