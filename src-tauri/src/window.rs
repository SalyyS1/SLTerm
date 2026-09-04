// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//! Window shape, geometry persistence, and the settings the shell must read
//! before the backend exists.
//!
//! Everything here is about the OS window. The one piece of state it owns —
//! saved bounds — is deliberately not in the Go config: the window is
//! constructed before the backend handshake, so nothing else can answer "how big
//! was this window last time" in time to be used.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{LogicalPosition, LogicalSize, Monitor};

/// Default window size, matching what the Electron shell opened at.
pub const DEFAULT_WIDTH: f64 = 1400.0;
pub const DEFAULT_HEIGHT: f64 = 900.0;

/// Smallest window we allow.
///
/// The width is deliberately far below the 900 the shell used to ask for.
/// Windows only offers its Snap Layouts flyout to a window that can actually
/// enter a snap zone, and Microsoft's threshold for that is an effective minimum
/// width of roughly 500 logical pixels. The tiling layout copes: a single block
/// with the widget rail fits, and the tab bar scrolls.
pub const MIN_WIDTH: f64 = 500.0;
pub const MIN_HEIGHT: f64 = 400.0;

/// Settings the shell needs before the Go backend is running.
///
/// The backend owns settings, but it is not up yet when the window is built, so
/// these few are parsed straight out of the config file. Unknown keys are
/// ignored, and a missing or malformed file falls back to the defaults — the
/// window must open even when the config does not parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShellSettings {
    /// True when the OS should draw the titlebar instead of the frontend.
    ///
    /// This is `window:nativetitlebar` in settings.json. It shipped defaulting
    /// to true with no code reading it, so honouring it as written would have
    /// hidden the frontend titlebar from everyone who never edited their
    /// settings. The default is false here, and the frontend reads the same key
    /// so its own layout reservations agree with what the window did.
    pub native_titlebar: bool,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            native_titlebar: false,
        }
    }
}

/// Only the keys this module needs, so an unrelated settings change cannot make
/// the window fail to open.
#[derive(Deserialize)]
struct SettingsFile {
    #[serde(rename = "window:nativetitlebar")]
    native_titlebar: Option<bool>,
}

impl ShellSettings {
    pub fn load(config_home: &Path) -> Self {
        let path = config_home.join("settings.json");
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        match serde_json::from_str::<SettingsFile>(&text) {
            Ok(file) => Self {
                native_titlebar: file.native_titlebar.unwrap_or(false),
            },
            Err(e) => {
                eprintln!("[slterm] ignoring unreadable {}: {e}", path.display());
                Self::default()
            }
        }
    }
}

/// Saved window geometry, in physical pixels.
///
/// Physical rather than logical because that is what the platform reports and
/// what monitor bounds are expressed in; converting twice is how a window ends
/// up 1.5× off on a scaled display.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SavedBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

fn bounds_path(data_home: &Path) -> PathBuf {
    data_home.join("window-bounds.json")
}

pub fn load_bounds(data_home: &Path) -> Option<SavedBounds> {
    let text = std::fs::read_to_string(bounds_path(data_home)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Writes the bounds atomically.
///
/// A torn write here would mean the next launch cannot read its geometry, which
/// is recoverable — but it costs nothing to avoid, and the same file is written
/// on every move.
pub fn save_bounds(data_home: &Path, bounds: &SavedBounds) {
    let path = bounds_path(data_home);
    let tmp = path.with_extension("json.tmp");
    let Ok(text) = serde_json::to_string(bounds) else {
        return;
    };
    if std::fs::write(&tmp, text).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Clamps saved bounds to a monitor that currently exists.
///
/// A window restored onto a monitor that has since been unplugged is invisible
/// and unreachable — the user sees nothing and has no way to drag it back. Any
/// overlap with a live monitor counts as visible; only a window entirely off
/// every screen gets moved, and then to the primary monitor's top-left work
/// area rather than to (0,0), which on Windows can sit under the taskbar.
pub fn clamp_to_visible(bounds: SavedBounds, monitors: &[Monitor]) -> SavedBounds {
    if monitors.is_empty() {
        return bounds;
    }

    let left = bounds.x as i64;
    let top = bounds.y as i64;
    let right = left + bounds.width as i64;
    let bottom = top + bounds.height as i64;

    let intersects = monitors.iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        let m_left = pos.x as i64;
        let m_top = pos.y as i64;
        let m_right = m_left + size.width as i64;
        let m_bottom = m_top + size.height as i64;
        left < m_right && right > m_left && top < m_bottom && bottom > m_top
    });
    if intersects {
        return bounds;
    }

    let primary = &monitors[0];
    let pos = primary.position();
    let size = primary.size();
    let width = bounds.width.min(size.width);
    let height = bounds.height.min(size.height);
    SavedBounds {
        x: pos.x,
        y: pos.y,
        width,
        height,
        maximized: bounds.maximized,
    }
}

/// Reads a window's current geometry into the saved form.
pub fn capture_bounds(window: &tauri::WebviewWindow) -> Option<SavedBounds> {
    let maximized = window.is_maximized().unwrap_or(false);
    // A maximized window's own position and size describe the maximized frame,
    // which is not what should be restored — so keep the last normal geometry and
    // only record the flag.
    if maximized {
        let mut prev = SavedBounds {
            x: 0,
            y: 0,
            width: DEFAULT_WIDTH as u32,
            height: DEFAULT_HEIGHT as u32,
            maximized: true,
        };
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) {
            prev.x = pos.x;
            prev.y = pos.y;
            prev.width = size.width;
            prev.height = size.height;
        }
        return Some(prev);
    }
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(SavedBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

/// Logical size and position for the window builder.
///
/// The builder takes logical pixels while saved bounds are physical, so the
/// conversion happens here, once, against the scale factor of the monitor the
/// window will land on.
pub fn logical_from_saved(bounds: SavedBounds, scale: f64) -> (LogicalSize<f64>, LogicalPosition<f64>) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    (
        LogicalSize::new(bounds.width as f64 / scale, bounds.height as f64 / scale),
        LogicalPosition::new(bounds.x as f64 / scale, bounds.y as f64 / scale),
    )
}

/// Whether this platform draws its own window decorations when the frontend
/// titlebar is in use.
///
/// macOS keeps its decorations even with a custom titlebar: the traffic lights
/// are drawn by the OS in the window's own frame, and suppressing decorations
/// removes them with nothing to put back. Windows and Linux get a fully
/// undecorated window, and the frontend draws all three controls.
pub const fn keeps_decorations_with_custom_titlebar() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_to_a_frontend_titlebar() {
        // The shipped settings.json has window:nativetitlebar true with no
        // reader. Defaulting to false here is what keeps the frontend titlebar
        // visible for a user who never edited their settings.
        assert!(!ShellSettings::default().native_titlebar);
    }

    #[test]
    fn missing_config_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join("slterm-window-test-missing");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(ShellSettings::load(&dir), ShellSettings::default());
    }

    #[test]
    fn malformed_config_falls_back_rather_than_failing() {
        let dir = std::env::temp_dir().join("slterm-window-test-malformed");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), "{ not json").unwrap();
        assert_eq!(ShellSettings::load(&dir), ShellSettings::default());
    }

    #[test]
    fn native_titlebar_is_read_when_set() {
        let dir = std::env::temp_dir().join("slterm-window-test-native");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"window:nativetitlebar": true, "term:fontsize": 12}"#,
        )
        .unwrap();
        assert!(ShellSettings::load(&dir).native_titlebar);
    }

    #[test]
    fn bounds_round_trip_through_disk() {
        let dir = std::env::temp_dir().join("slterm-window-test-bounds");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bounds = SavedBounds {
            x: 12,
            y: 34,
            width: 800,
            height: 600,
            maximized: true,
        };
        save_bounds(&dir, &bounds);
        let read = load_bounds(&dir).expect("bounds should read back");
        assert_eq!((read.x, read.y, read.width, read.height), (12, 34, 800, 600));
        assert!(read.maximized);
    }

    #[test]
    fn logical_conversion_divides_by_scale() {
        let bounds = SavedBounds {
            x: 300,
            y: 150,
            width: 1500,
            height: 900,
            maximized: false,
        };
        let (size, pos) = logical_from_saved(bounds, 1.5);
        assert_eq!((size.width, size.height), (1000.0, 600.0));
        assert_eq!((pos.x, pos.y), (200.0, 100.0));
    }

    #[test]
    fn a_zero_scale_factor_does_not_divide_by_zero() {
        let bounds = SavedBounds {
            x: 10,
            y: 10,
            width: 100,
            height: 100,
            maximized: false,
        };
        let (size, _) = logical_from_saved(bounds, 0.0);
        assert_eq!(size.width, 100.0);
    }

    #[test]
    fn clamping_with_no_monitors_leaves_bounds_alone() {
        let bounds = SavedBounds {
            x: -5000,
            y: -5000,
            width: 100,
            height: 100,
            maximized: false,
        };
        let out = clamp_to_visible(bounds, &[]);
        assert_eq!(out.x, -5000);
    }
}
