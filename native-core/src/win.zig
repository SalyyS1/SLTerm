pub const c = @import("windows-api");

pub fn close(handle: c.HANDLE) void {
    if (handle != null and handle != c.INVALID_HANDLE_VALUE) _ = c.CloseHandle(handle);
}

pub fn writeAll(handle: c.HANDLE, bytes: []const u8) !void {
    var offset: usize = 0;
    while (offset < bytes.len) {
        var written: c.DWORD = 0;
        if (c.WriteFile(handle, bytes[offset..].ptr, @intCast(bytes.len - offset), &written, null) == 0 or written == 0)
            return error.WriteFailed;
        offset += written;
    }
}
