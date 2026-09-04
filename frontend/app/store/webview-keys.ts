// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Stopping the webview from acting like a browser.
 *
 * Electron had `before-input-event`, which let the main process see a keystroke
 * before the page did. Tauri has no equivalent — nothing in Rust sees a key that
 * lands in the webview — so interception happens in the page, at three layers:
 *
 *   1. Window config. `zoom_hotkeys_enabled(false)` and `devtools(false)` are
 *      passed when the window is built, so Ctrl+/Ctrl-/Ctrl+wheel and F12 are
 *      already gone before this file runs.
 *   2. This file. A keydown listener that calls `preventDefault` on the chords
 *      WebView2 would otherwise act on, plus the context-menu and beforeunload
 *      guards that close the two other routes to a reload.
 *   3. Windows only, in Rust: `AreBrowserAcceleratorKeysEnabled(false)` turns
 *      this allowlist into a denylist. Layer 2 stays because that COM setting is
 *      Windows-only and Linux/macOS need the same protection.
 *
 * The one that matters most is reload. A page reload destroys every terminal in
 * the document — not the shell processes, which live in the Go backend, but
 * every xterm instance and all its scrollback. F5 is a very easy key to hit.
 */

/** Elements where the browser's own behavior should win. */
const EditableSelector = "input, textarea, .monaco-editor, .xterm-helper-textarea, [contenteditable='true']";

/**
 * True when the event is inside a control that needs native key handling.
 *
 * `.xterm-helper-textarea` is deliberately *included* here for the context menu
 * but the terminal itself is not editable in this sense — the terminal wants
 * Ctrl+F to reach the shell, which the shortcut layer handles separately.
 */
function inEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (el == null || typeof el.closest !== "function") {
        return false;
    }
    return el.closest(EditableSelector) != null;
}

/**
 * Whether this keydown is a browser accelerator the app must swallow.
 *
 * Exported for tests. Note the case rule: when Shift is held, `event.key` is the
 * uppercase letter, so a check against a lowercase literal silently never
 * matches. That is the single most common bug in handlers of this shape.
 */
export function isBrowserAccelerator(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">): boolean {
    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;

    // Reload: destroys every terminal in the document.
    if (key === "F5" || (mod && (key === "r" || key === "R"))) {
        return true;
    }
    // Find on page. The app has its own search, bound to the same chord, and the
    // browser's would search the rendered DOM rather than the scrollback.
    if (key === "F3" || (mod && (key === "f" || key === "F"))) {
        return true;
    }
    // Print. Nothing in a terminal app should open a print dialog.
    if (mod && (key === "p" || key === "P")) {
        return true;
    }
    return false;
}

/**
 * Installs the guards.
 *
 * Returns a function that removes them, so a test or a future multi-window path
 * can tear them down; the app itself installs once and never removes.
 */
export function installWebviewKeyGuards(): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
        // IME composition. A composing keystroke belongs to the input method,
        // and intercepting it produces duplicated or garbled text — the failure
        // Vietnamese and CJK input hits first.
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        if (inEditable(event.target)) {
            // Ctrl+F in a text field is the field's own find; let it through.
            return;
        }
        if (isBrowserAccelerator(event)) {
            event.preventDefault();
        }
    };

    // WebView2's default context menu carries a Refresh item, which is a second
    // route to the reload this file exists to prevent.
    const onContextMenu = (event: MouseEvent) => {
        if (inEditable(event.target)) {
            return;
        }
        event.preventDefault();
    };

    // Last line of defence. Tauri closes windows through the OS close path
    // rather than beforeunload, so returning a value here does not trap the user
    // in an unclosable window — it only catches a navigation the guards missed.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        window.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("beforeunload", onBeforeUnload);
    };
}
