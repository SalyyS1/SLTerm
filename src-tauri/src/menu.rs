// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//! Native context menus.
//!
//! The frontend owns what a menu contains and what each entry does; it sends a
//! tree of entries with opaque ids and gets the clicked id back. Nothing here
//! knows what any entry means, which is what keeps menu behavior in one language
//! instead of two.

use serde::Deserialize;
use tauri::menu::{
    CheckMenuItemBuilder, ContextMenu, IsMenuItem, MenuBuilder, MenuItemBuilder,
    PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{Emitter, Manager, Runtime};

/// Event the clicked id is delivered on. The frontend matches it against the
/// handlers it registered when it built the menu.
pub const CONTEXT_MENU_CLICK_EVENT: &str = "host://contextmenu-click";

/// One entry, mirroring `ElectronContextMenuItem` in types/custom.d.ts.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MenuEntry {
    pub id: String,
    pub label: Option<String>,
    /// Electron's menu roles ("copy", "paste", …). Mapped to the platform's own
    /// items where one exists, because those come with the right label,
    /// accelerator and behaviour per OS.
    pub role: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub submenu: Option<Vec<MenuEntry>>,
    pub checked: Option<bool>,
    pub visible: Option<bool>,
    pub enabled: Option<bool>,
}

impl MenuEntry {
    fn text(&self) -> String {
        self.label.clone().unwrap_or_default()
    }

    fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }
}

/// Builds a flat run of entries, separators included.
///
/// Items are collected before any builder sees them because the builders take
/// borrowed items and consume themselves on each call.
fn build_items<R: Runtime, M: Manager<R>>(
    manager: &M,
    entries: &[MenuEntry],
) -> Result<Vec<Box<dyn IsMenuItem<R>>>, String> {
    let mut out: Vec<Box<dyn IsMenuItem<R>>> = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.kind.as_deref() == Some("separator") {
            out.push(Box::new(
                PredefinedMenuItem::separator(manager).map_err(to_msg)?,
            ));
            continue;
        }
        if let Some(item) = build_entry(manager, entry)? {
            out.push(item);
        }
    }
    Ok(out)
}

/// Turns one entry into a menu item.
///
/// Returns None for an entry this platform has nothing to show — a hidden one.
fn build_entry<R: Runtime, M: Manager<R>>(
    manager: &M,
    entry: &MenuEntry,
) -> Result<Option<Box<dyn IsMenuItem<R>>>, String> {
    if entry.visible == Some(false) {
        // Tauri cannot hide an item after the fact on every platform, and the menu
        // is rebuilt on every right-click anyway, so leaving it out is equivalent.
        return Ok(None);
    }

    if let Some(role) = entry.role.as_deref() {
        if let Some(item) = predefined_for_role(manager, role, entry.label.as_deref())? {
            return Ok(Some(item));
        }
    }

    if let Some(children) = entry.submenu.as_deref() {
        let items = build_items(manager, children)?;
        let mut builder = SubmenuBuilder::new(manager, entry.text()).enabled(entry.is_enabled());
        for item in &items {
            builder = builder.item(item.as_ref());
        }
        return Ok(Some(Box::new(builder.build().map_err(to_msg)?)));
    }

    if entry.kind.as_deref() == Some("checkbox") || entry.checked.is_some() {
        let item = CheckMenuItemBuilder::with_id(entry.id.clone(), entry.text())
            .checked(entry.checked.unwrap_or(false))
            .enabled(entry.is_enabled())
            .build(manager)
            .map_err(to_msg)?;
        return Ok(Some(Box::new(item)));
    }

    // "header" has no native equivalent; a disabled entry reads the same way.
    let enabled = entry.is_enabled() && entry.kind.as_deref() != Some("header");
    let item = MenuItemBuilder::with_id(entry.id.clone(), entry.text())
        .enabled(enabled)
        .build(manager)
        .map_err(to_msg)?;
    Ok(Some(Box::new(item)))
}

fn predefined_for_role<R: Runtime, M: Manager<R>>(
    manager: &M,
    role: &str,
    label: Option<&str>,
) -> Result<Option<Box<dyn IsMenuItem<R>>>, String> {
    let item = match role {
        "copy" => PredefinedMenuItem::copy(manager, label),
        "cut" => PredefinedMenuItem::cut(manager, label),
        "paste" => PredefinedMenuItem::paste(manager, label),
        "selectAll" | "selectall" => PredefinedMenuItem::select_all(manager, label),
        "undo" => PredefinedMenuItem::undo(manager, label),
        "redo" => PredefinedMenuItem::redo(manager, label),
        "minimize" => PredefinedMenuItem::minimize(manager, label),
        "close" => PredefinedMenuItem::close_window(manager, label),
        "quit" => PredefinedMenuItem::quit(manager, label),
        // Anything else falls through to a normal item, so an unmapped role still
        // reaches the frontend's own handler rather than vanishing.
        _ => return Ok(None),
    };
    Ok(Some(Box::new(item.map_err(to_msg)?)))
}

fn to_msg(e: tauri::Error) -> String {
    e.to_string()
}

/// Shows the menu where the pointer is.
#[tauri::command]
pub fn host_show_context_menu<R: Runtime>(
    window: tauri::Window<R>,
    items: Vec<MenuEntry>,
) -> Result<(), String> {
    let built = build_items(&window, &items)?;
    let mut builder = MenuBuilder::new(&window);
    for item in &built {
        builder = builder.item(item.as_ref());
    }
    let menu = builder.build().map_err(to_msg)?;
    menu.popup(window).map_err(to_msg)
}

/// Called from the app's menu-event handler; hands the clicked id to the page.
pub fn emit_menu_click<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    if let Err(e) = app.emit(CONTEXT_MENU_CLICK_EVENT, id.to_string()) {
        eprintln!("[slterm] could not deliver a menu click: {e}");
    }
}
