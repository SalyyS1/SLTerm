//! Read-only Windows process counters; never reads command lines or credentials.
use std::ffi::c_void;
use std::mem::size_of;

type Handle = *mut c_void;
#[repr(C)]
#[derive(Default)]
struct FileTime { low: u32, high: u32 }
impl FileTime { fn ticks(&self) -> u64 { (u64::from(self.high) << 32) | u64::from(self.low) } }
#[repr(C)]
struct ProcessEntry {
    size: u32, usage: u32, pid: u32, heap: usize, module: u32, threads: u32,
    parent: u32, priority: i32, flags: u32, name: [u16; 260],
}
#[repr(C)]
#[derive(Default)]
struct MemoryCounters {
    size: u32, page_faults: u32, peak_working: usize, working: usize,
    peak_paged: usize, paged: usize, peak_nonpaged: usize, nonpaged: usize,
    pagefile: usize, peak_pagefile: usize, private: usize,
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
    fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
    fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn CloseHandle(handle: Handle) -> i32;
    fn GetProcessTimes(handle: Handle, created: *mut FileTime, exited: *mut FileTime,
        kernel: *mut FileTime, user: *mut FileTime) -> i32;
    fn K32GetProcessMemoryInfo(handle: Handle, counters: *mut MemoryCounters, size: u32) -> i32;
    fn GetLastError() -> u32;
    fn GetSystemTimeAsFileTime(time: *mut FileTime);
}
struct OwnedHandle(Handle);
impl Drop for OwnedHandle { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }

pub struct Entry { pub pid: u32, pub parent: u32, pub name: String }
pub struct Counters { pub created: u64, pub cpu_ticks: u64, pub working: u64, pub private: u64 }

pub fn inventory() -> Result<(u64, Vec<Entry>), String> {
    let mut captured = FileTime::default();
    unsafe { GetSystemTimeAsFileTime(&mut captured); }
    let raw = unsafe { CreateToolhelp32Snapshot(2, 0) };
    if raw == -1isize as Handle { return Err(std::io::Error::last_os_error().to_string()); }
    let snapshot = OwnedHandle(raw);
    let mut entry: ProcessEntry = unsafe { std::mem::zeroed() };
    entry.size = size_of::<ProcessEntry>() as u32;
    let mut entries = Vec::new();
    let mut found = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while found != 0 {
        let length = entry.name.iter().position(|value| *value == 0).unwrap_or(entry.name.len());
        entries.push(Entry { pid: entry.pid, parent: entry.parent, name: String::from_utf16_lossy(&entry.name[..length]) });
        found = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    if unsafe { GetLastError() } != 18 { return Err(std::io::Error::last_os_error().to_string()); }
    Ok((captured.ticks(), entries))
}

pub fn counters(pid: u32) -> Option<Counters> {
    // Query information + VM_READ are required for the memory counters.
    let raw = unsafe { OpenProcess(0x1000 | 0x0010, 0, pid) };
    if raw.is_null() { return None; }
    let handle = OwnedHandle(raw);
    let (mut created, mut exited, mut kernel, mut user) = (FileTime::default(), FileTime::default(), FileTime::default(), FileTime::default());
    if unsafe { GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user) } == 0 { return None; }
    let mut memory = MemoryCounters { size: size_of::<MemoryCounters>() as u32, ..Default::default() };
    if unsafe { K32GetProcessMemoryInfo(handle.0, &mut memory, size_of::<MemoryCounters>() as u32) } == 0 { return None; }
    Some(Counters { created: created.ticks(), cpu_ticks: kernel.ticks() + user.ticks(), working: memory.working as u64, private: memory.private as u64 })
}
