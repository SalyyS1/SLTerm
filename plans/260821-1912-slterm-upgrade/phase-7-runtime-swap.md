# Phase 7 — Runtime swap to Tauri 2

**Est.** 6-10 weeks · **Depends on:** Phase 2 gate passed, Phase 3 landed

## Status

| Item | State | Notes |
|---|---|---|
| 7.1 Rust shell + sidecar | **done** | Spawns `wavesrv`, parses the handshake, passes auth key, data/config homes and `SLTERM_APP_PATH`. Kills the sidecar on exit. |
| 7.2 `tauri-host.ts` | **done except the app menu** | 45 of 46 `HostApi` members. Tab and workspace ops are service calls in `store/tauri-window-ops.ts`. `showWorkspaceAppMenu` throws by name. |
| 7.3 Native surface | **context menus only** | Context menus go through Tauri's menu API. App menu, dialogs, tray, global shortcuts, display enumeration, single-instance lock, multi-window: not built. |
| 7.4 Frameless titlebar | **not built** | The window is `decorations(false)`, so there is no titlebar at all yet — no drag region, no close button. On Linux that means the WM's own controls are absent. |
| 7.5 Key interception | **not built** | Chord mode and webview key reinjection still assume Electron's `before-input-event`. |
| 7.6 Web block resolution | **degrades silently** | The web block renders an iframe; nothing offers "open in system browser" yet. |
| 7.7 Build and release pipeline | **done for Linux, wired for all three** | `scripts/build-tauri-sidecar.mjs` + `release-tauri.yml` on a `tauri-v*` tag, publishing a **prerelease**. Unsigned, no updater. |
| 7.8 Cross-engine QA | **Linux only** | See Phase 2's spike result. Windows and macOS have not been run. |

**What "publishable" means here:** the Linux build starts, connects, and gives you a shell, and it is
24.7 MB. It does not yet have a titlebar, an app menu, or any of the polish 7.3–7.6 describe. It ships
as a **prerelease under its own tag** so that the Electron build — which has all of those — stays the
release people get by default. That is the "keep Electron shippable until parity" rule from the goal,
applied literally.

## Goal

Replace the ~4,474 LOC of `emain/` with a Tauri 2 (Rust) shell, keeping Electron shippable until
parity is demonstrated on Windows first, then macOS, then Linux.

## Hard rule

**Rust owns zero business logic.** The Rust shell does windows, menus, tray, dialogs, global
shortcuts, single-instance lock, and the updater. Everything else stays in Go under `pkg/`.

This is the discipline that prevents the "two backends own the same data" muddle the architecture
panel flagged as Tauri's main downside. If a task feels like it needs Rust state, it belongs in Go.

## What does not change

`pkg/` (52k LOC) is untouched: PTY and shell execution (`pkg/shellexec`), block controllers, the
wshrpc bus, the unix socket for the `wsh` CLI (`pkg/wavebase/wavebase.go:60`), TCP web+WS listeners
(`pkg/web/web.go:449-467`), and all 40+ modules including `petengine` and `wconfig`.

The sidecar contract already exists in production: env-var config (`SLTERM_AUTH_KEY`, data/config
home), the `WAVESRV-ESTART` stderr handshake, the `WAVESRV-EVENT:` line protocol for pushing events
to the shell, and stdin-close self-termination. Tauri only changes **who spawns it**.

## Work

### 7.1 Rust shell + sidecar

Tauri spawns the Go `server` binary as a sidecar, parses `WAVESRV-ESTART` for the two endpoints,
injects env. `claude-terminal/src-tauri/` is a working reference for the shell skeleton, capabilities
allowlist, CSP, and updater wiring.

Note: unlike Phase 2's in-process option, the sidecar keeps the process boundary — which preserves
the `wsh` CLI's socket and the crash isolation between shell and backend.

### 7.2 `tauri-host.ts` implementing `HostApi`

Against the interface extracted in Phase 2. Go-side: a `host` wshrpc route replaces
`emain/emain-wsh.ts`'s 9 handlers (notify, focuswindow, encrypt/decrypt via keyring, networkonline,
systembell, webselector). **This collapses today's two parallel IPC systems into one.**

### 7.3 Native surface

- application + context menus, replacing `emain/emain-menu.ts` (~500 LOC)
- dialogs, tray, global shortcuts
- screen/display enumeration for window-bounds restore
- single-instance lock
- multi-window (Wave windows + builder windows)

Tauri provides all of these as plugins/APIs — the reason it beat Wails, where each would be
hand-written per platform in cgo.

### 7.4 Frameless titlebar

React titlebar replacing `titleBarStyle`/`titleBarOverlay`, with drag regions and window controls.
claude-terminal does exactly this (`decorations: false`, `transparent: true`, `TitleBar.tsx`).

**Accept**: Windows acrylic and Linux/Wayland transparency will not fully survive.

### 7.5 Key interception moves to the renderer

There is **no `before-input-event` hook** in Tauri. The chord-mode logic
(`emain-tabview.ts:330`) and the webview key-reinjection bridge (`emain-ipc.ts:286-318`) must move
into `frontend/app/store/keymodel.ts`. Phase 6's command-id indirection is the prerequisite.

### 7.6 Web block resolution

- `helpview.tsx` and `tsunami.tsx` → iframes on the local origin (they already point at local
  origins, so iframes suffice)
- the general web block (`webview.tsx`, 1,083 LOC using `loadURL`, `executeJavaScript`, partitions,
  `setUserAgent`, per-view devtools, zoom) → **degrades to iframe + "open in system browser"**

**User signed off on this loss.** Document it in release notes; many sites will refuse to frame due
to `X-Frame-Options` / CSP `frame-ancestors`.

### 7.7 Build and release pipeline

Tauri build + NSIS/MSI (Windows), dmg/app (macOS), AppImage/deb (Linux). Code signing, macOS
notarization. `tauri-plugin-updater` replaces `electron-updater` (`updater.ts`, 253 LOC) — signed
releases, which is the other reason Tauri beat Wails.

### 7.8 Cross-engine QA matrix

Priority order **Windows → macOS → Linux**:

| Engine | Platform | Risk |
|---|---|---|
| WebView2 | Windows | **Low** — Chromium, near-identical to Electron |
| WKWebView | macOS | Medium — WebKit, test CSS/WebGL |
| WebKitGTK | Linux | **High** — weakest engine vs a `Chrome >= 128` pin |

Focus: xterm WebGL, Monaco, fonts, IME, `backdrop-filter`, clipboard.

Keep the Electron build as fallback until the matrix is green.

## Validation

- Feature parity checklist against the Electron build, per platform.
- Phase 1 regression suite green under Tauri.
- Benchmarks vs the Phase 0 baseline: installer size, installed size, idle RAM, RAM at 10 tabs, cold
  start. **These numbers are the whole point of the phase** — if they do not improve substantially,
  the swap has failed its purpose.
- Secrets written under Electron (Phase 2 migration) still decrypt.
- `wsh` CLI still works against the sidecar.
- Auto-update round-trip tested on Windows.

## Risk

The two structural risks were retired earlier by design: the tab-model refactor happened in Phase 3
under Electron where it was measurable, and the secret-store migration happened in Phase 2 while
Electron could still decrypt.

What remains:

- **Linux/WebKitGTK fidelity.** Lowest platform priority, highest engine risk. If it cannot render
  acceptably, ship Windows + macOS on Tauri and keep an Electron build for Linux rather than blocking
  the whole release.
- **Permanent fork.** After this, every upstream Wave `emain` change must be hand-ported forever. The
  pre-merge branding guard from Phase 0 becomes load-bearing. An explicit upstream-sync cadence
  decision is still open.
- **Rollback**: keep the Electron build alive through this entire phase. It is the only real
  rollback, and abandoning it early is the mistake that would make this phase irreversible.
