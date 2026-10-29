//! Windows recovery controls for explicitly backgrounded ADE windows.
use serde_json::json;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow,
};

const TRAY_ID: &str = "slterm-ade";
// Tauri dispatches tray menu handlers globally, including events from window menus.
const OPEN_ID: &str = "slterm-ade.open";
const QUIT_ID: &str = "slterm-ade.quit";

fn restore(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("proof")
        .ok_or("Không tìm thấy cửa sổ SLTerm.")?;
    window
        .show()
        .map_err(|error| format!("Không hiện được cửa sổ SLTerm: {error}"))?;
    // A hidden window can retain its minimized state; restore it before focus.
    window
        .unminimize()
        .map_err(|error| format!("Không khôi phục được cửa sổ SLTerm: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Không chuyển được tiêu điểm tới SLTerm: {error}"))
}

pub(super) fn setup(app: &tauri::App) -> Result<(), String> {
    // Reusing setup must not accumulate icons or global menu handlers.
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let icon = app
        .default_window_icon()
        .ok_or("SLTerm thiếu biểu tượng ứng dụng; không thể bật chế độ nền.")?
        .clone();
    let open = MenuItem::with_id(app, OPEN_ID, "Mở SLTerm", true, None::<&str>)
        .map_err(|error| format!("Không tạo được lệnh mở SLTerm: {error}"))?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Dừng và thoát", true, None::<&str>)
        .map_err(|error| format!("Không tạo được lệnh thoát SLTerm: {error}"))?;
    let menu = Menu::with_items(app, &[&open, &quit])
        .map_err(|error| format!("Không tạo được menu khay hệ thống: {error}"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("SLTerm — Mở ứng dụng hoặc dừng và thoát")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ID => {
                if let Err(error) = restore(app) {
                    eprintln!("SLTerm tray restore: {error}");
                }
            }
            QUIT_ID => {
                if let Err(error) = restore(app) {
                    eprintln!("SLTerm tray restore before quit: {error}");
                }
                // The existing window confirmation owns dirty buffers and shutdown.
                if let Err(error) = super::emit(app, json!({ "event": "close_requested" })) {
                    eprintln!("SLTerm tray quit confirmation: {error}");
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                if let Err(error) = restore(tray.app_handle()) {
                    eprintln!("SLTerm tray click restore: {error}");
                }
            }
        })
        .build(app)
        .map_err(|error| format!("Không tạo được biểu tượng khay hệ thống: {error}"))?;
    // Tauri 2.11 keeps the built icon in the application resource table until exit.
    Ok(())
}

pub(super) fn hide(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "proof" {
        return Err("Chỉ cửa sổ SLTerm ADE có thể chạy nền.".into());
    }
    let tray = window
        .app_handle()
        .tray_by_id(TRAY_ID)
        .ok_or("Khay hệ thống chưa sẵn sàng; cửa sổ vẫn được giữ mở.")?;
    // Keep the recovery icon visible and alive through the hide operation.
    tray.set_visible(true)
        .map_err(|error| format!("Không hiện được biểu tượng khay hệ thống: {error}"))?;
    window
        .hide()
        .map_err(|error| format!("Không ẩn được cửa sổ SLTerm: {error}"))
}
