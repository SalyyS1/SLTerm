// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Startup handshake for a shell that does not track windows itself.
 *
 * Electron's main process kept its own map of windows to workspaces and tabs, and
 * pushed the resulting ids into the renderer as `wave-init`. A Tauri shell has no
 * such map and must not grow one: the backend already owns which windows exist,
 * which workspace each opens, and which tab is active. So the frontend asks it,
 * over the same HTTP service API it uses for everything else.
 *
 * This is why the runtime swap does not need a Rust port of `emain-window.ts`.
 */

import { ClientService, WindowService, WorkspaceService } from "./services";

/** Fallback size for a window the backend has not seen before. */
const InitialWinSize: WinSize = { width: 1400, height: 900 };

/**
 * Resolves the client, window and tab this webview should open.
 *
 * Creates what does not exist yet — a first launch has no window, and a window
 * whose workspace somehow has no active tab still has to show one — so the caller
 * can treat the result as ready to render.
 */
export async function resolveInitOpts(): Promise<WaveInitOpts> {
    const client = await ClientService.GetClientData();
    const window = await resolveWindow(client);
    const workspace = await WorkspaceService.GetWorkspace(window.workspaceid);
    let tabId = workspace.activetabid;
    if (!tabId) {
        tabId = await WorkspaceService.CreateTab(workspace.oid, "", true);
    }
    return {
        tabId,
        clientId: client.oid,
        windowId: window.oid,
        activate: true,
        // This shell opens one webview for one tab, so the first init of the
        // process is always the primary startup.
        primaryTabStartup: true,
    };
}

async function resolveWindow(client: Client): Promise<WaveWindow> {
    const windowId = client.windowids?.[0];
    if (windowId) {
        try {
            const existing = await WindowService.GetWindow(windowId);
            if (existing != null) {
                return existing;
            }
        } catch (e) {
            // The client can still list a window whose record is gone — a crash
            // between deleting the window and updating the client leaves that.
            // Creating a fresh one is better than refusing to start.
            console.warn("stale window id on the client, creating a new window", windowId, e);
        }
    }
    return await WindowService.CreateWindow(InitialWinSize, "");
}
