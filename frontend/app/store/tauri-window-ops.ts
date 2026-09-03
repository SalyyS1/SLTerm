// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Tab and workspace operations for a shell that does not own the tab views.
 *
 * Under Electron these went to the main process, because the main process was the
 * one holding a `WebContentsView` per tab and a window-to-workspace map. It had to
 * create and destroy those views itself, so "create a tab" meant "tell the shell".
 *
 * Nothing here needs a shell. The backend already owns which tabs exist, which one
 * is active and which workspace a window shows; the document follows those objects
 * through the update events it is already subscribed to. So these are plain service
 * calls, and the Rust side stays out of it — which is the hard rule for this port.
 */

import { WindowService, WorkspaceService } from "./services";
import { getBootstrappedWindowId } from "./tauri-bootstrap";

/** Resolves the workspace the window is currently showing. */
async function currentWorkspaceId(): Promise<string | null> {
    const windowId = getBootstrappedWindowId();
    if (windowId == null) {
        return null;
    }
    const window = await WindowService.GetWindow(windowId);
    return window?.workspaceid ?? null;
}

/** Adds a tab to the current workspace and makes it active. */
export async function createTab(): Promise<void> {
    const workspaceId = await currentWorkspaceId();
    if (workspaceId == null) {
        console.warn("createTab: no window resolved yet");
        return;
    }
    await WorkspaceService.CreateTab(workspaceId, "", true);
}

/**
 * Closes a tab, and the window with it when that was the last one.
 *
 * `fromElectron` is false: it tells the backend not to expect a shell to be
 * managing views on the other side.
 */
export async function closeTab(workspaceId: string, tabId: string): Promise<void> {
    const rtn = await WorkspaceService.CloseTab(workspaceId, tabId, false);
    if (rtn?.closewindow) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
    }
}

/** Creates a workspace and switches this window to it, matching Electron's flow. */
export async function createWorkspace(): Promise<void> {
    const windowId = getBootstrappedWindowId();
    const newWorkspaceId = await WorkspaceService.CreateWorkspace("", "", "", true);
    if (!newWorkspaceId || windowId == null) {
        return;
    }
    await WindowService.SwitchWorkspace(windowId, newWorkspaceId);
}

/** Points this window at another workspace. */
export async function switchWorkspace(workspaceId: string): Promise<void> {
    const windowId = getBootstrappedWindowId();
    if (windowId == null) {
        console.warn("switchWorkspace: no window resolved yet");
        return;
    }
    await WindowService.SwitchWorkspace(windowId, workspaceId);
}

/**
 * Deletes a workspace after confirming, since it takes its tabs and blocks with it.
 *
 * Electron asked with a native message box. This uses the DOM's own confirm rather
 * than Tauri's dialog plugin: the plugin would put a user-facing decision in the
 * Rust shell, and the shell is meant to hold no product behaviour.
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
    const confirmed =
        typeof globalThis.confirm !== "function" ||
        globalThis.confirm("Deleting this workspace will also delete its contents.\n\nContinue?");
    if (!confirmed) {
        return;
    }
    await WorkspaceService.DeleteWorkspace(workspaceId);
}

/** Makes a tab active within the current workspace. */
export async function setActiveTab(tabId: string): Promise<void> {
    const workspaceId = await currentWorkspaceId();
    if (workspaceId == null) {
        console.warn("setActiveTab: no window resolved yet");
        return;
    }
    await WorkspaceService.SetActiveTab(workspaceId, tabId);
}
