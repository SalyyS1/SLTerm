//! Source-only ConPTY proof. Never starts Go or opens an existing SLTerm profile.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicI32, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow};

#[path = "terminal_proof_shell.rs"]
mod shell;

#[path = "terminal_proof_shutdown.rs"]
mod shutdown;

#[cfg(windows)]
#[path = "terminal_proof_clipboard.rs"]
mod clipboard;

const MAX_FRAME: usize = 65536;
const QUEUED_FRAMES: usize = 64;
const SHUTDOWN_WAIT: Duration = Duration::from_secs(10);

struct Core {
    process: Arc<Mutex<Child>>,
    input: mpsc::SyncSender<Vec<u8>>,
    output_closed: Arc<AtomicBool>,
    shutdown: Arc<shutdown::ShutdownReceipt>,
}

#[derive(Default)]
struct ProofState {
    core: Mutex<Option<Core>>,
    closing: AtomicBool,
    shutdown_failed: AtomicBool,
    profile: Mutex<Option<std::path::PathBuf>>,
}

fn is_app_origin(url: &tauri::Url) -> bool {
    let (scheme, host) = if cfg!(windows) {
        ("http", "tauri.localhost")
    } else {
        ("tauri", "localhost")
    };
    url.scheme() == scheme
        && url.host_str() == Some(host)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "proof" || !is_app_origin(&window.url().map_err(|e| e.to_string())?) {
        return Err("Untrusted proof window".into());
    }
    Ok(())
}

fn emit(app: &tauri::AppHandle, payload: Value) -> Result<(), String> {
    app.emit_to("proof", "proof-event", payload)
        .map_err(|e| e.to_string())
}

fn read_frame(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut frame = Vec::new();
    let count = reader
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut frame)
        .map_err(|e| e.to_string())?;
    if count == 0 {
        return Ok(None);
    }
    if frame.len() > MAX_FRAME {
        return Err("Core frame exceeds 64 KiB".into());
    }
    if frame.last() != Some(&b'\n') {
        return Err("Core closed with a truncated frame".into());
    }
    let value: Value =
        serde_json::from_slice(&frame).map_err(|e| format!("Invalid core JSON: {e}"))?;
    if value["version"].as_u64() != Some(1)
        || (value["id"].as_u64().is_none() && value["event"].as_str().is_none())
    {
        return Err("Invalid core envelope".into());
    }
    Ok(Some(value))
}

fn queue(input: &mpsc::SyncSender<Vec<u8>>, frame: Vec<u8>) -> Result<(), String> {
    input.try_send(frame).map_err(|error| match error {
        mpsc::TrySendError::Full(_) => "Core request queue is full; input was not accepted".into(),
        mpsc::TrySendError::Disconnected(_) => "Core input pipe is closed".into(),
    })
}

#[tauri::command]
fn proof_start(window: WebviewWindow, state: State<ProofState>) -> Result<Value, String> {
    authorize(&window)?;
    if state.closing.load(Ordering::SeqCst) {
        return Err("Proof host is shutting down".into());
    }
    let mut guard = state.core.lock().map_err(|_| "Core lock poisoned")?;
    if state.closing.load(Ordering::SeqCst) {
        return Err("Proof host is shutting down".into());
    }
    if guard.is_some() {
        return Err("Core already started".into());
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("Missing source root")?;
    let binary = root.join("native-core/zig-out/bin/slterm-core-proof.exe");
    let profile = state
        .profile
        .lock()
        .map_err(|_| "Profile lock poisoned")?
        .clone()
        .ok_or("Missing proof profile")?;
    let shell = shell::prepare(&profile)?;
    let mut command = Command::new(&binary);
    command
        .current_dir(root)
        .env_clear()
        .envs(shell.environment.iter().map(|(key, value)| (*key, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; ConPTY owns child consoles.
    }
    let mut process = command
        .spawn()
        .map_err(|e| format!("Cannot start Zig proof: {e}"))?;
    let pid = process.id();
    // Stdio::piped guarantees these handles after a successful spawn.
    let mut input = process.stdin.take().expect("piped stdin");
    let output = process.stdout.take().expect("piped stdout");
    let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(QUEUED_FRAMES);
    let output_closed = Arc::new(AtomicBool::new(false));
    let shutdown = Arc::new(shutdown::ShutdownReceipt::default());
    *guard = Some(Core {
        process: Arc::new(Mutex::new(process)),
        input: sender,
        output_closed: output_closed.clone(),
        shutdown: shutdown.clone(),
    });
    let writer_app = window.app_handle().clone();
    let writer_closed = output_closed.clone();
    let writer_shutdown = shutdown.clone();
    std::thread::spawn(move || {
        while !writer_closed.load(Ordering::SeqCst) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(frame) => {
                    if let Err(error) = input.write_all(&frame) {
                        writer_shutdown.fail();
                        let _ = emit(
                            &writer_app,
                            json!({"event":"transport_error", "message":format!("Core write failed: {error}")}),
                        );
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        // EOF requests sidecar cleanup, including when its output is malformed.
        drop(input);
    });
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(output);
        loop {
            match read_frame(&mut reader) {
                Ok(Some(payload)) => {
                    shutdown.observe(&payload);
                    if emit(&app, payload).is_err() {
                        shutdown.fail();
                        break;
                    }
                }
                Ok(None) => break,
                Err(message) => {
                    shutdown.fail();
                    let _ = emit(&app, json!({"event":"transport_error", "message":message}));
                    break;
                }
            }
        }
        let _ = emit(&app, json!({"event":"transport_closed"}));
        output_closed.store(true, Ordering::SeqCst);
    });
    Ok(json!({"pid":pid, "cwd":root, "executable":shell.executable, "args":shell.arguments}))
}

#[tauri::command]
fn proof_request(
    window: WebviewWindow,
    state: State<ProofState>,
    request: Value,
) -> Result<(), String> {
    authorize(&window)?;
    if state.closing.load(Ordering::SeqCst) {
        return Err("Core is shutting down".into());
    }
    if request["version"].as_u64() != Some(1)
        || request["id"].as_u64().unwrap_or(0) == 0
        || request["id"].as_u64() == Some(shutdown::REQUEST_ID)
        || !matches!(
            request["method"].as_str(),
            Some("hello" | "spawn" | "input" | "resize" | "ack" | "stop")
        )
    {
        return Err("Invalid proof request".into());
    }
    let mut frame = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    if frame.len() >= MAX_FRAME {
        return Err("Frame too large".into());
    }
    frame.push(b'\n');
    let guard = state.core.lock().map_err(|_| "Core lock poisoned")?;
    // Serialize admission with shutdown's queue insertion, so a request cannot
    // be accepted behind the final shutdown frame.
    if state.closing.load(Ordering::SeqCst) {
        return Err("Core is shutting down".into());
    }
    let core = guard.as_ref().ok_or("Core not started")?;
    if core.output_closed.load(Ordering::SeqCst) {
        return Err("Core output pipe is closed".into());
    }
    queue(&core.input, frame)
}

fn begin_shutdown(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<ProofState>();
    if state.closing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let prepared = (|| {
        let guard = state
            .core
            .lock()
            .map_err(|_| "Core lock poisoned".to_string())?;
        let Some(core) = guard.as_ref() else {
            return Ok(None);
        };
        if !core.output_closed.load(Ordering::SeqCst) {
            queue(
                &core.input,
                b"{\"version\":1,\"id\":9000000,\"method\":\"shutdown\"}\n".to_vec(),
            )?;
        }
        Ok(Some((
            core.process.clone(),
            core.output_closed.clone(),
            core.shutdown.clone(),
        )))
    })();
    let (process, output_closed, shutdown) = match prepared {
        Ok(Some(core)) => core,
        Ok(None) => {
            app.exit(0);
            return Ok(());
        }
        Err(error) => {
            state.closing.store(false, Ordering::SeqCst);
            state.shutdown_failed.store(true, Ordering::SeqCst);
            return Err(error);
        }
    };
    let app = app.clone();
    let _ = emit(&app, json!({"event":"shutdown_started"}));
    std::thread::spawn(move || {
        let deadline = Instant::now() + SHUTDOWN_WAIT;
        loop {
            let exited = process
                .lock()
                .ok()
                .and_then(|mut child| child.try_wait().ok())
                .flatten();
            if let Some(status) = exited {
                if output_closed.load(Ordering::SeqCst) {
                    if shutdown.confirmed(status.success()) {
                        let cleared = app
                            .state::<ProofState>()
                            .core
                            .lock()
                            .map(|mut guard| guard.take())
                            .is_ok();
                        if !cleared {
                            shutdown_failed(&app, "Core lock poisoned; chưa thể hoàn tất shutdown.");
                            return;
                        }
                        app.exit(0);
                        return;
                    }
                    shutdown_failed(&app, "Backend đã thoát nhưng chưa xác nhận đủ output và shutdown. Bạn có thể thử dừng lại hoặc xác nhận buộc thoát.");
                    return;
                }
            }
            if Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        shutdown_failed(&app, "Chưa xác nhận được shutdown sau 10 giây. Thử dừng lại hoặc xác nhận buộc thoát; app chưa tự buộc dừng.");
    });
    Ok(())
}

fn shutdown_failed(app: &tauri::AppHandle, message: &str) {
    let state = app.state::<ProofState>();
    state.shutdown_failed.store(true, Ordering::SeqCst);
    state.closing.store(false, Ordering::SeqCst);
    let _ = emit(app, json!({"event":"shutdown_stalled", "message":message}));
}

#[tauri::command]
fn proof_quit(window: WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    begin_shutdown(window.app_handle())
}

#[tauri::command]
async fn proof_force_quit(window: WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    let app = window.app_handle().clone();
    if !app
        .state::<ProofState>()
        .shutdown_failed
        .load(Ordering::SeqCst)
    {
        return Err("Force quit requires a failed shutdown and explicit confirmation".into());
    }
    let result = async {
        let process = {
            let state = app.state::<ProofState>();
            state.closing.store(true, Ordering::SeqCst);
            let guard = state.core.lock().map_err(|_| "Core lock poisoned")?;
            guard.as_ref().map(|core| core.process.clone())
        };
        if let Some(process) = process {
            tauri::async_runtime::spawn_blocking(move || {
                let mut child = process
                    .lock()
                    .map_err(|_| "Process lock poisoned".to_string())?;
                if child
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .is_none()
                {
                    child.kill().map_err(|error| error.to_string())?;
                    child.wait().map_err(|error| error.to_string())?;
                }
                Ok::<(), String>(())
            })
            .await
            .map_err(|error| error.to_string())??;
        }
        app.state::<ProofState>()
            .core
            .lock()
            .map_err(|_| "Core lock poisoned")?
            .take();
        // A consented force exit is never reported as a successful graceful shutdown.
        app.exit(1);
        Ok::<(), String>(())
    }
    .await;
    if let Err(message) = &result {
        shutdown_failed(&app, message);
    }
    result
}

#[tauri::command]
async fn proof_clipboard_read(window: WebviewWindow) -> Result<String, String> {
    authorize(&window)?;
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || clipboard::read(owner))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    Err("Proof clipboard is currently implemented on Windows only".into())
}

#[tauri::command]
async fn proof_clipboard_write(window: WebviewWindow, text: String) -> Result<(), String> {
    authorize(&window)?;
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || clipboard::write(owner, &text))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("Proof clipboard is currently implemented on Windows only".into())
    }
}

pub fn run() {
    let accepted_exit = Arc::new(AtomicI32::new(0));
    let exit_receipt = accepted_exit.clone();
    let runtime_exit = tauri::Builder::default()
        .manage(ProofState::default())
        .invoke_handler(tauri::generate_handler![
            proof_start,
            proof_request,
            proof_quit,
            proof_force_quit,
            proof_clipboard_read,
            proof_clipboard_write
        ])
        .setup(|app| {
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or("Missing source root")?;
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
            let profile = root
                .join("proof-results")
                .join(format!("host-{}-{stamp}", std::process::id()));
            std::fs::create_dir_all(&profile)?;
            *app.state::<ProofState>()
                .profile
                .lock()
                .map_err(|_| "Profile lock poisoned")? = Some(profile.clone());
            // Shell state remains per-run; only the isolated preview's WebView
            // preferences survive a restart. GUI tests can select a disposable directory.
            let webview_profile = match std::env::var_os("SLTERM_PROOF_PROFILE_DIR") {
                Some(value) => {
                    let path = std::path::PathBuf::from(value);
                    if !path.is_absolute() {
                        return Err("SLTERM_PROOF_PROFILE_DIR must be an absolute path".into());
                    }
                    path
                }
                None => app
                    .path()
                    .app_local_data_dir()?
                    .join("workspace-customization"),
            };
            std::fs::create_dir_all(&webview_profile)?;
            tauri::WebviewWindowBuilder::new(app, "proof", WebviewUrl::App("index.html".into()))
                .title("SLTerm — Workspace preview")
                .inner_size(1100.0, 720.0)
                .min_inner_size(480.0, 360.0)
                .resizable(true)
                .maximizable(true)
                .minimizable(true)
                .decorations(true)
                .prevent_overflow()
                .center()
                .zoom_hotkeys_enabled(false)
                // Let HTML pane dragging reach WebView2 instead of Tauri's native file-drop handler.
                .disable_drag_drop_handler()
                .data_directory(webview_profile)
                .visible(std::env::var_os("SLTERM_PROOF_HIDDEN").is_none())
                .on_navigation(is_app_origin)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_download(|_, _| false)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // The workspace owns confirmation; proof_quit still owns the native shutdown handshake.
                let _ = emit(window.app_handle(), json!({"event":"close_requested"}));
            }
        })
        .build(tauri::generate_context!())
        .expect("Cannot build isolated terminal proof")
        .run_return(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                let has_core = app
                    .state::<ProofState>()
                    .core
                    .lock()
                    .map(|core| core.is_some())
                    .unwrap_or(true);
                if has_core {
                    api.prevent_exit();
                    if let Err(message) = begin_shutdown(app) {
                        let _ = emit(app, json!({"event":"shutdown_stalled", "message":message}));
                    }
                } else if let Some(code) = code {
                    exit_receipt.store(code, Ordering::SeqCst);
                }
            }
        });
    // Wry currently exits its Windows event loop with status zero even when
    // AppHandle::exit requested failure. Let Tauri finish cleanup, then preserve
    // the accepted failure status for the parent process.
    let requested_exit = accepted_exit.load(Ordering::SeqCst);
    std::process::exit(if requested_exit != 0 {
        requested_exit
    } else {
        runtime_exit
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn only_the_exact_application_origin_is_trusted() {
        let own = if cfg!(windows) {
            "http://tauri.localhost/index.html"
        } else {
            "tauri://localhost/index.html"
        };
        assert!(is_app_origin(&own.parse().unwrap()));
        for url in [
            "https://tauri.localhost/",
            "http://tauri.localhost:8080/",
            "http://tauri.localhost.evil/",
            "http://user@tauri.localhost/",
            "tauri://evil/",
            "file:///index.html",
            "about:blank",
        ] {
            assert!(!is_app_origin(&url.parse().unwrap()), "trusted {url}");
        }
    }

    #[test]
    fn reader_preserves_frame_and_eof_order() {
        let mut input = Cursor::new(b"{\"version\":1,\"event\":\"output\",\"data\":\"5L2g\"}\n{\"version\":1,\"event\":\"exit\"}\n");
        assert_eq!(read_frame(&mut input).unwrap().unwrap()["event"], "output");
        assert_eq!(read_frame(&mut input).unwrap().unwrap()["event"], "exit");
        assert!(read_frame(&mut input).unwrap().is_none());
    }

    #[test]
    fn reader_reports_bad_oversized_and_truncated_frames() {
        for data in [
            b"not-json\n".to_vec(),
            b"{\"version\":2,\"event\":\"ready\"}\n".to_vec(),
            b"{\"version\":1,\"event\":\"exit\"}".to_vec(),
            vec![b'x'; MAX_FRAME + 1],
        ] {
            assert!(read_frame(&mut Cursor::new(data)).is_err());
        }
    }

    #[test]
    fn queue_rejects_overload_and_disconnection() {
        let (sender, receiver) = mpsc::sync_channel(1);
        assert!(queue(&sender, vec![1]).is_ok());
        assert!(queue(&sender, vec![2]).unwrap_err().contains("full"));
        drop(receiver);
        assert!(queue(&sender, vec![3]).unwrap_err().contains("closed"));
    }
}
