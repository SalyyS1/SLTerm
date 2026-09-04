# SLTerm Seams Scout — 2026-09-03

Evidence-first scout of SLTerm's exact seams for the ADE plan. All code claims cite `file:line`.
Repo root: `/home/stackops/saly/SLTerm`. Reference: `/home/stackops/saly/claude-terminal`.

Re-verification pass 2026-09-03 14:0x: every §1 row re-checked against `emain/preload.ts:8-68`,
`frontend/util/tauri-host.ts:124-287` and the named frontend callers; §2 re-checked against the actual
`lib.rs`/`host.rs`/`menu.rs`/`Cargo.toml`/`Cargo.lock`/`capabilities`/`tauri.conf.json`/`release-tauri.yml`;
§3-§7 spot-checked. Corrections applied this pass: `emain/` is 18 files not 19 and has 43 not 42 `ipcMain`
registrations; `settings.json` has 27 keys not 29; `ZshIntegrationDir` **does** exist (`shellutil.go:79`);
`go-winio` is **already** a dependency so a Windows named-pipe fallback needs no new dep; `dist/frontend` is
63 MB not 57 MB; window-construction detail (`transparent(true)`, `min_inner_size`) added to §2; Electron
never had a system tray either.

## 1. HostApi surface (Phase-1 work list)

Contract: `frontend/types/custom.d.ts:80-127` (`HostApi`, 46 members, none optional).
Superset for Electron only: `custom.d.ts:145-152` (`ElectronApi`).
Resolver: `frontend/util/host.ts:24-28` (Tauri first, Electron fallback), `host.ts:37-43` (`getHostApi` throws when absent),
`host.ts:55-57` (`hostSwitchesTabsInDocument()` — true only under Tauri; Electron used one webview per tab).
Electron impl = `emain/preload.ts:7-69` (contextBridge on `window.api`). Tauri impl = `frontend/util/tauri-host.ts:124-287`.

`notImplemented` (`tauri-host.ts:49-51`) has exactly **one** call site: `showWorkspaceAppMenu` (`tauri-host.ts:285`).
`captureScreenshot` throws separately via its own rejected promise (`tauri-host.ts:194-195`). Everything else either works,
returns a fixed value, or is a registered-but-never-fired callback.

Legend: **real** = functionally equivalent; **sub** = different mechanism, same user outcome; **stub** = fixed value;
**noop** = accepted and discarded; **throws** = hard failure at call time.

| # | HostApi member | Electron impl | Tauri impl | Status | Frontend caller (breakage) |
|---|---|---|---|---|---|
| 1 | `getAuthKey` | `preload.ts:8` sendSync | `tauri-host.ts:128` snapshot | real | — |
| 2 | `getIsDev` | `preload.ts:9` | `:129` snapshot | real | — |
| 3 | `getPlatform` | `preload.ts:10` | `:130` snapshot | real | — |
| 4 | `getCursorPoint` | `preload.ts:11` (OS screen → window coords) | `:147` + pointermove tracker `:88-98` | sub | tiling drag fallback |
| 5 | `getEnv` | `preload.ts:32` (any var) | `:135-146` only `WAVE_SERVER_WEB_ENDPOINT` / `WAVE_SERVER_WS_ENDPOINT`, else `null` | partial | `util/endpoints.ts` |
| 6 | `getUserName` | `preload.ts:12` | `:131` | real | — |
| 7 | `getHostName` | `preload.ts:13` | `:132` | real | — |
| 8 | `getConfigDir` | `preload.ts:15` | `:133` | real | — |
| 9 | `getWebviewPreload` | `preload.ts:18` (path on disk) | `:160` returns `""` | stub | `app/view/webview/webview.tsx:36` — `<webview>` preload dead |
| 10 | `getAboutModalDetails` | `preload.ts:17` | `:134` (version+buildTime) | real | `app/modals/about.tsx` |
| 11 | `getZoomFactor` | `preload.ts:19` | `:153` fixed `1` | stub | `frontend/wave.ts:71`, `app/store/global.ts:75` — zoom UI inert |
| 12 | `showWorkspaceAppMenu` | `preload.ts:21` → `emain-menu.ts` native menu | `:285` **`notImplemented`** | **throws** | `app/tab/tabbar.tsx:596` — hamburger menu button throws |
| 13 | `showContextMenu` | `preload.ts:22` | `:258` `host_show_context_menu` (workspaceId dropped) | real | all right-click menus |
| 14 | `onContextMenuClick` | `preload.ts:23` | `:226-234` listen `host://contextmenu-click` | real | — |
| 15 | `downloadFile` | `preload.ts:24` → `webContents.downloadURL` | `:175-185` builds `/wave/stream-file` URL + system browser | sub | no in-app download UI/progress |
| 16 | `openExternal` | `preload.ts:25-31` | `:168` `host_open_external` | real | — |
| 17 | `onFullScreenChange` | `preload.ts:33` | `:235` noop, never fires | noop | `app/store/global.ts:66` — fullscreen atom never updates |
| 18 | `onZoomFactorChange` | `preload.ts:35` | `:236` noop | noop | `wave.ts:72`, `global.ts:76` |
| 19 | `onUpdaterStatusChange` | `preload.ts:37` | `:237` noop | noop | `global.ts:113` |
| 20 | `getUpdaterStatus` | `preload.ts:38` | `:156` fixed `"up-to-date"` | stub | `wave.ts:124`, `global.ts:112` |
| 21 | `getUpdaterChannel` | `preload.ts:39` | `:157` fixed `"latest"` | stub | `app/modals/about.tsx:19` |
| 22 | `installAppUpdate` | `preload.ts:40` | `:212` noop | noop | `app/notification/usenotification.tsx:10` |
| 23 | `onMenuItemAbout` | `preload.ts:41` | `:238` noop | noop | `global.ts:84` — About unreachable from menu |
| 24 | `updateWindowControlsOverlay` | `preload.ts:42` | `:201` noop | noop | `app/app-bg.tsx:36` — no space reserved for controls |
| 25 | `onReinjectKey` | `preload.ts:43` | `:239` noop | noop | `app/store/keymodel.ts:373` — webview key reinjection dead |
| 26 | `setWebviewFocus` | `preload.ts:44` | `:207` noop | noop | `webview.tsx:1008,1012` |
| 27 | `registerGlobalWebviewKeys` | `preload.ts:45` | `:208` noop | noop | `keymodel.ts:567` |
| 28 | `onControlShiftStateUpdate` | `preload.ts:46` | `:240` noop | noop | `keymodel.ts:363` — Ctrl+Shift overlay hint dead |
| 29 | `createWorkspace` | `preload.ts:48` | `:272` → `tauri-window-ops.ts:55-62` | real | — |
| 30 | `switchWorkspace` | `preload.ts:49` | `:273` → `tauri-window-ops.ts:65-72` | real | — |
| 31 | `deleteWorkspace` | `preload.ts:50` (native msgbox) | `:275` → `tauri-window-ops.ts:81-89` (DOM `confirm`) | sub | — |
| 32 | `setActiveTab` | `preload.ts:51` | `:277` → `tauri-window-ops.ts:92-99` | real | — |
| 33 | `createTab` | `preload.ts:52` | `:269` → `tauri-window-ops.ts:31-38` | real | — |
| 34 | `closeTab` | `preload.ts:53` | `:270` → `tauri-window-ops.ts:46-52` (`fromElectron=false`) | real | — |
| 35 | `setWindowInitStatus` | `preload.ts:54` | `:218` noop | noop | `wave.ts:80,122,208` — window is shown at construction instead |
| 36 | `onWaveInit` | `preload.ts:55` (push from main) | `:242-254` → `tauri-bootstrap.ts:40-58` (pull from Go) | real | — |
| 37 | `sendLog` | `preload.ts:56` | `:171` `host_log` | real | — |
| 38 | `onQuicklook` | `preload.ts:57` (macOS Quick Look) | `:174` → `host_open_native_path` | sub | — |
| 39 | `openNativePath` | `preload.ts:58` | `:169` `host_open_native_path` | real | — |
| 40 | `captureScreenshot` | `preload.ts:59` invoke | `:194-195` **rejected promise** | **throws** | `app/store/tabrpcclient.ts:60` — RPC screenshot fails |
| 41 | `setKeyboardChordMode` | `preload.ts:60` | `:204` noop | noop | `keymodel.ts:51` (no native accelerators to suppress) |
| 42 | `clearWebviewStorage` | `preload.ts:61` invoke | `:209` `Promise.resolve()` | noop | `webview.tsx:539` — "clear cookies" silently does nothing |
| 43 | `incrementTermCommands` | `preload.ts:63` | `:215` noop | noop | `app/view/term/osc-handlers.ts:84` |
| 44 | `nativePaste` | `preload.ts:65` | `:186-193` dispatches synthetic `paste` event | sub | — |
| 45 | `setFullScreen` | `preload.ts:66` | `:170` `host_set_fullscreen` | real | — |
| 46 | `getPathForFile` | `preload.ts:68` `webUtils.getPathForFile` | `:164` returns `""` | stub | `app/view/waveconfig/background-picker.tsx:166` — drag-drop bg picker broken |

Totals: **real 19, sub 6, stub 6 (+1 partial `getEnv`), noop 12, throws 2.**

Phase-1 work list ranked by user-visible damage:
1. `showWorkspaceAppMenu` (throws — app menu; needs the menu content moved out of `emain-menu.ts` into the frontend).
2. `updateWindowControlsOverlay` + frameless titlebar (window is `decorations(false)`, so there is currently no titlebar at all).
3. Updater quartet (20, 21, 19, 22).
4. `captureScreenshot` (throws on an RPC path).
5. `getPathForFile` and `clearWebviewStorage` (silent wrong answers — worse than throwing).
6. Zoom pair (11, 18), `onFullScreenChange` (17), `onMenuItemAbout` (23).
7. Webview quartet (9, 25, 26, 27) — only needed if a real `<webview>` replacement lands; iframe path does not use them.

`ElectronApi`-only extras (`custom.d.ts:146-151`), which a replacement shell does **not** owe:
`getDataDir` (`preload.ts:14`), `getHomeDir` (`preload.ts:16`), `setWaveAIOpen` (`preload.ts:62`), `doRefresh` (`preload.ts:67`).
Two are declared but never exposed by the preload: `onNavigate`, `onIframeNavigate` (`custom.d.ts:148-149`) — dead declarations.
One is exposed but never declared: `openNewWindow` (`preload.ts:20`).
Non-`window.api` preload channels that also disappear with Electron: `webview-new-window` (`preload.ts:72-75`),
`webcontentsid-from-blockid` (`preload.ts:77-81`).

## 2. Tauri shell inventory

Total Rust: 590 LOC (`lib.rs` 283, `menu.rs` 165, `host.rs` 133, `main.rs` 9). Tauri **2.11.5** (`src-tauri/Cargo.lock`).

### 2.1 Rust commands (5 total — the entire IPC surface)

| Command | Definition | Registered | Purpose | Notes |
|---|---|---|---|---|
| `host_open_external` | `host.rs:89-95` | `lib.rs:214` | desktop default handler for a URL | rejects non-http(s) (`host.rs:91-93`) — hardening against markdown/terminal-sourced URLs |
| `host_open_native_path` | `host.rs:98-101` | `lib.rs:215` | reveal path in file manager | no path validation |
| `host_set_fullscreen` | `host.rs:121-126` | `lib.rs:216` | `window.set_fullscreen` | emits no change event back → `onFullScreenChange` stays dead |
| `host_log` | `host.rs:130-133` | `lib.rs:217` | frontend log → stderr | |
| `host_show_context_menu` | `menu.rs:146-158` | `lib.rs:218` | build+popup a native menu from a JSON tree | id-opaque; frontend owns behavior |

Support, not commands: `HostSnapshot` (`host.rs:22-37`, serialized camelCase, injected as an init script at `lib.rs:195-208`
and read at `tauri-host.ts:37-39`); `emit_menu_click` (`menu.rs:161-165`) wired via `on_menu_event` (`lib.rs:220-224`);
role→`PredefinedMenuItem` map (`menu.rs:119-139`) covering only copy/cut/paste/selectAll/undo/redo/minimize/close/quit.
Sidecar lifecycle: `start_backend` (`lib.rs:119-186`) spawns `wavesrv.<arch>[.exe]`, parses the `WAVESRV-ESTART` line off
stderr (`lib.rs:157-166`), drains stderr on a thread (`lib.rs:174-183`); killed on `RunEvent::Exit` (`lib.rs:276-281`).
Auth key: 64 hex chars, `rand::thread_rng` (`lib.rs:40-44`). Data dirs: `~/.slterm/{data,config}` (`lib.rs:100-113`).
`build_time` is hardcoded `0` (`host.rs:56`) → About modal shows no build time.

Window construction (all of it, `lib.rs:250-268`) — the frameless-titlebar starting point:
`WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html"))`, `.title("SLTerm")`,
`.inner_size(1400,900)`, `.min_inner_size(900,600)`, `.decorations(false)`, `.resizable(true)`, `.center()`,
`.initialization_script(...)`. Then `#[cfg(not(target_os = "macos"))] builder = builder.transparent(true)`
(`lib.rs:264-267`) — the inline comment records why macOS is excluded: `transparent` needs Tauri's
`macos-private-api` feature, which disqualifies the app from the Mac App Store. So today: no decorations, no titlebar,
transparent on Windows/Linux only, no bounds persistence, hardcoded window label `"main"` (which is also the only label
in `capabilities/default.json:5`, so a second window gets **no permissions** until that list changes).

### 2.2 Cargo plugins

**Zero.** `Cargo.toml:16` is `tauri = { version = "2", features = [] }`, and `grep -c tauri-plugin Cargo.lock` = **0**.
Every plugin the ADE needs is net-new: `tauri-plugin-updater`, `-single-instance`, `-dialog`, `-global-shortcut`,
`-opener` or `-shell`, `-window-state`, plus a tray (core feature `tray-icon`, not a plugin).
Deps are only `serde`, `serde_json`, `rand 0.8`, `hostname 0.4` (`Cargo.toml:16-22`).
Release profile is already size-tuned: `opt-level="z"`, `lto="fat"`, `codegen-units=1`, `panic="abort"`, `strip=true`
(`Cargo.toml:24-32`). Note `panic="abort"` — a plugin that relies on unwinding (or `catch_unwind`) will abort the process.

### 2.3 Capabilities

`src-tauri/capabilities/default.json` — one capability, `identifier: "default"`, `windows: ["main"]`,
`permissions: ["core:default"]` (`default.json:6`). Nothing else. Every plugin added in 2.2 needs its permission
appended here, and `core:default` does **not** include `core:window:allow-start-dragging` — needed for a draggable
custom titlebar unless the frontend uses `data-tauri-drag-region` (which routes through the same permission).
UNVERIFIED whether `core:default` in 2.11.5 covers `set_fullscreen` via the command wrapper (it works today because
the call is in Rust, not the JS API).

### 2.4 tauri.conf.json keys (complete — 1382 bytes, all of it)

| Key | Value | Consequence for the plan |
|---|---|---|
| `productName` | `SLTerm` | rebrand target → `SL-ADE` |
| `version` | `0.20.0` | duplicated in `Cargo.toml:3` — two places to bump |
| `identifier` | `dev.salyvn.slterm` | changing it orphans installed app data/registry keys on Windows |
| `build.frontendDist` | `../dist/frontend-tauri` | staged, not `dist/` directly |
| `build.beforeBuildCommand` | `npm run build:prod && node scripts/stage-tauri-frontend.mjs` | |
| `build.beforeDevCommand` | `npm run build:dev && node scripts/stage-tauri-frontend.mjs` | no watch mode; every dev iteration is a full build |
| `app.withGlobalTauri` | `false` | frontend must import `@tauri-apps/api` (it does, lazily) |
| `app.windows` | `[]` | window is built in Rust (`lib.rs:250-268`) because the init script needs post-handshake endpoints |
| `app.security.csp` | `null` | **no CSP** — worth a hardening item given the webview renders markdown and remote content |
| `bundle.active` | `true` | |
| `bundle.targets` | `nsis, app, dmg, deb, rpm` | no `msi`, no `appimage`, no `updater` artifact target |
| `bundle.icon` | 5 entries incl. `icon.icns`, `icon.ico` | |
| `bundle.copyright` / `publisher` | `Copyright 2025, Salyvn` / `Salyvn` | |
| `bundle.shortDescription` | `Open-Source Modern Terminal by Salyvn` | rebrand copy (also `Cargo.toml:4` `description`) |
| `bundle.category` | `DeveloperTool` | |
| `bundle.resources` | `../dist/bin/* → bin/`, `../dist/schema/* → schema/` | how `wavesrv` + `wsh` ship; `app_root` (`lib.rs:52-59`) probes `resource_dir()/bin` |
| `bundle.linux.deb.depends` | `libwebkit2gtk-4.1-0`, `libgtk-3-0` | |

Absent keys the ADE work will need: `plugins.updater` (endpoints + pubkey), `bundle.createUpdaterArtifacts`,
`bundle.windows.{certificateThumbprint,digestAlgorithm,timestampUrl,nsis.*}`, `bundle.macOS.{signingIdentity,
entitlements,minimumSystemVersion}`, `app.windows[].*` (unused by design), `app.trayIcon`.

### 2.5 release-tauri.yml (`.github/workflows/release-tauri.yml`, 145 lines)

Trigger: `push` on tag `tauri-v[0-9]+.[0-9]+.[0-9]+*` plus `workflow_dispatch` (`:16-20`). `permissions: contents: write` (`:22-23`).
Toolchain pins: Go `1.25.6`, Node `22`, `GOTOOLCHAIN=local`, `NODE_OPTIONS=--max-old-space-size=4096` (`:25-29`).

| label | runner | bundles | native deps |
|---|---|---|---|
| `linux-x64` | `ubuntu-latest` | `deb,rpm` | `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev` (`:83-84`) |
| `windows-x64` | `windows-latest` | `nsis` | Zig 0.14.0 for the CGO sqlite cross-compile (`:72-76`) |
| `macos-arm64` | `macos-latest` | `dmg` | none |

`fail-fast: false` (`:39`) — one platform failing still publishes the others.
Steps: checkout → setup-go → setup-node → `dtolnay/rust-toolchain@stable` (unpinned) → `Swatinem/rust-cache` on `src-tauri`
→ `npm ci` with 3 retries (`:86-92`) → `node scripts/repair-native-deps.mjs` (`:96`) → `node scripts/build-tauri-sidecar.mjs`
(`:99`) → `npx tauri build --bundles <matrix>` (`:104`).
Artifact collection (`:106-114`) globs only `*.deb *.rpm *.dmg *-setup.exe`, uploaded as `tauri-installers-<label>`,
`if-no-files-found: error`, 7-day retention.
Publish job (`:123-145`): downloads all with `merge-multiple: true`, `softprops/action-gh-release@v2`,
`draft: false`, **`prerelease: true`** (`:143`), `generate_release_notes: true`, `fail_on_unmatched_files: true`.

**Not built** (gaps for the plan):
- **macOS x64** — no Intel runner in the matrix; `arch_tag()` (`lib.rs:92-98`) would resolve `x64` but nothing produces it.
- **Linux arm64 / Windows arm64** — absent.
- **AppImage** — not in `bundle.targets` and not in the matrix.
- **`.msi`** — Windows ships NSIS only. For "Windows primary", MSI matters for enterprise/winget-style deployment.
- **`.app` bundle** — listed in `bundle.targets` but the collector glob (`:111-113`) never picks it up.
- **Code signing / notarization** — no `APPLE_*`, `TAURI_SIGNING_*`, or Windows cert secrets anywhere in the file.
  Consequence today: macOS shows Gatekeeper "damaged/unidentified developer", Windows shows SmartScreen.
- **Updater artifacts** — no `createUpdaterArtifacts`, no `latest.json` generation, no signature step.
- **Any smoke test** — nothing launches the built binary; the Linux-only Xvfb launch was manual.

## 3. Electron-only behavior not yet replicated

`emain/` = 4236 LOC / 18 files. 43 `ipcMain.on|handle` registrations across `emain/`. Only `process.platform` is read
twice directly (`emain-platform.ts:34` → `unamePlatform`, `updater.ts:186`); everything else consumes `unamePlatform`,
so the platform-branch surface is small and already centralized.

| # | Parity item | Electron source (LOC) | Tauri today | Replacement |
|---|---|---|---|---|
| 1 | **Application menu** (5 top-level roles: appMenu, fileMenu, editMenu, viewMenu, Workspace, windowMenu) | `emain-menu.ts` **469** | `showWorkspaceAppMenu` throws (`tauri-host.ts:285`) | frontend-built menu tree, reuse `host_show_context_menu` |
| 2 | **Menu accelerators** (~20 global keys, table below) | `emain-menu.ts:68-349` | none registered anywhere | frontend keymodel or `tauri-plugin-global-shortcut` |
| 3 | **Dock/tray menu** ("New Window") | `emain-menu.ts:454-466` (`app.dock.setMenu` `:465`) | absent | Tauri `tray-icon` feature. Note: Electron never had a system tray either (grep `Tray` in `emain/` → 0 hits), so a tray is **net-new product surface**, not parity work. |
| 4 | **Runtime menu-def → native menu converter** | `emain-menu.ts:380-417` (`convertMenuDefArrToMenu`) | partial: `menu.rs:54-139` (context menus only, 9 roles) | extend `predefined_for_role` (`menu.rs:124-137`) for `pasteAndMatchStyle`, `delete`, `services`, `hide`, `hideOthers`, `togglefullscreen`, `zoom`, `front`, `minimize` |
| 5 | **Keyboard chord mode** | `emain-tabview.ts:130-131,189-203` + `:330-338` (`before-input-event`) + `emain-ipc.ts:302-306` | `setKeyboardChordMode` noop (`tauri-host.ts:204`) | only needed once native accelerators exist (item 2) |
| 6 | **Webview key reinjection** | `emain-ipc.ts:258-300` (~43 LOC: per-webContents `before-input-event`, `webviewKeys` allowlist, `preventDefault` + `reinject-key`) | `onReinjectKey`/`registerGlobalWebviewKeys`/`setWebviewFocus` all noop | iframe cannot intercept keys cross-origin — needs a real design decision, not a port |
| 7 | **Ctrl+Shift state broadcast** | `emain-ipc.ts:276` `handleCtrlShiftState` → `control-shift-state-update` | `onControlShiftStateUpdate` noop (`tauri-host.ts:240`) | frontend keydown listener (already in-document) |
| 8 | **Window bounds + multi-display restore** | `emain-window.ts:33-92` (`calculateWindowBounds`, `screen.getPrimaryDisplay` `:67,75`), `:149-155` apply, `:194-196` bounds poller, `emain-util.ts:198` `ensureBoundsAreVisible` | `lib.rs:250-257` fixed 1400x900 `.center()` — no persistence, no off-screen guard | `tauri-plugin-window-state`, or persist to Go config (hard-rule-preferred) |
| 9 | **Single-instance lock** | `emain.ts:373-379` (`requestSingleInstanceLock`, quit on failure) | absent — two launches race for the `~/.slterm/data` lock | `tauri-plugin-single-instance` |
| 10 | **Startup error dialog** | `emain.ts:386` `showErrorBox("Startup Error", …)` | `lib.rs:229-232` prints to stderr and exits silently — user sees nothing | `tauri-plugin-dialog` or a pre-handshake window |
| 11 | **Save-image dialog** | `emain-ipc.ts:146-158` `showSaveDialog` + filters + stream-to-file | absent (no ipc equivalent) | `tauri-plugin-dialog` + Go write, or Go-side save |
| 12 | **Confirm dialogs** (4 sites) | `emain.ts:274`, `emain-platform.ts:52` (ARM64-translation warning), `emain-window.ts:283`, `:771` | one replaced by DOM `confirm` (`tauri-window-ops.ts:82-84`); other three absent | DOM modal (keeps logic out of Rust) |
| 13 | **Updater** (electron-updater) | `updater.ts` **253** — channel resolution from `autoupdate:channel` (`:23-34`), `autoInstallOnAppQuit` (`:58`), `allowDowngrade=false` (`:63`), 5 event handlers (`:67-88`), interval re-check (`:148-160`), `quitAndInstall` (`:208`) | `getUpdaterStatus` fixed "up-to-date", all 4 members noop/stub | `tauri-plugin-updater` + signing keys + `latest.json`; channel logic belongs in Go/frontend |
| 14 | **Global hotkey (show/focus app)** | `emain-window.ts:874-895` `registerGlobalHotkey` (`waveKeyToElectronKey`, unregister-then-register, restore+show+focus, create window if none) | absent | `tauri-plugin-global-shortcut` |
| 15 | **Multi-window** | `emain-window.ts` **897** total (`WaveBrowserWindow`, `getAllWaveWindows`, per-window workspace map) | one hardcoded `"main"` window (`lib.rs:251`) | `WebviewWindowBuilder` per window + `tauri-bootstrap` per-window id |
| 16 | **Per-tab WebContentsView** | `emain-tabview.ts` **402** | replaced by in-document switching (`host.ts:55-57`) — architecture is already different | none (deliberate) |
| 17 | **Zoom** | `emain-ipc.ts:255` `getZoomFactor`, menu items `emain-menu.ts:224-268` (Reset/In/Out incl. hidden variants) | `getZoomFactor()→1`, `onZoomFactorChange` noop | webview zoom API or CSS scale |
| 18 | **Window-controls-overlay + average color** | `emain-ipc.ts:308+` (`FastAverageColor` on the captured overlay region) | `updateWindowControlsOverlay` noop | frontend-drawn titlebar makes this moot |
| 19 | **`clear-webview-storage`** | `emain-ipc.ts` handler → session clear | `Promise.resolve()` (`tauri-host.ts:209`) — **silently lies** | Go-side or drop the UI affordance |
| 20 | **`capture-screenshot`** | `emain-ipc.ts` `ipcMain.handle` | rejected promise (`tauri-host.ts:194`) | Tauri has no core screenshot API; needs a plugin or Go capture |
| 21 | **Telemetry counters in shell** | `emain-activity.ts` **107** (`increment-term-commands` etc.) | `incrementTermCommands` noop (`tauri-host.ts:215`) | route to Go `pkg/telemetry` (see §4) |
| 22 | **Auth-key request injection** | `emain.ts:397` `configureAuthKeyRequestInjection(session.defaultSession)` | frontend appends the key per request (`util/endpoints.ts` `withAuthKey`) | already handled differently |
| 23 | **Hardware-acceleration launch setting** | `emain.ts:367-372` + `launchsettings.ts` (21) reads `window:disablehardwareacceleration` pre-`whenReady` | absent | Tauri needs a WebKit/WebView2 flag equivalent — UNVERIFIED whether Tauri 2 exposes one |
| 24 | **ARM64-translation (Rosetta) warning** | `emain-platform.ts:42-60` | absent | low priority; macOS-only |
| 25 | **`webview-new-window` / `webcontentsid-from-blockid`** | `preload.ts:72-81` | absent | iframe path; "open in system browser" for web block needs `host_open_external` wiring |
| 26 | **`open-new-window` / `do-refresh` / `set-waveai-open`** | `preload.ts:20,67,62` | not in `HostApi` at all | frontend-local or dropped |

### 3.1 Accelerators declared in `emain-menu.ts` (the item-2 work list)

| Accelerator | Action | Line |
|---|---|---|
| `CommandOrControl+Shift+N` | New Window | `:133` |
| `Command+N` (mac) / `Alt+N` | New Window (hidden-1) | `:147` |
| `Command+T` (mac) / `Alt+T` | New Window (hidden-2) | `:154` |
| `Shift+CommandOrControl+R` | Reload Tab | `:201` |
| `devToolsAccel` | Toggle DevTools | `:216` |
| `CommandOrControl+0` | Reset Zoom | `:225` |
| `CommandOrControl+=` / `CommandOrControl+Shift+=` | Zoom In (+hidden) | `:236,246` |
| `CommandOrControl+-` / `CommandOrControl+Shift+-` | Zoom Out (+hidden) | `:258,268` |
| `getWorkspaceSwitchAccelerator(i)` | switch to workspace *i* | `:68` |
| mac-only: `Command+Z/Shift+Z/X/C/V/Shift+V/A` | undo/redo/cut/copy/paste/pasteAndMatchStyle/selectAll | `:92-120` |
| `pasteAccelerator` (var) | paste | `:109` |
| — (role only) | `togglefullscreen`, `minimize`, `zoom`, `front`, `close`, `quit`, `services`, `hide`, `hideOthers`, `delete` | `:116,137,181-188,301,329-332` |

Menu items with **no** accelerator that still need a home: Create Workspace (`:50`), Relaunch All Windows (`:207`),
Clear Tab Cache (`:211`), Launch On Full Screen On/Off submenu (`:279-298`), About SLTerm (`:166`),
Check for Updates (`:172`).

## 4. Go seams for ADE work

### 4.1 `pkg/wshrpc/wshrpctypes.go` (1084 LOC) — where new command families go

One Go interface, `WshRpcInterface` (`:30-215`), is the single declaration point. The contract is documented inline at
`:24-28`: methods must end in `Command`, take `ctx` first, take at most one param, return `error` or `(T, error)`, and
`task generate` regenerates bindings. Commands are **not** string constants — the generator derives them from method names.

Existing SLTerm-specific families, already grouped with comment headers — the exact template for `claudesession` and `vcs`:

| Family | Lines | Comment header |
|---|---|---|
| pet | `:199-206` | `// pet` (`:198`) |
| ai tools | `:208-211` | `// ai tools (Claude Code skills / MCP servers / agents / commands)` (`:207`) |
| agent teams | `:213-214` | `// agent teams (read-only view of multi-agent sessions)` (`:212`) |

Interface closes at `:215`. **New families append here**, followed by their data structs after `:915` (pet structs start
there; AI-tools structs at `:987-1010`). Generated outputs to regenerate: `cmd/generatets/main-generatets.go` and
`cmd/generatego/main-generatego.go` via `task generate` (`Taskfile.yml:228-239`); the TS client lands in
`pkg/wshrpc/wshclient/wshclient.go`. Note `Taskfile.yml:239` — "don't add generates key (otherwise will always execute)",
so `generate` is not cached and must be run explicitly.

There is no separate "host route" command family: host concerns live in `HostApi` (§1), not in wshrpc. The only
host-adjacent RPCs are `SendTelemetryCommand` (`:85`) and the route/control specials (`:38-41`).

### 4.2 `pkg/service` — the HTTP service registry

`ServiceMap` at `pkg/service/service.go:24-31`, six entries: `block`, `object`, `client`, `window`, `workspace`,
`userinput`. This is the surface the frontend's `store/services.ts` calls (used by `tauri-bootstrap.ts:16` and
`tauri-window-ops.ts:17`). Dispatch is reflection-based: `service.go:318` looks up `ServiceMap[webCall.Service]`,
and `ValidateServiceMap()` (`:451-458`) enforces the signature rules at startup. Type mapping uses the
`*RType` reflect vars at `:34-47`.

Design note for the plan: SLTerm's newer features (pet, ai tools, agent teams) went to **wshrpc**, not `ServiceMap`.
Two parallel RPC mechanisms exist. `claudesession` and `vcs` should follow the wshrpc pattern for consistency; only
add to `ServiceMap` if the frontend needs a synchronous-style HTTP call during bootstrap.

### 4.3 `pkg/wconfig/defaultconfig/settings.json` (27 keys, all of it)

Grouped: `app:*` (4), `autoupdate:*` (3), `conn:*` (2), `editor:minimapenabled`, `web:*` (2), `window:*` (10),
`telemetry:enabled`, `term:*` (4). Sibling default files in the same dir: `widgets.json`, `presets.json`,
`termthemes.json`, `mimetypes.json`, `presets/`, plus `defaultconfig.go`.

Plan-relevant current values:

| Key | Default | Why it matters |
|---|---|---|
| `autoupdate:enabled` | `false` | updater is opt-in already; Tauri updater inherits the flag |
| `autoupdate:installonquit` | `false` | consumed at `emain/updater.ts:58` — needs a Tauri equivalent |
| `autoupdate:intervalms` | `3600000` | consumed at `updater.ts:148-160` |
| `telemetry:enabled` | `false` | **off by default** |
| `window:nativetitlebar` | `true` | **conflicts with the Tauri shell**: `lib.rs:255` is `decorations(false)` unconditionally, so this setting is currently ignored. The frameless-titlebar work must reconcile them. |
| `window:fullscreenonlaunch` | `false` | menu toggle at `emain-menu.ts:279-298`, no Tauri path |
| `window:savelastwindow` | `true` | implies bounds persistence, which the Tauri shell does not do (§3 item 8) |
| `window:confirmclose` / `app:confirmquit` | `true` | the confirm dialogs at `emain-window.ts:283,771` |
| `window:maxtabcachesize` | `2` | Electron per-tab WebContentsView concept; meaningless in-document |
| `app:disablectrlshiftarrows` / `app:disablectrlshiftdisplay` | `false` | feed the dead `onControlShiftStateUpdate` path |

New settings the ADE work implies (all net-new): `claudesession:*`, `vcs:*`, keybinding overrides, `pet:*`,
`titlebar:*`. Also referenced from code but **not** in the defaults file: `term:gitbashpath`
(`shellutil.go:161` `config.Settings.TermGitBashPath`), `autoupdate:channel` (`updater.ts:24`).

### 4.4 `pkg/telemetry` — real, not stubbed, but has no uploader

`pkg/telemetry/telemetry.go` is **424 LOC of real implementation**: SQLite-backed `TEvent` rows with
`insertTEvent` (`:128`), `RecordTEvent` (`:234`), activity merging (`mergeActivity` `:150`, `updateActivityTEvent` `:166`),
retention (`CleanOldTEvents` `:265`), and an upload queue (`GetNonUploadedTEvents` `:278`, `MarkTEventsAsUploaded` `:293`,
`GetNonUploadedActivity` `:398`, `MarkActivityAsUploaded` `:411`). Gates: `IsTelemetryEnabled()` (`:97-100`) reads
`settings.Settings.TelemetryEnabled`, default `false`.

The **uploader is gone**: `pkg/wcloud` does not exist in this repo (verified: `ls pkg/wcloud` → no such directory), and
`SendTelemetryCommand` is declared (`wshrpctypes.go:85`) with a generated client stub (`wshclient.go:794`) but has **no
server implementation** anywhere in `pkg/` (grep for `func .*SendTelemetryCommand` returns only the client). So events
accumulate locally and are never sent. Also present: `IsAutoUpdateEnabled()` (`:102`) and `AutoUpdateChannel()` (`:107`) —
the Tauri updater should read these rather than re-deriving the channel.

Consequence for the plan: `incrementTermCommands` (§1 #43) can be routed to `RecordTEvent`/`UpdateActivity` with no
new infrastructure, and it stays local-only by default.

### 4.5 `pkg/blockcontroller` — where a session/pet event hook goes

Three files: `blockcontroller.go` 500, `shellcontroller.go` 926, `durableshellcontroller.go` 275 (1701 total).

The spawn funnel is `ShellController.setupAndStartShellProcess` (`shellcontroller.go:389-535`), called once from
`:243`. It branches to six `shellexec.Start*` entry points: `StartWslShellProc` (`:460`), `StartWslShellProcNoWsh`
(`:442,466`), `StartRemoteShellProc` (`:493`), `StartRemoteShellProcNoWsh` (`:475,499`), `StartLocalShellProc` (`:522`).
Command string and options are assembled in `createCmdStrAndOpts` (`:732`), local shell resolution in
`getLocalShellPath` (`:690-692`, honors `waveobj.MetaKey_TermLocalShellPath`).

Best hook points for session/pet events:
- **Per-command** (needs a shell-integration OSC, not a spawn hook): the frontend already has
  `frontend/app/view/term/osc-handlers.ts:84` calling `incrementTermCommands` — that is the existing per-command seam.
- **Per-process lifecycle**: `manageRunningShellProcess` (`shellcontroller.go:537`) and the status transitions in
  `blockcontroller.go:214,244,322` (`Status_Done` / `Status_Init` / `Status_Running`) — natural place to emit
  session start/stop.
- **Swap-token / integration injection**: `makeSwapToken` (`blockcontroller.go:465-...`) feeds
  `shellutil.TokenSwapEntry`, which is how per-session data already reaches the shell.

### 4.6 `pkg/shellexec` — PTY spawn

`shellexec.go` 764, `conninterface.go` 268, plus `shellexec_pty_test.go` 156 and a `bin/` dir.
PTY library: `github.com/creack/pty v1.1.24` (`go.mod:8`) **replaced** by
`github.com/photostorm/pty v1.1.19-0.20230903182454-31354506054b` (`go.mod:67`) — the fork exists precisely to give
Windows ConPTY support, which upstream creack/pty lacks. Four `pty.StartWithSize` call sites:
`shellexec.go:168, 286, 687, 705`.

Windows shell detection: `shellutil.DetectLocalShellPath()` (`shellutil.go:87-96`) tries `pwsh` → `powershell` →
falls back to the literal `"powershell.exe"`. Git Bash is discovered separately by `FindGitBash`
(`shellutil.go:156-168`), honoring `config.Settings.TermGitBashPath` then a cached filesystem scan.

Shell integration injection: `InitCustomShellStartupFiles()` (`shellutil.go:270`) writes per-shell dirs — the const block
at `shellutil.go:79-82` declares four: `shell/zsh`, `shell/bash`, `shell/pwsh`, `shell/fish`, all created at
`shellutil.go:356-372`. Templating adds `WSHBINDIR`, `WSHBINDIR_PWSH` (PowerShell-specific quoting), and `PATHSEP`
(`;` on Windows, `:` elsewhere) at `shellutil.go:370-388`. There is **no cmd.exe path** — a `cmd` session gets a PTY but
no `wsh` on PATH and no shell integration.

## 5. Windows readiness

| Area | Evidence | Status |
|---|---|---|
| Windows build tags in `pkg/` | 8 files: `wsl/wsl-win.go`, `wavebase/wavebase-win.go`, `remote/sshagent_windows.go` (+`_test`), `util/unixutil/unixutil_windows.go`, `jobmanager/jobmanager_windows.go`, `util/sigutil/sigusr1_windows.go`, plus `cmd/wsh/cmd/wshcmd-shell-win.go` | **works** — the platform split is deliberate and small |
| Data-dir lock | `wavebase-win.go:16-29` uses `alexflint/go-filemutex` (Unix path uses flock) | **works** |
| ConPTY | `photostorm/pty` fork via `go.mod:67` replace directive; 4 `StartWithSize` sites | **untested on Windows** — only the Linux build has ever been launched |
| pwsh detection | `shellutil.go:87-96` pwsh → powershell → `"powershell.exe"` literal | works by construction, **untested** |
| Git Bash | `shellutil.go:156-168` + `term:gitbashpath` setting (not in defaults file) | **untested** |
| pwsh shell integration | `PwshIntegrationDir = "shell/pwsh"` (`shellutil.go:81`), `HardQuotePowerShell` + `PATHSEP=";"` (`shellutil.go:377-386`) | present, **untested** |
| `wsh` binary matrix | `wavebase.go:77-84` includes `windows-x64` and `windows-arm64` | **works** (declared); arm64 has no CI producer |
| `wsh` install/PATH | `shellutil.go:442-457` copies the versioned `wsh-<ver>-windows-x64.exe` from `GetWaveAppBinPath()` to `<datadir>/bin/wsh.exe`, then the integration files prepend that dir to `PATH` | **untested**; failure is logged non-fatally (`:441,446`) so a broken install is silent |
| `wsh` transport | `wavebase.go:182-184` `GetDomainSocketName()` = a **file path** in the data dir. `wshutil.go:188-203` `SetupDomainSocketRpcClient` tries TCP first (`tryTcpSocket` `:180`), then `net.Dial("unix", …)` (`:200`) | **untested on Windows.** Windows 10 1803+ supports AF_UNIX for `net.Dial("unix")`, so this can work, but there is **no named-pipe fallback for wsh**. Mitigating: `github.com/Microsoft/go-winio` is **already a dependency** — used at `pkg/remote/sshagent_windows.go:9,15` (`winio.DialPipe`) and `pkg/remote/sshclient.go:962` (`\\.\pipe\openssh-ssh-agent`) — so adding a pipe fallback is a code change, not a new dep. Highest-risk Windows item. |
| WSL | `pkg/wsl/wsl-win.go` 141, `wsl-unix.go` 79, `pkg/wslconn/wslconn.go` 787 + `wsl-util.go` 226 (1233 LOC total) | **works** (substantial, Windows-tagged impl); **untested** in the Tauri build |
| No-console-window spawn | grep for `SysProcAttr` / `HideWindow` / `CREATE_NO_WINDOW` / `CreationFlags` in `pkg/` + `cmd/` → **zero hits** | **missing** — any `exec.Command` off the ConPTY path (e.g. `host.rs:109` `cmd /C start`, `exec.LookPath` probes, git/wsl invocations) can flash a console window. Cosmetic but very visible on a "Windows primary" product. |
| `wavesrv` naming | `lib.rs:66-70` appends `.exe` only under `cfg!(windows)`; `arch_tag()` `lib.rs:92-98` | **works** |
| Home dir | `lib.rs:108-112` uses `USERPROFILE` on Windows | **works** |
| Username | `host.rs:74` uses `USERNAME` on Windows | **works** |
| `host_open_external` on Windows | `host.rs:106-110` spawns `cmd /C start ""` | **works by construction, untested**; also the console-flash source above |
| NSIS installer | `release-tauri.yml` matrix `windows-x64 → nsis`, Zig 0.14.0 for CGO | built, **never launched** |
| MSI installer | not in `bundle.targets` | **missing** |
| Windows code signing | no cert secrets in the workflow | **missing** → SmartScreen warning on every install |
| Windows arm64 | no runner | **missing** |
| Single-instance | `emain.ts:373` only; no Tauri equivalent | **missing** — two launches contend for the filemutex; second one's failure path is untested |

## 6. Size levers

Measured on the existing build tree (`dist/frontend` 63 MB with maps → `dist/frontend-tauri` **26 MB** after staging).
Staging script `scripts/stage-tauri-frontend.mjs:24` drops only `*.map`, `*.d.ts`, `*.test.*`, `*.spec.*` — that alone is
the 63→26 MB delta, i.e. sourcemaps are the single largest current cost and are already excluded from the Tauri bundle.
`electron.vite.config.ts:126` still sets `sourcemap: true` for the renderer (and `:105` for main), so the maps are built
and then thrown away.

### 6.1 Staged bundle, largest first

| Chunk / dir | Size | Origin | Cuttable? |
|---|---|---|---|
| `assets/monaco-*.js` | **7047 KB** | `frontend/app/monaco/monaco-env.ts:29` | Already trimmed hard (see below). Further cuts mean dropping `basic-languages/_.contribution` (`monaco-env.ts:35`, ~90 languages) — maybe 2-3 MB, at the cost of syntax highlighting. UNVERIFIED split. |
| `assets/mermaid-*.js` | **3989 KB** | `frontend/app/element/markdown.tsx:34` `await import("mermaid")` | **Yes, ~4 MB.** Already lazy (dynamic import + own manualChunk at `electron.vite.config.ts:137`), so it costs disk, not startup. Cut = drop mermaid diagrams from markdown, or move rendering to a Go/CLI step. |
| `assets/cytoscape-*.js` | **1502 KB** | **Transitive from mermaid** — `node_modules/mermaid/package.json` depends on `cytoscape`, `cytoscape-cose-bilkent`, `cytoscape-fcose`. Nothing in `frontend/` imports cytoscape directly (verified: grep → 0 hits). | **Yes, ~1.5 MB, but only by cutting mermaid** (or by excluding mermaid's architecture/state diagram renderers). |
| `assets/index-*.js` | 1155 KB | app core | no |
| `assets/markdown-libs-*.js` | 1069 KB | remark/rehype/unified/micromark family (`electron.vite.config.ts:156-168`) | partially — `streamdown` (`frontend/app/element/streamdown.tsx:10`) and `react-markdown` are two markdown stacks; consolidating to one would shave part of this. Needs a behavior decision. |
| `assets/json.worker-*.js` | 820 KB | `monaco-env.ts:42` | keep — it is what validates SLTerm's own config |
| `assets/react-core-*.js` | 543 KB | react + react-dom 19 | no |
| `assets/editor.worker-*.js` | 528 KB | `monaco-env.ts:41` | no |
| `assets/katex-*.js` | 470 KB | math in markdown | **yes, ~470 KB** if math rendering is out of scope |
| `assets/xterm-core-*.js` | 404 KB | `@xterm/xterm` | no |
| `assets/vdom-model-*.js` | 385 KB | vdom view | only by dropping the `vdom` view |
| `assets/sysinfo-*.js` | 281 KB | sysinfo view | only by dropping the view |
| `assets/xterm-addons-*.js` | 205 KB | webgl/search/serialize/web-links | no |
| `fonts/` | **4.4 MB** | `public/fonts` — 8 woff2: 4× `hacknerdmono-*` (regular/bold/italic/bolditalic), `inter-variable`, 3× `jetbrains-mono-v13-latin-{200,regular,700}` | **Yes, ~2-3 MB.** Two full mono families shipped. Pick one (Hack Nerd for the terminal's glyph coverage, or JetBrains for UI) and drop the other; italic variants are rarely used in a terminal. |
| `fontawesome/` | **1.4 MB** | 5 woff2: `fa-solid-900`, `fa-sharp-solid-900`, `fa-sharp-regular-400`, `fa-brands-400`, `custom-icons` | **Yes, ~0.8-1 MB.** `fa-sharp-*` duplicates `fa-solid`; subsetting to used glyphs would cut most of it. |

### 6.2 Monaco: a custom entry is already in use

`monaco-env.ts` is not the default setup and should not be "optimized" again by the plan:
- imports `monaco-editor/esm/vs/editor/editor.api` **not** `monaco-editor` / `editor.main` (`monaco-env.ts:29`), with the
  reason recorded at `:18-27`: `editor.main` pulls every language *service*, and the TypeScript one alone is a ~13 MB worker.
- single in-flight load promise, nothing loads until the first editor mounts (`monaco-env.ts:10-17`).
- only two workers registered (`monaco-env.ts:40-53`): json service worker + base editor worker.
- every consumer imports monaco **types only** (`import type`) — verified across `preview-edit.tsx:10`,
  `waveconfig.tsx:12`, `codeeditor.tsx:7`, `preview-model.tsx:20`, `diffviewer.tsx:7`, `monaco-react.tsx:8`.
- ambient module declarations for the deep paths live in `frontend/types/monaco.d.ts:13-21`.

### 6.3 Vite chunking

`electron.vite.config.ts:133-183` has a hand-written `manualChunks` with 14 named groups: `monaco`, `mermaid`, `katex`,
`shiki`, `cytoscape`, `xterm-addons`, `xterm-core`, `jotai`, `react-core`, `markdown-libs`, `dnd-libs`, `i18n-libs`,
`floating-ui`, `scrollbar-libs`. Renderer input is a single `index.html` (`:129-131`); **there is no separate Tauri Vite
entry** — the Tauri build reuses the Electron renderer output and post-filters it (`tauri.conf.json:8` →
`build:prod` + `stage-tauri-frontend.mjs`). `optimizeDeps.include` still lists `monaco-yaml/yaml.worker.js` (`:186`)
even though `monaco-env.ts` never loads monaco-yaml — likely dead config.

### 6.4 Pet assets

`frontend/app/view/pet` = **524 KB total**, of which ~404 KB is 12 `waifu_*.webp` sprites (32-56 KB each,
e.g. `waifu_nezuko_1772301086037.webp` 56 KB). Bundled through the frontend (not `public/`), so they land in `assets/`.
Small relative to fonts/mermaid; the pet rewrite is a correctness/UX item, not a size lever.

### 6.5 Honest total

Realistic cuts without dropping a named feature: **~4 MB** (fonts dedupe ~2.5 MB, fontawesome subset ~0.9 MB,
`sourcemap: false` for the Tauri path avoids ~31 MB of build work but no shipped bytes).
Cuts that drop a feature: mermaid + cytoscape **~5.5 MB**, katex **~0.5 MB**.
Floor without touching monaco or xterm: roughly **16-17 MB** staged frontend, from 26 MB today.
Installer sizes today (`tauri-v0.20.0` prerelease): deb 24.6 MB, rpm 24.6, nsis 24.1, dmg 28.4 — so the frontend is the
dominant term and a 9 MB frontend cut is roughly a 9 MB installer cut. UNVERIFIED: compression ratios differ per format.

## 7. Tests

### 7.1 Frontend (vitest)

Config: `vitest.config.ts` — merges `electron.vite.config.ts`'s `renderer` block (`:5`), reporters `verbose` + `junit`
to `test-results.xml` (`:8-11`), istanbul coverage → lcov in `./coverage` (`:12-16`), typecheck against `tsconfig.json` (`:17-19`).

Commands (`package.json` scripts): `npm test` → `vitest` (watch), `npm run coverage` → `vitest run --coverage`,
`npm run typecheck` → `tsc --noEmit`. Task equivalent: `task check:ts` (`Taskfile.yml:263-267`, runs `npx tsc --noEmit`).

12 suites:

| Suite | Path |
|---|---|
| Tauri host contract | `frontend/util/tests/tauri-host.test.ts` (asserts the stub/throw behavior in §1 — lines 72, 102-106, 111) |
| endpoints | `frontend/util/tests/endpoints.test.ts` |
| layout | `frontend/layout/tests/utils.test.ts`, `layoutNode.test.ts`, `layoutTree.test.ts` |
| tab mounting | `frontend/app/workspace/tests/tab-mount-policy.test.ts` |
| terminal | `frontend/app/view/term/tests/`: `term-carry-over`, `term-spawn-gate`, `term-replay`, `batched-writer`, `view-transitions`, `term-options` |

### 7.2 Go

28 `*_test.go` files. No task or script wraps them — run with `go test ./...` (or per-package).
Notable for the ADE work: `pkg/shellexec/shellexec_pty_test.go` (156 LOC, the only PTY test),
`pkg/aitools/aitools_test.go`, `pkg/agentteams/agentteams_test.go`, `pkg/util/shellutil/shellquote_test.go`,
`pkg/authkey/authkey_test.go`, `pkg/web/cors_test.go`, `pkg/secretstore/{envelope,migration,master_key}_test.go`,
`pkg/filestore/blockstore_test.go`, `pkg/remote/sshagent_{unix,windows}_test.go`, `pkg/jobmanager/streammanager_test.go`,
`pkg/streamclient/{stream,streambroker}_test.go`, `pkg/wps`, `pkg/vdom` (+`cssparser`), `pkg/ijson`, `pkg/utilds`,
`pkg/util/{iterfn,iochan,utilfn,daystr,ds,pamparse}`, `pkg/remote/connparse`, `cmd/wsh/cmd/setmeta_test.go`.

### 7.3 Shell-level

`tests/copytests/runner.sh` — bash harness that runs each `tests/copytests/cases/*.sh` in a temp fixture
(`setup_testcp` / `cleanup_testcp` from `testutil.sh`), prints PASS/FAIL and a total. Invoke directly:
`bash tests/copytests/runner.sh`. Not wired to any task or CI job.

### 7.4 E2E

`testdriver/onboarding.yml` — a TestDriver.ai script (`version: 4.0.65`) with one step: click through onboarding,
then assert the CPU graph renders. Driven by `.github/workflows/testdriver-build.yml`, which builds a **Windows .exe
via `task package`** (Electron path) and uploads it for TestDriver to consume.

### 7.5 The gap

`grep "go test\|vitest\|npm test" Taskfile.yml .github/workflows/*.yml` → **zero hits**.
No CI workflow runs any test suite. Workflows present: `bump-version.yml`, `codeql.yml`, `copilot-setup-steps.yml`,
`merge-gatekeeper.yml` (`upsidr/merge-gatekeeper@v1` — gates on *other* statuses, of which there are no test statuses),
`release-tauri.yml`, `release.yml`, `testdriver-build.yml`. Also no `typecheck` job.
So the Tauri host contract test (`frontend/util/tests/tauri-host.test.ts`) — the one suite that would catch a regression
in the §1 table — is never executed automatically. Adding a `test` workflow is a cheap, high-value plan item.

## Unresolved questions

1. `window:nativetitlebar` defaults to `true` (`pkg/wconfig/defaultconfig/settings.json`) but `lib.rs:255` hardcodes
   `decorations(false)`. Should the Tauri shell honor the setting (native titlebar option) or should the setting be
   removed and the custom titlebar made unconditional? This is a product decision, not a port detail.
2. `wsh` transport on Windows: keep `net.Dial("unix")` on the AF_UNIX support in Windows 10 1803+, or add a
   named-pipe path? No named-pipe code exists today, and this has never been run on Windows.
3. Webview key interception (§3 item 6): the iframe replacement for `<webview>` cannot see keystrokes cross-origin.
   Accept the loss, restrict the web block to same-origin/proxied content, or bring back a real embedded browser?
4. macOS x64: add an Intel runner, or declare arm64-only? `arch_tag()` (`lib.rs:92-98`) already resolves `x64` but
   nothing builds it.
5. Two markdown stacks (`react-markdown` via `markdown.tsx` and `Streamdown` via `streamdown.tsx:10`) — is the
   duplication intentional (streaming vs static) or consolidatable?
6. `bundle.identifier` is `dev.salyvn.slterm`. Does the SL-ADE rebrand change it? Changing it orphans existing
   installs' registry entries and app data on Windows; keeping it means the installed app id never says "SL-ADE".
7. Whether Tauri 2 exposes a hardware-acceleration disable flag equivalent to `emain.ts:367-372` — UNVERIFIED.
8. Telemetry has no uploader (`pkg/wcloud` absent, `SendTelemetryCommand` has no server impl). Is that deliberate
   (local-only by design) or an unfinished removal? Affects whether `incrementTermCommands` should be wired at all.
9. `capabilities/default.json:5` scopes permissions to `windows: ["main"]`, and `lib.rs:251` hardcodes that label.
   Multi-window (§3 item 15) needs either a label glob (`"main*"`) or a per-window capability — decide which before
   the window work starts, because it changes how window ids are generated.
10. `cmd` / `cmd.exe` has no shell-integration dir (`shellutil.go:79-82` covers zsh/bash/pwsh/fish only). On a
   Windows-primary product, is `cmd` a supported shell (needs a new integration path) or pwsh/Git-Bash only?
