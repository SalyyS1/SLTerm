// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * The application menu, assembled in the page.
 *
 * Electron built this in its main process, which is why `showWorkspaceAppMenu`
 * had nothing to call under the Tauri shell and threw by name. The tree lives
 * here now and the shell only renders it: the frontend hands Rust a list of
 * entries with opaque ids, Rust pops the native menu, and the clicked id comes
 * back on an event. That is the same path context menus already take.
 *
 * Entries come from the command registry wherever one exists, so a keybinding
 * and its menu entry cannot drift apart — the label and the handler have one
 * definition. Items with no keyboard equivalent are declared here directly.
 */

import { getCommand } from "@/app/store/commands";
import { atoms, getApi, globalStore } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isMacOS } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";

/** Ids for entries that are menu-only, so they cannot collide with commands. */
const MenuOnly = {
    About: "menu:about",
    CheckUpdates: "menu:checkUpdates",
    CreateWorkspace: "menu:createWorkspace",
    FullscreenOn: "menu:fullscreenOnLaunch:on",
    FullscreenOff: "menu:fullscreenOnLaunch:off",
    ToggleFullscreen: "menu:toggleFullscreen",
} as const;

/** Prefix for the per-workspace switch entries, whose ids carry the oid. */
const WorkspaceSwitchPrefix = "menu:switchWorkspace:";

/**
 * Turns a registered command into a menu entry.
 *
 * Returns null for an id that is not registered, so a typo drops one entry
 * rather than breaking the menu — and shows up in the console where it can be
 * fixed.
 */
function fromCommand(id: string): ElectronContextMenuItem | null {
    const command = getCommand(id);
    if (command == null) {
        console.error(`app menu references unregistered command ${id}`);
        return null;
    }
    return { id: command.id, label: command.label };
}

function separator(): ElectronContextMenuItem {
    return { id: `sep:${Math.random().toString(36).slice(2)}`, label: "", type: "separator" };
}

/** Drops the nulls a missing command leaves behind. */
function items(...entries: Array<ElectronContextMenuItem | null>): ElectronContextMenuItem[] {
    return entries.filter((e): e is ElectronContextMenuItem => e != null);
}

/**
 * Builds the whole menu.
 *
 * Async because the workspace list comes from the backend. A failure there
 * costs the Workspace submenu and nothing else — the rest of the menu is still
 * worth showing.
 */
export async function buildAppMenu(): Promise<ElectronContextMenuItem[]> {
    const settings = globalStore.get(atoms.settingsAtom);
    const fullscreenOnLaunch = settings?.["window:fullscreenonlaunch"] ?? false;

    const appMenu: ElectronContextMenuItem = {
        id: "menu:app",
        label: "SLTerm",
        submenu: items(
            { id: MenuOnly.About, label: "About SLTerm" },
            { id: MenuOnly.CheckUpdates, label: "Check for Updates" },
            separator(),
            // macOS puts these in the application menu and provides them itself.
            ...(isMacOS()
                ? [
                      { id: "role:services", label: "Services", role: "services" },
                      { id: "role:hide", label: "Hide SLTerm", role: "hide" },
                      { id: "role:hideOthers", label: "Hide Others", role: "hideOthers" },
                      separator(),
                  ]
                : []),
            { id: "role:quit", label: "Quit SLTerm", role: "quit" }
        ),
    };

    const fileMenu: ElectronContextMenuItem = {
        id: "menu:file",
        label: "File",
        submenu: items(
            fromCommand("tab:new"),
            fromCommand("block:new"),
            separator(),
            fromCommand("block:close"),
            fromCommand("tab:close"),
            { id: "role:close", label: "Close Window", role: "close" }
        ),
    };

    const editMenu: ElectronContextMenuItem = {
        id: "menu:edit",
        label: "Edit",
        submenu: items(
            { id: "role:undo", label: "Undo", role: "undo" },
            { id: "role:redo", label: "Redo", role: "redo" },
            separator(),
            { id: "role:cut", label: "Cut", role: "cut" },
            { id: "role:copy", label: "Copy", role: "copy" },
            { id: "role:paste", label: "Paste", role: "paste" },
            { id: "role:pasteAndMatchStyle", label: "Paste and Match Style", role: "pasteAndMatchStyle" },
            { id: "role:delete", label: "Delete", role: "delete" },
            { id: "role:selectAll", label: "Select All", role: "selectAll" }
        ),
    };

    const viewMenu: ElectronContextMenuItem = {
        id: "menu:view",
        label: "View",
        submenu: items(
            fromCommand("block:search"),
            fromCommand("block:magnify"),
            separator(),
            {
                id: "menu:fullscreenOnLaunch",
                label: "Launch On Full Screen",
                submenu: [
                    { id: MenuOnly.FullscreenOn, label: "On", type: "checkbox", checked: fullscreenOnLaunch },
                    { id: MenuOnly.FullscreenOff, label: "Off", type: "checkbox", checked: !fullscreenOnLaunch },
                ],
            },
            { id: MenuOnly.ToggleFullscreen, label: "Toggle Full Screen" }
        ),
    };

    const workspaceMenu = await buildWorkspaceMenu();

    const windowMenu: ElectronContextMenuItem = {
        id: "menu:window",
        label: "Window",
        submenu: items(
            { id: "role:minimize", label: "Minimize", role: "minimize" },
            ...(isMacOS()
                ? [
                      { id: "role:zoom", label: "Zoom", role: "zoom" },
                      separator(),
                      { id: "role:front", label: "Bring All to Front", role: "front" },
                  ]
                : []),
            separator(),
            fromCommand("tab:next"),
            fromCommand("tab:prev")
        ),
    };

    return items(appMenu, fileMenu, editMenu, viewMenu, workspaceMenu, windowMenu);
}

async function buildWorkspaceMenu(): Promise<ElectronContextMenuItem | null> {
    const entries: ElectronContextMenuItem[] = [{ id: MenuOnly.CreateWorkspace, label: "Create Workspace" }];
    try {
        const list = await RpcApi.WorkspaceListCommand(TabRpcClient);
        if (list?.length) {
            entries.push(separator());
            for (const workspace of list) {
                entries.push({
                    id: `${WorkspaceSwitchPrefix}${workspace.workspacedata.oid}`,
                    label: workspace.workspacedata.name,
                });
            }
        }
    } catch (e) {
        // The rest of the menu is still useful without the workspace list, and a
        // menu that fails to open at all is worse than one missing a submenu.
        console.error("could not list workspaces for the app menu", e);
    }
    return { id: "menu:workspace", label: "Workspace", submenu: entries };
}

/**
 * Runs whatever the user picked.
 *
 * Ids that name a command go through the registry; the rest are handled here.
 * Roles are absent from this switch on purpose — the platform performs those
 * itself and never reports them back.
 */
export function handleAppMenuClick(id: string): void {
    if (getCommand(id) != null) {
        void runRegisteredCommand(id);
        return;
    }
    if (id.startsWith(WorkspaceSwitchPrefix)) {
        const oid = id.slice(WorkspaceSwitchPrefix.length);
        getApi().switchWorkspace(oid);
        return;
    }
    switch (id) {
        case MenuOnly.About:
            modalsModel.pushModal("AboutModal");
            break;
        case MenuOnly.CheckUpdates:
            getApi().installAppUpdate();
            break;
        case MenuOnly.CreateWorkspace:
            getApi().createWorkspace();
            break;
        case MenuOnly.FullscreenOn:
            fireAndForget(() => RpcApi.SetConfigCommand(TabRpcClient, { "window:fullscreenonlaunch": true }));
            break;
        case MenuOnly.FullscreenOff:
            fireAndForget(() => RpcApi.SetConfigCommand(TabRpcClient, { "window:fullscreenonlaunch": false }));
            break;
        case MenuOnly.ToggleFullscreen:
            getApi().setFullScreen(!globalStore.get(atoms.isFullScreen));
            break;
        default:
            // A separator or a submenu header; nothing to do.
            break;
    }
}

async function runRegisteredCommand(id: string): Promise<void> {
    const { runCommand } = await import("@/app/store/commands");
    runCommand(id);
}
