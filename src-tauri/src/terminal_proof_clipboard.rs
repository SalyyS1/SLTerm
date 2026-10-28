//! Text-only Windows clipboard access, called only by the authorized proof window.
use std::ffi::c_void;

const TEXT_LIMIT: usize = 1024 * 1024;
const CF_UNICODETEXT: u32 = 13;
const GMEM_MOVEABLE: u32 = 2;

#[link(name = "user32")]
extern "system" {
    fn OpenClipboard(window: *mut c_void) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn GetClipboardData(format: u32) -> *mut c_void;
    fn SetClipboardData(format: u32, data: *mut c_void) -> *mut c_void;
    fn IsClipboardFormatAvailable(format: u32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
    fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    fn GlobalLock(memory: *mut c_void) -> *mut c_void;
    fn GlobalUnlock(memory: *mut c_void) -> i32;
    fn GlobalSize(memory: *mut c_void) -> usize;
}

struct Clipboard;
impl Clipboard {
    fn open(window: usize) -> Result<Self, String> {
        // A real owner HWND is required for EmptyClipboard + SetClipboardData.
        if window == 0 || unsafe { OpenClipboard(window as *mut c_void) } == 0 {
            return Err("Clipboard is busy or unavailable; try again".into());
        }
        Ok(Self)
    }
}
impl Drop for Clipboard {
    fn drop(&mut self) {
        unsafe { CloseClipboard() };
    }
}

struct OwnedMemory(*mut c_void);
impl Drop for OwnedMemory {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { GlobalFree(self.0) };
        }
    }
}

fn encode(text: &str) -> Result<Vec<u16>, String> {
    if text.len() > TEXT_LIMIT || text.contains('\0') {
        return Err("Clipboard text exceeds 1 MiB or contains a NUL character".into());
    }
    Ok(text.encode_utf16().chain([0]).collect())
}

fn decode(units: &[u16]) -> Result<String, String> {
    let end = units.iter().position(|unit| *unit == 0)
        .ok_or("Clipboard text is not NUL terminated")?;
    let text = String::from_utf16(&units[..end])
        .map_err(|_| "Clipboard text contains invalid Unicode")?;
    if text.len() > TEXT_LIMIT {
        return Err("Clipboard text exceeds 1 MiB".into());
    }
    Ok(text)
}

pub fn read(window: usize) -> Result<String, String> {
    let _clipboard = Clipboard::open(window)?;
    if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) } == 0 {
        return Err("Clipboard does not contain text".into());
    }
    let memory = unsafe { GetClipboardData(CF_UNICODETEXT) };
    if memory.is_null() {
        return Err("Cannot read clipboard text".into());
    }
    let bytes = unsafe { GlobalSize(memory) };
    if bytes < 2 || bytes > (TEXT_LIMIT + 1) * 2 || bytes % 2 != 0 {
        return Err("Clipboard text allocation is invalid or exceeds 1 MiB of UTF-16 units".into());
    }
    let pointer = unsafe { GlobalLock(memory) };
    if pointer.is_null() {
        return Err("Cannot lock clipboard text".into());
    }
    // Clipboard stays open and GlobalLock stays held throughout the bounded read.
    let result = decode(unsafe { std::slice::from_raw_parts(pointer.cast::<u16>(), bytes / 2) });
    unsafe { GlobalUnlock(memory) };
    result
}

pub fn write(window: usize, text: &str) -> Result<(), String> {
    let units = encode(text)?;
    let mut memory = OwnedMemory(unsafe { GlobalAlloc(GMEM_MOVEABLE, units.len() * 2) });
    if memory.0.is_null() {
        return Err("Cannot allocate clipboard text".into());
    }
    let pointer = unsafe { GlobalLock(memory.0) };
    if pointer.is_null() {
        return Err("Cannot lock clipboard allocation".into());
    }
    unsafe {
        std::ptr::copy_nonoverlapping(units.as_ptr(), pointer.cast::<u16>(), units.len());
        GlobalUnlock(memory.0);
    }
    let _clipboard = Clipboard::open(window)?;
    if unsafe { EmptyClipboard() } == 0 {
        return Err("Cannot replace clipboard contents".into());
    }
    if unsafe { SetClipboardData(CF_UNICODETEXT, memory.0) }.is_null() {
        return Err("Cannot set clipboard text".into());
    }
    // Windows owns the allocation after successful SetClipboardData.
    memory.0 = std::ptr::null_mut();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_round_trip_preserves_vietnamese_emoji_and_line_breaks() {
        let text = "Xin chào Việt Nam 🦄\r\ndòng hai\n";
        assert_eq!(decode(&encode(text).unwrap()).unwrap(), text);
        assert_eq!(decode(&encode("").unwrap()).unwrap(), "");
    }

    #[test]
    fn malformed_or_oversized_text_is_rejected_before_clipboard_write() {
        assert!(encode("before\0after").is_err());
        assert!(encode(&"x".repeat(TEXT_LIMIT + 1)).is_err());
        assert!(decode(&[b'a' as u16]).is_err());
        assert!(decode(&[0xd800, 0]).is_err());
        assert!(decode(&[0x20ac].repeat(TEXT_LIMIT / 3 + 1).into_iter().chain([0]).collect::<Vec<_>>()).is_err());
    }
}
