// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//! Shell services the frontend asks its host for.
//!
//! Everything here concerns the window, the desktop or this process. None of it
//! concerns SLTerm's data — tabs, blocks, config and PTYs all live in the Go
//! backend, and this file must never grow a second opinion about them.

use std::path::Path;

use serde::Serialize;

/// The values the frontend reads synchronously.
///
/// Electron answered these over `ipcRenderer.sendSync`. Tauri's `invoke` is
/// async only, and the frontend needs some of them before its bundle has
/// finished evaluating — `frontend/wave.ts` reads the platform at module scope —
/// so they are injected into the page as a frozen snapshot rather than fetched.
/// Only values that are fixed for the life of the window belong here; anything
/// that changes has to arrive as an event.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HostSnapshot {
    pub web_endpoint: String,
    pub ws_endpoint: String,
    pub auth_key: String,
    /// Node's name for the platform, not Rust's: the frontend compares against
    /// "darwin" and "win32" in its keyboard and path handling.
    pub platform: &'static str,
    pub is_dev: bool,
    pub user_name: String,
    pub host_name: String,
    pub config_dir: String,
    pub version: String,
    pub build_time: i64,
}

impl HostSnapshot {
    pub fn new(
        web_endpoint: String,
        ws_endpoint: String,
        auth_key: String,
        config_dir: &Path,
    ) -> Self {
        Self {
            web_endpoint,
            ws_endpoint,
            auth_key,
            platform: node_platform(),
            is_dev: cfg!(debug_assertions),
            user_name: user_name(),
            host_name: host_name(),
            config_dir: config_dir.to_string_lossy().to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            build_time: 0,
        }
    }
}

/// Maps the build target to the platform names Node uses, which is what the
/// frontend's `NodeJS.Platform` comparisons expect.
fn node_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
}

fn user_name() -> String {
    let var = if cfg!(windows) { "USERNAME" } else { "USER" };
    std::env::var(var).unwrap_or_else(|_| "user".to_string())
}

fn host_name() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "localhost".to_string())
}

/// Hands a URL to the desktop's default handler.
///
/// Refuses anything but http and https: this is reachable from rendered markdown
/// and terminal output, so a `file:` or custom-scheme URL arriving here would let
/// content inside a block launch an arbitrary local handler.
#[tauri::command]
pub fn host_open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("refusing to open {url} externally: not http(s)"));
    }
    open_with_desktop(&url)
}

/// Reveals a path in the desktop's file manager.
#[tauri::command]
pub fn host_open_native_path(path: String) -> Result<(), String> {
    open_with_desktop(&path)
}

fn open_with_desktop(target: &str) -> Result<(), String> {
    let (program, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![])
    } else if cfg!(target_os = "windows") {
        // start is a cmd builtin, and its first quoted argument is the window
        // title, so it needs an empty one before the target.
        ("cmd", vec!["/C", "start", ""])
    } else {
        ("xdg-open", vec![])
    };
    std::process::Command::new(program)
        .args(args)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot open {target}: {e}"))
}

#[tauri::command]
pub fn host_set_fullscreen(window: tauri::Window, is_fullscreen: bool) -> Result<(), String> {
    window
        .set_fullscreen(is_fullscreen)
        .map_err(|e| e.to_string())
}

/// Writes a frontend log line to the host's stderr, where it lands beside the Go
/// backend's output in the same stream a user would send us.
#[tauri::command]
pub fn host_log(message: String) {
    eprintln!("[frontend] {message}");
}
