const std = @import("std");

pub const Handle = *anyopaque;
pub extern "kernel32" fn LoadLibraryExW([*:0]const u16, ?Handle, u32) callconv(.winapi) ?Handle;
pub extern "kernel32" fn GetProcAddress(Handle, [*:0]const u8) callconv(.winapi) ?*const anyopaque;
pub extern "kernel32" fn FreeLibrary(Handle) callconv(.winapi) i32;
pub extern "kernel32" fn AcquireSRWLockExclusive(*usize) callconv(.winapi) void;
pub extern "kernel32" fn ReleaseSRWLockExclusive(*usize) callconv(.winapi) void;
pub extern "kernel32" fn GetCurrentProcessId() callconv(.winapi) u32;
pub extern "kernel32" fn GetTickCount64() callconv(.winapi) u64;
pub extern "kernel32" fn CreateFileW([*:0]const u16, u32, u32, ?*anyopaque, u32, u32, ?Handle) callconv(.winapi) ?Handle;
pub extern "kernel32" fn CloseHandle(Handle) callconv(.winapi) i32;
pub extern "kernel32" fn DeleteFileW([*:0]const u16) callconv(.winapi) i32;
pub extern "kernel32" fn MoveFileExW([*:0]const u16, [*:0]const u16, u32) callconv(.winapi) i32;
pub extern "kernel32" fn GetTempPathW(u32, [*]u16) callconv(.winapi) u32;
pub extern "kernel32" fn CreateDirectoryW([*:0]const u16, ?*anyopaque) callconv(.winapi) i32;
pub extern "kernel32" fn RemoveDirectoryW([*:0]const u16) callconv(.winapi) i32;

pub fn wide(path: []const u8) ![:0]u16 {
    return std.unicode.utf8ToUtf16LeAllocZ(std.heap.page_allocator, path);
}

pub fn remove(path: []const u8) void {
    const value = wide(path) catch return;
    defer std.heap.page_allocator.free(value);
    _ = DeleteFileW(value);
}

/// CREATE_NEW reserves an owned backup name without truncating an existing file.
pub fn reserve(path: []const u8) !void {
    const value = try wide(path);
    defer std.heap.page_allocator.free(value);
    const handle = CreateFileW(value, 0x40000000, 0, null, 1, 0x80, null) orelse return error.BackupCreateFailed;
    if (@intFromPtr(handle) == std.math.maxInt(usize)) return error.BackupCreateFailed;
    if (CloseHandle(handle) == 0) return error.BackupCloseFailed;
}

pub fn publish(source: []const u8, destination: []const u8) !void {
    const from = try wide(source);
    defer std.heap.page_allocator.free(from);
    const to = try wide(destination);
    defer std.heap.page_allocator.free(to);
    // REPLACE_EXISTING | WRITE_THROUGH, on the same volume as the database.
    if (MoveFileExW(from, to, 0x1 | 0x8) == 0) return error.BackupPublishFailed;
}
