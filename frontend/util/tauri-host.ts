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

        onContextMenuClick: () => {},
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

        // --- Still to build, and loud about it ---
        //
        // Native menus need Tauri's menu API and a channel to route clicks back.
        // Tab and workspace switching are Electron's multi-tab-view model, which
        // this shell replaces with in-DOM tabs — that work is its own phase, and
        // wiring these to the backend before it lands would move a tab the window
        // cannot then display.

        showContextMenu: () => notImplemented("showContextMenu"),
        showWorkspaceAppMenu: () => notImplemented("showWorkspaceAppMenu"),
        createTab: () => notImplemented("createTab"),
        closeTab: () => notImplemented("closeTab"),
        setActiveTab: () => notImplemented("setActiveTab"),
        createWorkspace: () => notImplemented("createWorkspace"),
        switchWorkspace: () => notImplemented("switchWorkspace"),
        deleteWorkspace: () => notImplemented("deleteWorkspace"),
    };
}
