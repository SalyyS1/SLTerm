// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Making an area of the page drag the window.
 *
 * The tab bar used to carry `-webkit-app-region: drag`, which is an Electron
 * extension: WebView2 and WKWebView ignore it entirely, so under the Tauri shell
 * the whole title area became dead space with no way to move the window. This
 * replaces it with an explicit `startDragging` call.
 *
 * Kept as a plain handler rather than Tauri's `data-tauri-drag-region`
 * attribute, because that attribute is inherited by every descendant: putting it
 * on the tab bar would make the tabs and buttons inside it drag the window
 * instead of doing their own job. The `.no-drag` opt-out below is the inverse
 * and composes with the existing markup.
 */

/**
 * Elements that must never start a window drag.
 *
 * `button` and `a` cover most of the tab bar; `.no-drag` is the explicit opt-out
 * for the rest, and matches the class name the CSS already uses.
 */
const NoDragSelector = "button, a, input, select, textarea, .no-drag, [data-no-drag]";

/**
 * True when a mousedown at this target should move the window.
 *
 * Primary button only: a right-click opens a context menu, and a middle-click
 * pastes on Linux. Both would be swallowed by a drag.
 */
export function shouldStartDrag(event: { button: number; buttons: number; target: EventTarget | null }): boolean {
    if (event.button !== 0 || event.buttons !== 1) {
        return false;
    }
    const target = event.target as HTMLElement | null;
    if (target == null || typeof target.closest !== "function") {
        return false;
    }
    return target.closest(NoDragSelector) == null;
}

/**
 * Starts a window drag, if the event warrants one.
 *
 * `startDragging` hands the pointer to the OS's own move loop, which is what
 * makes edge-snapping and multi-monitor dragging behave natively. It also
 * swallows the matching mouseup, so a click that begins a drag never fires
 * `onClick` — that is why the guard above runs first rather than letting every
 * mousedown through.
 */
export function handleTitlebarMouseDown(event: React.MouseEvent | MouseEvent): void {
    if (!shouldStartDrag(event)) {
        return;
    }
    void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
        .catch((e) => console.error("could not start a window drag", e));
}

/**
 * Toggles maximise, for a double-click on the drag region.
 *
 * Every desktop platform does this, and losing it is the most-noticed thing
 * about a hand-drawn titlebar. Tauri's drag-region attribute would have provided
 * it for free; doing it by hand is the cost of not using that attribute.
 */
export function handleTitlebarDoubleClick(event: React.MouseEvent | MouseEvent): void {
    if (!shouldStartDrag(event)) {
        return;
    }
    void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
        .catch((e) => console.error("could not toggle maximize", e));
}
