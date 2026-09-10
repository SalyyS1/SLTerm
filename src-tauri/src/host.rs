// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//! Shell services the frontend asks its host for.
//!
//! Everything here concerns the window, the desktop or this process. None of it
//! concerns SLTerm's data — tabs, blocks, config and PTYs all live in the Go
//! backend, and this file must never grow a second opinion about them.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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
            build_time: build_time(),
        }
    }
}

/// Unix seconds this binary was built at, stamped by build.rs.
///
/// Was hardcoded to 0, which the About modal rendered as the Unix epoch — worse
/// than showing nothing, because it looks like a real answer and makes it
/// impossible to tell which build a bug report came from.
fn build_time() -> i64 {
    env!("SLTERM_BUILD_TIME").parse().unwrap_or(0)
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
///
/// App data/config/resources are inherently app-owned. Existing paths outside
/// those roots require a fresh native confirmation, which is the minimal real
/// approval boundary until repository grants exist. Renderer input never adds a
/// persistent root.
#[tauri::command]
pub fn host_open_native_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let requested = validate_native_path_input(&path)?;
    let canonical = requested
        .canonicalize()
        .map_err(|_| "cannot open path: it does not exist or is inaccessible".to_string())?;
    if !canonical.is_file() && !canonical.is_dir() {
        return Err("cannot open path: unsupported target type".to_string());
    }

    let (data_home, config_home) = crate::data_dir_args();
    let mut owned_roots = vec![data_home, config_home, crate::app_root(&app)];
    if let Ok(cache) = app.path().app_cache_dir() {
        owned_roots.push(cache);
    }
    let trusted = is_within_owned_roots(&canonical, &owned_roots);
    if !trusted {
        let display_name = requested
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty() && *name != "." && *name != "..")
            .map(|name| name.chars().take(80).collect::<String>())
            .unwrap_or_else(|| "the selected item".to_string());
        let approved = app
            .dialog()
            .message(format!(
                "Allow SLTerm to open {display_name} in the desktop?"
            ))
            .title("Open local path")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Open".to_string(),
                "Cancel".to_string(),
            ))
            .blocking_show();
        if !approved {
            return Err("path was not approved".to_string());
        }
    }
    open_with_desktop(&canonical.to_string_lossy())
}

fn validate_native_path_input(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.contains('\0') {
        return Err("cannot open path: invalid input".to_string());
    }
    let path = PathBuf::from(path);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("cannot open path: an absolute normalized path is required".to_string());
    }
    Ok(path)
}

fn is_within_owned_roots(canonical: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| {
        root.canonicalize()
            .map(|root| canonical.starts_with(root))
            .unwrap_or(false)
    })
}

fn open_with_desktop(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let operation: Vec<u16> = std::ffi::OsStr::new("open")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let target_wide: Vec<u16> = std::ffi::OsStr::new(target)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                0 as HWND,
                operation.as_ptr(),
                target_wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as usize <= 32 {
            return Err("cannot open the selected path with the desktop handler".to_string());
        }
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    let (program, args): (&str, Vec<&str>) = ("open", vec![]);
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let (program, args): (&str, Vec<&str>) = ("xdg-open", vec![]);
    std::process::Command::new(program)
        .args(args)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|_| "cannot open the selected path with the desktop handler".to_string())
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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{is_within_owned_roots, validate_native_path_input};

    #[test]
    fn native_path_requires_absolute_normalized_input() {
        assert!(validate_native_path_input("").is_err());
        assert!(validate_native_path_input("relative/file").is_err());
        assert!(validate_native_path_input("/tmp/../etc/passwd").is_err());
        assert!(validate_native_path_input("/tmp/a\0b").is_err());
        assert!(validate_native_path_input("/tmp/file").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_not_owned() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!("slterm-native-path-{}", std::process::id()));
        let owned = base.join("owned");
        let outside = base.join("outside");
        fs::create_dir_all(&owned).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret"), b"secret").unwrap();
        symlink(outside.join("secret"), owned.join("link")).unwrap();

        let canonical = owned.join("link").canonicalize().unwrap();
        assert!(!is_within_owned_roots(&canonical, &[owned]));
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn native_path_accepts_absolute_windows_and_unc_paths() {
        assert!(validate_native_path_input(r"C:\\Users\\me\\project").is_ok());
        assert!(validate_native_path_input(r"\\server\\share\\project").is_ok());
        assert!(validate_native_path_input(r"C:\\Users\\me\\..\\secret").is_err());
    }
}

/// Event asking the page whether the window may close.
///
/// The shell cannot answer this itself: whether to confirm depends on
/// `window:confirmclose`, on whether the workspace has unsaved tabs, and on how
/// many windows are open — all of which live in the backend and the page. So the
/// shell asks, and the page replies by calling `host_close_window`.
pub const CLOSE_REQUESTED_EVENT: &str = "host://close-requested";

/// Closes the window for real, bypassing the confirm round trip.
///
/// Called by the page once it has decided — either because no confirmation was
/// needed or because the user confirmed. Sets a flag the close handler reads so
/// the request is not bounced back to the page a second time.
#[tauri::command]
pub fn host_close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::set_close_confirmed(true);
    window.close().map_err(|e| e.to_string())
}

/// Marks an update as installing, so the close path stops asking questions.
///
/// The updater force-quits the app to hand over to its installer, with nobody at
/// the keyboard. Any confirm-on-quit prompt in that path either blocks the
/// install or lets the installer run against a live process; both end with a
/// half-installed app. The frontend sets this immediately before it asks the
/// updater to install, and `close_requested_should_confirm` reads it.
#[tauri::command]
pub fn host_set_update_in_progress(in_progress: bool) {
    crate::set_update_in_progress(in_progress);
}
