// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//! Tauri shell for SLTerm.
//!
//! This replaces the Electron main process. It owns the window and nothing else:
//! all state, PTYs, config and RPC stay in the Go backend (`wavesrv`), which is
//! spawned here as a sidecar and talked to over the loopback HTTP/WebSocket
//! endpoints it already exposes. Electron did exactly this — spawn the server as
//! a child process and read its `WAVESRV-ESTART` handshake off stderr — so the
//! contract is unchanged and this file deliberately holds no business logic.

mod host;
mod menu;
mod window;

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::Rng;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use host::HostSnapshot;

/// Set while an update is installing.
///
/// The updater force-quits the app to run its installer, and it does so with
/// nobody at the keyboard. A confirm-on-quit prompt in that path would either
/// block the install or let it proceed against a live process, so the close
/// handler checks this and skips straight to shutdown.
static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub fn set_update_in_progress(in_progress: bool) {
    UPDATE_IN_PROGRESS.store(in_progress, Ordering::SeqCst);
}

/// Set once the page has decided the window may close.
///
/// Without it, `host_close_window` would trip the close handler again and the
/// window would ask the page a second time — a loop, not a prompt.
static CLOSE_CONFIRMED: AtomicBool = AtomicBool::new(false);

pub fn set_close_confirmed(confirmed: bool) {
    CLOSE_CONFIRMED.store(confirmed, Ordering::SeqCst);
}

/// Whether the close request may proceed without asking the page.
///
/// True once the page has confirmed, and true during an update — the updater
/// force-quits with nobody at the keyboard, so a prompt there would either block
/// the install or let it run against a live process.
fn close_may_proceed() -> bool {
    CLOSE_CONFIRMED.load(Ordering::SeqCst) || update_in_progress()
}

fn update_in_progress() -> bool {
    UPDATE_IN_PROGRESS.load(Ordering::SeqCst)
}

/// Endpoints the Go server picked, learned from its stderr handshake.
#[derive(Clone, Debug, Default)]
struct Endpoints {
    web: String,
    ws: String,
    auth_key: String,
}

/// Owns the sidecar so it can be killed when the app exits. Without this the Go
/// process outlives the window and keeps the data-dir lock held.
struct Backend(Mutex<Option<Child>>);

impl Backend {
    /// Kills the sidecar and waits for it, so the data-dir lock is released
    /// before this function returns.
    ///
    /// `RunEvent::Exit` is not enough on its own: whether it fires when the
    /// updater terminates the app is unverified, and an installer that starts
    /// while `wavesrv` still holds `wave.lock` produces a post-update launch
    /// that cannot acquire it. So this is called explicitly on the paths that
    /// end the process, with `RunEvent::Exit` kept only as a backstop.
    /// Idempotent — whichever path runs first takes the child.
    fn shutdown(&self) {
        let child = self.0.lock().ok().and_then(|mut guard| guard.take());
        if let Some(mut child) = child {
            // Closing stdin asks wavesrv to execute its awaited shutdown sequence.
            // Give that bounded path time to flush state and release wave.lock;
            // killing the exact sidecar remains the last resort.
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) if Instant::now() < deadline => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            if let Err(e) = child.kill() {
                eprintln!("[slterm] could not terminate wavesrv after shutdown deadline: {e}");
            }
            if let Err(e) = child.wait() {
                eprintln!("[slterm] could not reap wavesrv: {e}");
            }
        }
    }
}

/// Generates the shared secret the frontend presents on every request. Electron
/// created this the same way and handed it to the server via env.
fn new_auth_key() -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut rng = rand::thread_rng();
    (0..64).map(|_| HEX[rng.gen_range(0..16)] as char).collect()
}

/// Locates the directory that holds the app's `bin/` and `schema/` trees.
///
/// The backend needs this as `SLTERM_APP_PATH`: it resolves the `wsh` binary from
/// `<app path>/bin` and copies it into the user's data dir for shell integration and
/// remote connections. Without it that lookup is relative and silently fails, which
/// shows up as a non-fatal "could not resolve wsh binary" line and a missing CLI.
fn app_root(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        if dir.join("bin").is_dir() {
            return dir;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("dist")
}

/// Locates the packaged `wavesrv` binary. Falls back to the repo's dist/ tree so
/// `cargo run` works from a source checkout without packaging first.
fn wavesrv_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Only Windows binaries carry the extension; appending it unconditionally is
    // what broke the packaged macOS and Linux Electron builds.
    let bin_name = if cfg!(windows) {
        format!("wavesrv.{}.exe", arch_tag())
    } else {
        format!("wavesrv.{}", arch_tag())
    };

    if let Ok(dir) = app.path().resource_dir() {
        let packaged = dir.join("bin").join(&bin_name);
        if packaged.exists() {
            return Ok(packaged);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("dist")
        .join("bin")
        .join(&bin_name);
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!(
        "could not find {bin_name} in resources or dist/bin"
    ))
}

/// Matches the naming the Go build uses: x64 rather than x86_64/amd64.
fn arch_tag() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

fn data_dir_args() -> (PathBuf, PathBuf) {
    // Mirrors the Electron layout so an existing install's data is found rather
    // than starting from an empty workspace.
    let base = dirs_home().join(".slterm");
    (base.join("data"), base.join("config"))
}

fn dirs_home() -> PathBuf {
    #[cfg(windows)]
    let home = std::env::var("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var("HOME");
    PathBuf::from(home.unwrap_or_else(|_| ".".to_string()))
}

/// Spawns the Go backend and blocks until it reports its endpoints.
///
/// The handshake line looks like:
///   WAVESRV-ESTART ws:127.0.0.1:41561 web:127.0.0.1:42047 version:0.19.1 buildtime:0
fn start_backend(app: &tauri::AppHandle) -> Result<(Child, Endpoints), String> {
    let exe = wavesrv_path(app)?;
    let (data_home, config_home) = data_dir_args();
    std::fs::create_dir_all(&data_home).map_err(|e| format!("cannot create data dir: {e}"))?;
    std::fs::create_dir_all(&config_home).map_err(|e| format!("cannot create config dir: {e}"))?;

    let auth_key = new_auth_key();
    let mut child = Command::new(&exe)
        .env("SLTERM_AUTH_KEY", &auth_key)
        .env("SLTERM_DATA_HOME", &data_home)
        .env("SLTERM_CONFIG_HOME", &config_home)
        // Where the backend finds bin/ and schema/. It copies wsh out of bin/ for
        // shell integration and remote connections.
        .env("SLTERM_APP_PATH", app_root(app))
        // The server terminates itself when stdin reaches EOF, which is how it
        // gets cleaned up if this process dies without killing it.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot spawn {}: {e}", exe.display()))?;

    let stderr = child.stderr.take().ok_or("no stderr on the backend")?;
    let mut reader = BufReader::new(stderr);
    let mut endpoints = Endpoints {
        auth_key: auth_key.clone(),
        ..Default::default()
    };

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return Err("backend exited before reporting its endpoints".into()),
            Ok(_) => {}
            Err(e) => return Err(format!("error reading backend stderr: {e}")),
        }
        eprint!("[wavesrv] {line}");
        if let Some(rest) = line.trim().strip_prefix("WAVESRV-ESTART ") {
            for field in rest.split_whitespace() {
                if let Some(v) = field.strip_prefix("ws:") {
                    endpoints.ws = v.to_string();
                } else if let Some(v) = field.strip_prefix("web:") {
                    endpoints.web = v.to_string();
                }
            }
            break;
        }
    }
    if endpoints.web.is_empty() || endpoints.ws.is_empty() {
        return Err(format!("incomplete handshake: {endpoints:?}"));
    }

    // Keep draining stderr so the backend never blocks on a full pipe, and so
    // its logs stay visible.
    std::thread::spawn(move || {
        let mut line = String::new();
        while let Ok(n) = reader.read_line(&mut line) {
            if n == 0 {
                break;
            }
            eprint!("[wavesrv] {line}");
            line.clear();
        }
    });

    Ok((child, endpoints))
}

/// The snapshot the frontend reads before anything else.
///
/// `frontend/util/tauri-host.ts` answers HostApi's synchronous getters from this
/// object, so it has to exist before the bundle evaluates — `frontend/wave.ts`
/// reads the platform at module scope. That is why it ships as an initialization
/// script on the window rather than an `eval` after the fact or a command the
/// frontend would have to await.
fn host_init_script(snapshot: &HostSnapshot) -> String {
    let json = serde_json::to_string(snapshot).unwrap_or_else(|_| "null".to_string());
    format!(
        r#"
(() => {{
  Object.defineProperty(window, "__SLTERM_HOST__", {{
    value: Object.freeze({json}),
    writable: false,
    configurable: false,
  }});
}})();
"#
    )
}

pub fn run() {
    tauri::Builder::default()
        // Registered first, which the plugin requires. Without it a second
        // launch spawns a second wavesrv that cannot take the data-dir lock, and
        // the user sees a lock error instead of their existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Backend(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            host::host_open_external,
            host::host_open_native_path,
            host::host_set_fullscreen,
            host::host_log,
            host::host_set_update_in_progress,
            host::host_close_window,
            menu::host_show_context_menu,
        ])
        .on_menu_event(|app, event| {
            // The frontend owns what every entry does; it registered a handler
            // under this id when it built the menu.
            menu::emit_menu_click(app, event.id().as_ref());
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let (data_home, config_home) = data_dir_args();
            let (child, endpoints) = match start_backend(&handle) {
                Ok(v) => v,
                Err(e) => {
                    // A dialog, not just stderr: the previous behaviour printed
                    // to a stream nobody reads and exited, so a failed launch
                    // looked like the app simply not starting. The data-dir lock
                    // is the failure a user is most likely to hit, and it is the
                    // one whose raw message ("acquiring wave lock") says nothing
                    // about the actual cause, so it gets named.
                    let detail = if e.contains("lock") {
                        format!(
                            "{e}\n\nAnother copy of SLTerm is already running, or an older \
                             install is still open. Close it and try again."
                        )
                    } else {
                        e.clone()
                    };
                    eprintln!("[slterm] fatal: {e}");
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    handle
                        .dialog()
                        .message(detail)
                        .title("SLTerm could not start")
                        .kind(MessageDialogKind::Error)
                        .show(|_| {});
                    return Err(e.into());
                }
            };
            app.state::<Backend>().0.lock().unwrap().replace(child);

            let snapshot = HostSnapshot::new(
                endpoints.web.clone(),
                endpoints.ws.clone(),
                endpoints.auth_key.clone(),
                &config_home,
            );

            let settings = window::ShellSettings::load(&config_home);
            // Decorations are per-OS, not per-app. macOS draws the traffic
            // lights in the window frame itself, so an undecorated window there
            // has no controls at all and the frontend has nothing it can put
            // back; it keeps its decorations and the frontend fills the inset.
            // Windows and Linux get a fully undecorated window and the frontend
            // draws all three buttons.
            let decorations =
                settings.native_titlebar || window::keeps_decorations_with_custom_titlebar();

            // The window is built here rather than declared in tauri.conf.json
            // because the snapshot depends on endpoints only known after the
            // backend handshake, and an initialization script has to be attached
            // at construction to be guaranteed to run before the bundle. Tauri
            // re-injects it on every navigation, so a reload is covered too.
            #[allow(unused_mut)]
            let mut builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("SLTerm")
                    .inner_size(window::DEFAULT_WIDTH, window::DEFAULT_HEIGHT)
                    .min_inner_size(window::MIN_WIDTH, window::MIN_HEIGHT)
                    .decorations(decorations)
                    .resizable(true)
                    .center()
                    // WebView2 eats these for the browser's own features, and a
                    // reload destroys every open terminal in the document. The
                    // window is built in Rust, so the config defaults do not
                    // apply and both have to be passed explicitly.
                    .zoom_hotkeys_enabled(false)
                    .devtools(cfg!(debug_assertions))
                    .initialization_script(host_init_script(&snapshot));

            // Restore geometry before the window is shown, so it does not appear
            // centered and then jump. Clamped against the monitors that exist
            // now: a window restored onto an unplugged display is invisible and
            // cannot be dragged back.
            let restored = window::load_bounds(&data_home).map(|saved| {
                let monitors = app.available_monitors().unwrap_or_default();
                window::clamp_to_visible(saved, &monitors)
            });
            if let Some(bounds) = restored {
                let scale = app
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .map(|m| m.scale_factor())
                    .unwrap_or(1.0);
                let (size, position) = window::logical_from_saved(bounds, scale);
                builder = builder
                    .inner_size(size.width, size.height)
                    .position(position.x, position.y);
            }

            // Transparency is only worth its cost when something behind the
            // window is meant to show through. It also rules out DWM's rounded
            // corners on Windows — a window with per-pixel alpha can never be
            // rounded — and the titlebar this was reserved for is opaque, so
            // Windows keeps an opaque window and Linux keeps transparency for
            // its compositor-side effects.
            #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
            {
                builder = builder.transparent(true);
            }

            let win = builder.build()?;

            #[cfg(target_os = "windows")]
            if !decorations {
                // Undecorated windows lose DWM's rounded corners, which is what
                // makes a frameless window look like a 1990s dialog on Win11.
                // Asking for them back is a hint, not a guarantee — DWM refuses
                // for windows using per-pixel alpha, which is why this pairs
                // with an opaque window above.
                round_window_corners(&win);
            }

            // Persist geometry as it changes rather than at exit: the process can
            // be terminated by the updater, and a size the user never sees again
            // is a small but constant annoyance.
            {
                let data_home = data_home.clone();
                let tracked = win.clone();
                let asker = win.clone();
                win.on_window_event(move |event| {
                    match event {
                        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                            if let Some(bounds) = window::capture_bounds(&tracked) {
                                window::save_bounds(&data_home, &bounds);
                            }
                        }
                        // Alt+F4, the window's own close button, and the OS window
                        // menu all arrive here — not as a webview key — so this is
                        // the only place a confirm-on-quit prompt can cover every
                        // route out of the app.
                        //
                        // The shell cannot decide whether to prompt: that depends
                        // on window:confirmclose and on whether the workspace has
                        // unsaved tabs, which live in the backend and the page. So
                        // it asks the page and stops the close; the page replies by
                        // calling host_close_window.
                        WindowEvent::CloseRequested { api, .. } => {
                            if close_may_proceed() {
                                return;
                            }
                            api.prevent_close();
                            if let Err(e) = asker.emit(host::CLOSE_REQUESTED_EVENT, ()) {
                                // A page that cannot be asked must not become a
                                // window that cannot be closed.
                                eprintln!("[slterm] could not ask the page about closing: {e}");
                                set_close_confirmed(true);
                                let _ = asker.close();
                            }
                        }
                        _ => {}
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building the SLTerm Tauri app")
        .run(|app, event| match event {
            // The window is closing. Shut the sidecar down here rather than
            // waiting for Exit: whether Exit fires when the updater terminates
            // the app is unverified, and a surviving wavesrv holds the data-dir
            // lock so the post-update launch fails.
            RunEvent::ExitRequested { .. } => {
                if update_in_progress() {
                    eprintln!("[slterm] shutting down for an update");
                }
                app.state::<Backend>().shutdown();
            }
            // Backstop for any path that reaches exit without the above.
            // `shutdown` is idempotent, so running twice costs nothing.
            RunEvent::Exit => {
                app.state::<Backend>().shutdown();
            }
            _ => {}
        });
}

/// Asks DWM for rounded corners on an undecorated window.
///
/// Windows 11 only, and a request rather than a guarantee: DWM ignores it for
/// windows using per-pixel alpha or a window region. Best-effort by design —
/// square corners are cosmetic, and there is nothing useful to do on failure.
#[cfg(target_os = "windows")]
fn round_window_corners(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let Ok(handle) = window.hwnd() else {
        return;
    };
    let preference = DWMWCP_ROUND;
    unsafe {
        // Return value ignored on purpose: on Windows 10 this attribute does not
        // exist and the call fails, which is not a problem worth reporting.
        DwmSetWindowAttribute(
            handle.0 as HWND,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &preference as *const _ as *const _,
            std::mem::size_of_val(&preference) as u32,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{close_may_proceed, set_close_confirmed, set_update_in_progress};

    #[test]
    fn cancelled_quit_does_not_enable_close() {
        set_close_confirmed(false);
        set_update_in_progress(false);
        assert!(!close_may_proceed());
    }

    #[test]
    fn confirmed_or_update_driven_quit_can_close() {
        set_close_confirmed(true);
        set_update_in_progress(false);
        assert!(close_may_proceed());
        set_close_confirmed(false);
        set_update_in_progress(true);
        assert!(close_may_proceed());
        set_update_in_progress(false);
    }
}
