// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimise, maximise and close, drawn by the page.
 *
 * Only rendered where the OS is not drawing them. macOS keeps its own traffic
 * lights — they live in the window frame, and only the OS can put them there —
 * so this renders on Windows and Linux, into the space the tab bar reserves on
 * its right.
 *
 * Every button calls the Tauri window API directly. That needs no Rust command
 * of its own, which is what keeps the shell free of behavior: it grants the
 * capability, the page decides when to use it.
 */

import { isMacOS } from "@/util/platformutil";
import { useEffect, useState } from "react";

/** Matches the width the tab bar reserves per button. */
export const ControlWidth = 46;

type WindowApi = {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
};

/**
 * Resolves the current window lazily.
 *
 * The Tauri module is imported on demand so that a build not running under Tauri
 * — the Electron shell still loads this bundle — never evaluates it.
 */
async function currentWindow(): Promise<WindowApi | null> {
    try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        return getCurrentWindow() as unknown as WindowApi;
    } catch (e) {
        console.error("window controls: no Tauri window available", e);
        return null;
    }
}

function run(action: (win: WindowApi) => Promise<unknown>): void {
    void currentWindow()
        .then((win) => win && action(win))
        .catch((e) => console.error("window control failed", e));
}

export function WindowControls() {
    const [maximized, setMaximized] = useState(false);

    // The maximise glyph differs between maximised and restored, and the window
    // can reach either state without this component being clicked — a
    // double-click on the drag region, or Win+Up. Polling on an interval would
    // be cheaper to write but visibly laggy; Tauri emits a resize event, which is
    // exactly when the state can have changed.
    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;

        void (async () => {
            const win = await currentWindow();
            if (win == null || disposed) {
                return;
            }
            setMaximized(await win.isMaximized().catch(() => false));
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            unlisten = await getCurrentWindow().onResized(async () => {
                setMaximized(await win.isMaximized().catch(() => false));
            });
            if (disposed) {
                unlisten?.();
            }
        })();

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    if (isMacOS()) {
        return null;
    }

    return (
        <div className="window-controls" data-testid="window-controls">
            <button
                className="window-control"
                onClick={() => run((win) => win.minimize())}
                title="Minimize"
                aria-label="Minimize"
            >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
                </svg>
            </button>
            <button
                className="window-control"
                onClick={() => run((win) => win.toggleMaximize())}
                title={maximized ? "Restore" : "Maximize"}
                aria-label={maximized ? "Restore" : "Maximize"}
            >
                {maximized ? (
                    // Two offset outlines, the way every platform draws "restore".
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                        <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
                        <path d="M2.5 2.5V0.5H9.5V7.5H7.5" fill="none" stroke="currentColor" />
                    </svg>
                ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                        <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
                    </svg>
                )}
            </button>
            <button
                className="window-control window-control-close"
                onClick={() => run((win) => win.close())}
                title="Close"
                aria-label="Close"
            >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M0 0L10 10M10 0L0 10" stroke="currentColor" fill="none" />
                </svg>
            </button>
        </div>
    );
}
