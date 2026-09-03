// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * The Tauri shell's implementation of HostApi.
 *
 * Two things shape this file. First, Tauri's `invoke` is asynchronous only, while
 * a third of HostApi is synchronous getters that Electron answered over
 * `ipcRenderer.sendSync` — so the Rust side injects those values into the page as
 * a frozen snapshot before the bundle evaluates, and they are read from there.
 * Second, several members exist purely to drive Electron machinery this shell does
 * not have (`<webview>` tags, native menus, multiple tab views). Those are marked
 * either as a deliberate no-op or as not implemented, by name — never silently
 * absent, because a host gap that fails quietly is a bug hunt later.
 *
 * The import of ./endpoints closes a cycle back through getenv → host → here. It
 * is safe and deliberate: every use is inside a function body, so nothing needs
 * the other module during evaluation.
 */

import { getWebServerEndpoint, withAuthKey } from "./endpoints";

/** Mirror of Rust's `HostSnapshot` in src-tauri/src/host.rs. */
type TauriHostSnapshot = {
    webEndpoint: string;
    wsEndpoint: string;
    authKey: string;
    platform: NodeJS.Platform;
    isDev: boolean;
    userName: string;
    hostName: string;
    configDir: string;
    version: string;
    buildTime: number;
};

function snapshot(): TauriHostSnapshot | null {
    return (globalThis.window as any)?.__SLTERM_HOST__ ?? null;
}

/** Must match CONTEXT_MENU_CLICK_EVENT in src-tauri/src/menu.rs. */
const ContextMenuClickEvent = "host://contextmenu-click";

/** True when this page is running inside the Tauri shell. */
export function isTauriHost(): boolean {
    return snapshot() != null;
}

function notImplemented(name: string): never {
    throw new Error(`HostApi.${name} is not implemented by the Tauri shell`);
}

/**
 * Fire-and-forget for the void commands: HostApi does not return promises.
 *
 * Tauri's IPC binding is imported lazily so that nothing Tauri-specific is
 * evaluated in a build that is not running under Tauri — the Electron main process
 * pulls this module in through the shared service layer.
 */
function send(command: string, args?: Record<string, unknown>): void {
    void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke(command, args))
        .catch((e) => console.error(`host command ${command} failed`, e));
}

/**
 * Fire-and-forget for the tab and workspace operations.
 *
 * The module is imported lazily for the same reason `onWaveInit` imports its
 * bootstrap lazily: it reaches the service layer, which imports the store, which
 * imports the host resolver that loaded this module. A static import would close
 * that cycle while this module is still evaluating.
 */
function windowOp(name: string, run: (ops: typeof import("@/app/store/tauri-window-ops")) => Promise<void>): void {
    void import("@/app/store/tauri-window-ops")
        .then((ops) => run(ops))
        .catch((e) => console.error(`host ${name} failed`, e));
}

/**
 * Last pointer position, in window coordinates.
 *
 * The tiling layout asks for this synchronously while a drag is in flight, as a
 * fallback for when the drag library has no client offset. Electron answered from
 * the OS and converted to window coordinates; the page can just watch its own
 * pointer, which is the same number without a round trip.
 */
let lastPointer: Point = { x: 0, y: 0 };

function trackPointer(): void {
    globalThis.window?.addEventListener(
        "pointermove",
        (e: PointerEvent) => {
            lastPointer = { x: e.clientX, y: e.clientY };
        },
        { capture: true, passive: true }
    );
}

let cachedSnapshot: TauriHostSnapshot | null = null;
let cachedHost: HostApi | null = null;

/**
 * Builds the host, or returns null when this page is not inside the Tauri shell.
 *
 * Cached against the snapshot it was built from: the resolver runs on every host
 * access, and rebuilding would allocate a new object and register another pointer
 * listener each time.
 */
export function findTauriHost(): HostApi | null {
    const snap = snapshot();
    if (snap == null) {
        return null;
    }
    if (cachedHost != null && cachedSnapshot === snap) {
        return cachedHost;
    }
    trackPointer();
    cachedSnapshot = snap;
    cachedHost = makeTauriHost(snap);
    return cachedHost;
}

function makeTauriHost(snap: TauriHostSnapshot): HostApi {
    return {
        // --- Answered from the startup snapshot ---

        getAuthKey: () => snap.authKey,
        getIsDev: () => snap.isDev,
        getPlatform: () => snap.platform,
        getUserName: () => snap.userName,
        getHostName: () => snap.hostName,
        getConfigDir: () => snap.configDir,
        getAboutModalDetails: () => ({ version: snap.version, buildTime: snap.buildTime }),
        getEnv: (varName: string) => {
            // Only the two the frontend actually asks for. The shell does not
            // forward its whole environment into the page.
            switch (varName) {
                case "WAVE_SERVER_WEB_ENDPOINT":
                    return snap.webEndpoint;
                case "WAVE_SERVER_WS_ENDPOINT":
                    return snap.wsEndpoint;
                default:
                    return null;
            }
        },
        getCursorPoint: () => lastPointer,

        // --- Not offered by this shell yet, but harmless to answer ---

        // No page zoom is wired up, so the factor is fixed and the change event
        // below never fires.
        getZoomFactor: () => 1,
        // The updater is Phase 7 work (tauri-plugin-updater). Reporting
        // up-to-date keeps the update banner out of the UI until it is real.
        getUpdaterStatus: () => "up-to-date",
        getUpdaterChannel: () => "latest",
        // Electron's <webview> needed a preload script on disk. This shell has no
        // <webview>, and the web block degrades to an iframe, which takes none.
        getWebviewPreload: () => "",
        // Electron's webUtils could name the file behind a drag-and-drop File
        // object. Tauri reports dropped paths through its own drag-drop event
        // instead, which the frontend does not consume yet.
        getPathForFile: () => "",

        // --- Actions that reach the desktop through Rust ---

        openExternal: (url: string) => send("host_open_external", { url }),
        openNativePath: (filePath: string) => send("host_open_native_path", { path: filePath }),
        setFullScreen: (isFullScreen: boolean) => send("host_set_fullscreen", { isFullscreen: isFullScreen }),
        sendLog: (log: string) => send("host_log", { message: log }),
        // macOS Quick Look has no cross-platform equivalent; the desktop's own
        // handler for the file is the closest honest substitute.
        onQuicklook: (filePath: string) => send("host_open_native_path", { path: filePath }),
        downloadFile: (filePath: string) => {
            // Electron called webContents.downloadURL. Handing the URL to the
            // system browser downloads it without this shell needing a download
            // manager of its own. The URL carries the auth key because the
            // browser is a different client than this webview.
            const baseName = encodeURIComponent(filePath.split("/").pop() ?? "download");
            const url = withAuthKey(
                `${getWebServerEndpoint()}/wave/stream-file/${baseName}?path=${encodeURIComponent(filePath)}`
            );
            send("host_open_external", { url });
        },
        nativePaste: () => {
            // Electron ran the webview's own paste command. Here the page starts
            // it: a `paste` event on the focused element reaches the terminal's
            // handler, which reads the clipboard itself when the event carries no
            // data (see termutil.extractAllClipboardData).
            const target = document.activeElement ?? document.body;
            target.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
        },
        captureScreenshot: () =>
            Promise.reject(new Error("HostApi.captureScreenshot is not implemented by the Tauri shell")),

        // --- Deliberate no-ops: the machinery they drove does not exist here ---

        // Electron drew the window controls itself and needed the frontend to
        // reserve space. This shell runs undecorated and the frontend draws them.
        updateWindowControlsOverlay: () => {},
        // Suppressed Electron's menu accelerators for the duration of a chord.
        // There is no native menu to suppress.
        setKeyboardChordMode: () => {},
        // The next three served Electron's <webview> tag, which this shell does
        // not have; the web block degrades to an iframe.
        setWebviewFocus: () => {},
        registerGlobalWebviewKeys: () => {},
        clearWebviewStorage: () => Promise.resolve(),
        // No updater is wired up yet, and getUpdaterStatus reports up-to-date, so
        // nothing in the UI offers this.
        installAppUpdate: () => {},
        // A telemetry counter Electron kept in the main process. This shell keeps
        // no counters; the backend records what it needs.
        incrementTermCommands: () => {},
        // Electron used this to resolve the promise it was blocking the window on
        // before showing it. This window is shown at construction.
        setWindowInitStatus: () => {},

        // --- Events nothing emits yet ---
        //
        // Registering the callback and never calling it is the correct behavior
        // for a shell with no native menus, no zoom and no updater: the feature is
        // simply quiet. onWaveInit is the exception and does real work.

        onContextMenuClick: (callback: (id: string) => void) => {
            // Rust hands back the id of whatever the user picked; the frontend
            // already holds the handler it registered under that id.
            void import("@tauri-apps/api/event")
                .then(({ listen }) =>
                    listen<string>(ContextMenuClickEvent, (event) => callback(event.payload))
                )
                .catch((e) => console.error("could not subscribe to menu clicks", e));
        },
        onFullScreenChange: () => {},
        onZoomFactorChange: () => {},
        onUpdaterStatusChange: () => {},
        onMenuItemAbout: () => {},
        onReinjectKey: () => {},
        onControlShiftStateUpdate: () => {},

        onWaveInit: (callback: (initOpts: WaveInitOpts) => void) => {
            // Imported lazily on purpose: resolving the init options needs the
            // service layer, which imports the store, which imports the host
            // resolver that loaded this module. A static import would close that
            // cycle while this module is still evaluating.
            void import("@/app/store/tauri-bootstrap")
                .then(({ resolveInitOpts }) => resolveInitOpts())
                .then(callback)
                .catch((e) => {
                    console.error("startup handshake failed", e);
                    send("host_log", { message: `startup handshake failed: ${e}` });
                });
        },

        // The workspace id Electron needed to pick a window has no use here: this
        // shell has one window, and the menu pops where the pointer already is.
        showContextMenu: (_workspaceId: string, items: ElectronContextMenuItem[]) =>
            send("host_show_context_menu", { items }),

        // --- Tabs and workspaces ---
        //
        // These went to Electron's main process because it owned a WebContentsView
        // per tab and a window-to-workspace map, so it had to build and tear those
        // down itself. This shell owns none of that: the backend holds the tabs and
        // the document follows them, so each of these is a service call. See
        // store/tauri-window-ops.

        createTab: () => windowOp("createTab", (ops) => ops.createTab()),
        closeTab: (workspaceId: string, tabId: string) =>
            windowOp("closeTab", (ops) => ops.closeTab(workspaceId, tabId)),
        createWorkspace: () => windowOp("createWorkspace", (ops) => ops.createWorkspace()),
        switchWorkspace: (workspaceId: string) =>
            windowOp("switchWorkspace", (ops) => ops.switchWorkspace(workspaceId)),
        deleteWorkspace: (workspaceId: string) =>
            windowOp("deleteWorkspace", (ops) => ops.deleteWorkspace(workspaceId)),
        setActiveTab: (tabId: string) => windowOp("setActiveTab", (ops) => ops.setActiveTab(tabId)),

        // --- Still to build, and loud about it ---
        //
        // The application menu is the one native surface with no in-document
        // equivalent yet: Electron assembled its content in the main process, and
        // porting it means moving that assembly into the frontend first.

        showWorkspaceAppMenu: () => notImplemented("showWorkspaceAppMenu"),
    };
}
