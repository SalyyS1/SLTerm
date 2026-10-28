const std = @import("std");

// Quote every argv element using the Windows CRT backslash/quote convention.
// No shell string interpolation is used when selecting the executable or cwd.
pub fn encode(allocator: std.mem.Allocator, executable: []const u8, args: []const []const u8) ![:0]u16 {
    if (std.mem.indexOfScalar(u8, executable, 0) != null) return error.InvalidArgument;
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);
    try quote(allocator, &out, executable);
    for (args) |arg| {
        try out.append(allocator, ' ');
        try quote(allocator, &out, arg);
    }
    return std.unicode.utf8ToUtf16LeAllocZ(allocator, out.items);
}

fn quote(allocator: std.mem.Allocator, out: *std.ArrayList(u8), arg: []const u8) !void {
    if (std.mem.indexOfScalar(u8, arg, 0) != null) return error.InvalidArgument;
    try out.append(allocator, '"');
    var slashes: usize = 0;
    for (arg) |ch| {
        if (ch == '\\') {
            slashes += 1;
            continue;
        }
        const count = if (ch == '"') slashes * 2 + 1 else slashes;
        try out.appendNTimes(allocator, '\\', count);
        slashes = 0;
        try out.append(allocator, ch);
    }
    try out.appendNTimes(allocator, '\\', slashes * 2);
    try out.append(allocator, '"');
}

test "Windows command line protects quotes empty values and trailing backslashes" {
    const a = std.testing.allocator;
    const encoded = try encode(a, "C:\\Program Files\\shell.exe", &.{ "", "a\"b", "C:\\tail\\" });
    defer a.free(encoded);
    const text = try std.unicode.utf16LeToUtf8Alloc(a, encoded);
    defer a.free(text);
    try std.testing.expectEqualStrings("\"C:\\Program Files\\shell.exe\" \"\" \"a\\\"b\" \"C:\\tail\\\\\"", text);
    try std.testing.expectError(error.InvalidArgument, encode(a, "shell", &.{"bad\x00value"}));
}
