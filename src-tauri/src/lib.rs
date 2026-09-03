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

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use rand::Rng;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

use host::HostSnapshot;

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
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist")
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
        .manage(Backend(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            host::host_open_external,
            host::host_open_native_path,
            host::host_set_fullscreen,
            host::host_log,
            menu::host_show_context_menu,
        ])
        .on_menu_event(|app, event| {
            // The frontend owns what every entry does; it registered a handler
            // under this id when it built the menu.
            menu::emit_menu_click(app, event.id().as_ref());
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let (child, endpoints) = match start_backend(&handle) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("[slterm] fatal: {e}");
                    return Err(e.into());
                }
            };
            app.state::<Backend>().0.lock().unwrap().replace(child);

            let (_, config_home) = data_dir_args();
            let snapshot = HostSnapshot::new(
                endpoints.web.clone(),
                endpoints.ws.clone(),
                endpoints.auth_key.clone(),
                &config_home,
            );

            // The window is built here rather than declared in tauri.conf.json
            // because the snapshot depends on endpoints only known after the
            // backend handshake, and an initialization script has to be attached
            // at construction to be guaranteed to run before the bundle. Tauri
            // re-injects it on every navigation, so a reload is covered too.
            #[allow(unused_mut)]
            let mut builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("SLTerm")
                    .inner_size(1400.0, 900.0)
                    .min_inner_size(900.0, 600.0)
                    .decorations(false)
                    .resizable(true)
                    .center()
                    .initialization_script(host_init_script(&snapshot));
            // On macOS `transparent` only exists behind Tauri's `macos-private-api`
            // feature, and turning that on makes the app ineligible for the Mac App
            // Store. Transparency here is cosmetic — the frameless titlebar it was
            // meant to serve is not built yet — so it is not worth depending on a
            // private API for. Revisit when that titlebar lands and it matters.
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.transparent(true);
            }
            builder.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building the SLTerm Tauri app")
        .run(|app, event| {
            // Kill the sidecar on exit; otherwise it keeps the data-dir lock and
            // the next launch cannot acquire it.
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Backend>().0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
