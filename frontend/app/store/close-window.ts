// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deciding whether the window may close.
 *
 * Electron made this call in its main process, which could read the config and
 * the workspace directly. The Tauri shell cannot: whether to warn depends on
 * `window:confirmclose` and on whether the workspace has unsaved tabs, both of
 * which live in the backend and the page.
 *
 * So the shell stops the close and asks, the page answers here, and the shell
 * closes for real when told to. That is also what makes `Alt+F4` and the window
 * button behave the same as the in-app close — they all arrive as the same
 * window event rather than as a key the page could intercept.
 */

import { atoms, globalStore } from "@/app/store/global";
import { isTauriHost } from "@/util/tauri-host";

/** Must match CLOSE_REQUESTED_EVENT in src-tauri/src/host.rs. */
const CloseRequestedEvent = "host://close-requested";

/**
 * True when closing would lose something the user did not name.
 *
 * A workspace with no name and no icon is one SLTerm created implicitly; closing
 * the window deletes its tabs. With a single tab there is nothing worth a prompt,
 * which is why the threshold is more than one — the same rule Electron used.
 */
function hasUnsavedWork(workspace: Workspace | null): boolean {
    if (workspace == null) {
        return false;
    }
    return !workspace.name && !workspace.icon && (workspace.tabids?.length ?? 0) > 1;
}

/**
 * Whether to warn before closing.
 *
 * Exported for tests: the decision is worth checking directly, because getting
 * it wrong in either direction is bad — a prompt on every close is an
 * irritation, and no prompt loses tabs.
 */
export function shouldConfirmClose(confirmSetting: boolean, workspace: Workspace | null): boolean {
    return confirmSetting && hasUnsavedWork(workspace);
}

/**
 * Answers the shell's close request.
 *
 * Under any shell that does not ask, this does nothing and closing keeps
 * whatever behavior that shell has.
 */
export function registerCloseHandler(): void {
    if (!isTauriHost()) {
        return;
    }
    void (async () => {
        try {
            const { listen } = await import("@tauri-apps/api/event");
            const { invoke } = await import("@tauri-apps/api/core");
            await listen(CloseRequestedEvent, () => {
                const settings = globalStore.get(atoms.settingsAtom);
                const workspace = globalStore.get(atoms.workspace);
                if (shouldConfirmClose(settings?.["window:confirmclose"] ?? false, workspace)) {
                    const proceed = window.confirm(
                        "This window has unsaved tabs. Closing it will delete them.\n\nClose anyway?"
                    );
                    if (!proceed) {
                        return;
                    }
                }
                void invoke("host_close_window").catch((e) => console.error("could not close the window", e));
            });
        } catch (e) {
            // A page that cannot answer must not become a window that cannot be
            // closed. The shell already handles a failed emit the same way.
            console.error("could not subscribe to close requests", e);
        }
    })();
}
