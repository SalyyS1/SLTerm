---
phase: 1
title: "Phase 1: Windows shell parity"
status: todo
priority: P1
effort: "3-4w"
dependencies: []
---

# Phase 1: Windows shell parity

## Overview

Make the Tauri shell a shell. Today the packaged Windows build — which is the **Latest** GitHub
release — opens a window with `decorations(false)` and no titlebar UI, so there is no drag region, no
minimise/maximise/close, and a 139 px gap where Electron's overlay controls used to be. The app menu
button throws. Two launches race for the data-dir lock. This phase closes every gap that stops a
Windows user from using the app, and ends with the first real launch on Windows and macOS.

## Key Insights

- **The layout budget half exists, and the other half is a trap.** `frontend/app/tab/tabbar.scss:12` sets
  `-webkit-app-region: drag` (an Electron-only CSS property WebView2 does not honour), and
  `tabbar.tsx:603-618` reserves 74 px left (macOS traffic lights) and 139 px right — but the right
  reservation is gated on `isWindows()`, everything else gets 6 px, and `frontend/util/platformutil.ts`
  has no `isLinux()` at all. So Windows is a fill-the-gap job; Linux needs a reservation that does not
  exist yet, and macOS needs its native traffic lights *back* (`lib.rs:255` suppresses them with
  `decorations(false)` and there is no `TitleBarStyle` anywhere in the tree). Window construction must
  become per-OS, not one frameless window with a per-OS React header.
- **Every window *action* is currently denied.** `core:default` expands to `core:window:default`,
  which is **getters only**. `start-dragging`, `minimize`, `toggle-maximize`, `close` must be added to
  `capabilities/default.json` or the titlebar buttons fail silently.
  `core:tray:default` **is** already granted — the tray needs only a Cargo feature.
- **Windows 11 Snap Layouts cannot be done in Tauri.** `tauri-apps/tauri#4531` is open since
  2022-06-30, blocked upstream: WebView2's `Chrome_RenderWidgetHostHWND` answers `WM_NCHITTEST`
  first, so subclassing the Tauri HWND is structurally useless. The working technique is a
  transparent Win32 child window over the maximise button returning `HTMAXBUTTON` (~380 LOC).
  Deferred to 1.10 — it is the one item that blocks nothing.
- **`min_inner_size(900, 600)` (lib.rs:256) breaks snapping regardless.** Microsoft requires an
  effective min width ≤ ~500 px for a window to enter a snap zone.
- **`window:nativetitlebar` defaults to `true`** (`pkg/wconfig/defaultconfig/settings.json:16`) and has
  **zero consumers** — only declarations at `pkg/wconfig/metaconsts.go:91`, `settingsconfig.go:138` and
  `frontend/types/gotypes.d.ts:1308`. Honouring it as written would make the new titlebar dead code for
  every user who has not edited settings, and would leave a native titlebar sitting above a 139 px empty
  hole (the tabbar reservation is gated on `isWindows()`, not on this key). Two consequences: the default
  must flip to `false` (or the key be inverted to `window:customtitlebar`), and the px reservations must be
  gated on the same value. Also note **who reads it**: the window is built in Rust before the backend
  handshake, so Rust must parse `<config>/settings.json` itself, and a change takes effect on relaunch.
- **Six HostApi members return a plausible wrong answer** rather than failing:
  `getZoomFactor`→1, `getPathForFile`→"", `getWebviewPreload`→"", `clearWebviewStorage`→resolve,
  `getUpdaterStatus`→"up-to-date", `getUpdaterChannel`→"latest". Silent lies are worse than throws;
  the drag-drop background picker and "clear cookies" are broken with no error.
- **Zero `SysProcAttr`/`HideWindow`/`CREATE_NO_WINDOW` anywhere in `pkg/` or `cmd/`.** Every Go
  `exec.Command` off the ConPTY path flashes a console window on Windows. claude-terminal sets
  `0x08000000` on every child (`commands.rs:809,862`).
- **`wsh` has no named-pipe fallback.** `wavebase.go:182-184` builds a filesystem socket path and
  `wshutil.go:188-203` dials TCP then `unix`. Windows 10 1803+ supports AF_UNIX, so this *can* work,
  but it is unproven and there is no `winio`/`npipe` path. Highest-risk Windows unknown.
- **Key interception has three layers, and two of them are free.** Zoom and DevTools are already
  config (`zoom_hotkeys_enabled`, `devtools`) — SLTerm builds its window in Rust so it must pass them
  explicitly rather than rely on defaults. Reload/Find/Print are not: `F5`, `Ctrl+R`, `Ctrl+F`, `F3`,
  `Ctrl+P` are WebView2 browser accelerators. A JS `preventDefault` allowlist covers the common ones
  cross-platform; the complete fix is
  `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)` through `with_webview` + raw
  COM (~15 lines) — wry supports it, Tauri does not pass it through (0 hits for
  `browser_accelerator_keys` in the Tauri repo). That turns a forever-incomplete allowlist into a
  denylist. `webview2-com` must match Tauri 2.11.5's own version or the COM cast will not compile.
- **Do not install a native menu bar.** With `decorations(false)` it has nowhere to render, and it
  drags in Alt-activation and Win32 mnemonics. `showWorkspaceAppMenu` is a popup at a point, so the
  only gap versus today's context menus is position: use `ContextMenu::popup_at(window, position)`
  rather than `popup()`.
- **`Alt+F4` is not a webview accelerator** — it arrives as `WindowEvent::CloseRequested` and is
  interceptable with `api.prevent_close()`. That is where confirm-on-quit belongs.
- **`tauri-plugin-global-shortcut` registers OS-wide grabs.** It is the wrong tool for in-app
  accelerators; it would steal the chord from every other application. One hotkey (show/hide) at most.
- **Five Windows behaviours cannot be validated under Xvfb**, which is the only environment this build
  has ever run in: Snap Layouts, drag regions, `ICoreWebView2Settings3`, window shadow/corner
  attributes, and screenshot-based verification. A real Windows 11 machine is a hard prerequisite for
  this phase, not a nice-to-have.

## Requirements

**Functional**

- Window can be dragged, minimised, maximised, restored and closed from in-page controls on Windows,
  macOS and Linux.
- The workspace app menu opens instead of throwing; every `emain-menu.ts` entry has a home.
- A second launch focuses the running window rather than failing on the data-dir lock.
- Startup failure shows a dialog, not a silent exit.
- Window position/size survive a restart and are clamped to a visible display.
- Ctrl+Shift chords, and keys WebView2 swallows (F5, Ctrl+R, Ctrl+F, Ctrl+P), behave as the app
  intends, not as the browser default.
- No HostApi member returns a fabricated value; anything unsupported by this shell throws or is
  removed from the UI.
- No Go child process flashes a console window on Windows.

**Non-functional**

- No new business logic in Rust. Menu *content* and key *behaviour* live in the frontend; Rust
  renders and reports.
- The `window:nativetitlebar` setting either drives real behaviour or is deleted.
- Windows QA is executed on real hardware, not inferred.

## Architecture

```
frontend/app/tab/titlebar/        NEW  drag region + platform-split controls (React)
frontend/app/store/commands.ts    NEW  command registry: id → {label, accel, run}
frontend/app/store/appmenu.ts     NEW  menu tree (ported from emain-menu.ts) built from the registry
frontend/util/tauri-host.ts       MOD  showWorkspaceAppMenu → host_show_context_menu; drop the liars
src-tauri/src/menu.rs             MOD  extend predefined_for_role beyond today's 9 roles
src-tauri/src/window.rs           NEW  bounds persistence, single-instance focus, startup dialog
src-tauri/capabilities/default.json MOD window actions only; renderer receives no generic webview-creation grant
pkg/util/shellutil, pkg/vcs-adjacent exec paths  MOD  CREATE_NO_WINDOW on Windows
```

Menu flow: frontend owns the tree and the handlers; it hands Rust a JSON menu spec through the
existing `host_show_context_menu` command, and Rust emits `host://contextmenu-click` with the item id
(`menu.rs:146-165`, already working for context menus). Accelerators are registered in
`keymodel.ts` against command ids, **not** as native accelerators — that keeps chord handling in one
place and avoids Tauri's lack of `before-input-event`.

The command registry is introduced here because three later features need it: the app menu (this
phase), the command palette (phase 7) and user keybindings (phase 8). Today every global action is an
anonymous closure in `globalKeyMap` (`keymodel.ts:396-566`) with no id and no label.

## Related Code Files

- Create: `frontend/app/tab/titlebar/titlebar.tsx`, `titlebar.scss`, `window-controls.tsx`
- Create: `frontend/app/store/commands.ts`, `frontend/app/store/appmenu.ts`
- Create: `src-tauri/src/window.rs`
- Modify: `src-tauri/src/lib.rs` (min size, transparency, plugins, single-instance, bounds)
- Modify: `src-tauri/src/menu.rs` (role map), `src-tauri/src/host.rs` (`build_time`, fullscreen event)
- Modify: `src-tauri/capabilities/default.json`, `src-tauri/Cargo.toml`
- Modify: `frontend/util/tauri-host.ts`, `frontend/types/custom.d.ts` (drop dead members)
- Modify: `frontend/app/tab/tabbar.tsx`, `tabbar.scss` (hand the reserved gap to the titlebar)
- Modify: `frontend/app/store/keymodel.ts` (command ids, Ctrl+Shift state, swallowed keys)
- Modify: `frontend/app/app-bg.tsx` (drop `updateWindowControlsOverlay`)
- Modify: `pkg/util/shellutil/shellutil.go` and every Go `exec.Command` site (`CREATE_NO_WINDOW`)
- Reference (read-only): `/home/stackops/saly/claude-terminal/src/components/TitleBar.tsx`,
  `src/components/titlebar/`, `emain/emain-menu.ts`, `emain/emain-window.ts`, `emain/emain-ipc.ts`

## Implementation Steps

1. **1.1 Capabilities and plugins.** Add only the required window-action permissions; explicitly do **not**
   grant `core:webview:allow-create-webview-window` (phase 7 uses one narrow Rust constructor with fixed
   app-local URL). Add `tauri-plugin-single-instance` (registered
   **first** in the builder), `tauri-plugin-dialog`, `tauri-plugin-window-state`, and the `tray-icon`
   Cargo feature. Note `panic="abort"` in the release profile: any plugin relying on unwinding will
   abort the process — verify each one starts under a release build, not just debug.
2. **1.2 Titlebar.** Port claude-terminal's pattern: `onMouseDown` → `getCurrentWindow().startDragging()`
   guarded by `e.buttons === 1 && !target.closest('.no-drag')`. Windows and Linux draw three 46 px buttons
   into the right gap (which 1.3 makes exist on Linux too); macOS keeps its **native** traffic lights in
   the 74 px left reservation rather than drawing fake ones. Delete the `-webkit-app-region` rules.
3. **1.3 Window geometry, per OS.** Build the window differently per platform instead of one frameless
   shape: **macOS** `decorations(true)` with a hidden/overlay titlebar style so the traffic lights survive
   and the 74 px reservation is truthful; **Windows and Linux** `decorations(false)` plus the React
   controls. Add `isLinux()` to `platformutil.ts` and extend the tabbar's right-gap branch to it. Read
   `window:nativetitlebar` (default flipped to `false`) in Rust from `<config>/settings.json` before
   constructing, and gate both the decorations choice and the px reservations on the same value.
   `min_inner_size` width 900 → 330-500 (decision recorded below). Drop `transparent(true)` on Windows and
   use `DWMWA_WINDOW_CORNER_PREFERENCE` for rounded corners; per-pixel alpha forbids DWM rounding anyway.
   Persist bounds and clamp to a visible monitor, replacing `emain-window.ts:67-92`. Pass
   `zoom_hotkeys_enabled(false)` and `devtools(false)` in release explicitly — the window is built in Rust,
   so config defaults do not apply.
4. **1.4 Command registry.** Give every entry in `globalKeyMap` an id and a label; keep the closure as
   the handler. Export the registry so anything unregistered is detectable.
5. **1.5 App menu.** Port the five top-level menus from `emain-menu.ts` (469 LOC) into
   `appmenu.ts` over the registry, including the items with no accelerator that currently have no
   other home: Create Workspace, Relaunch All Windows, Clear Tab Cache, Launch On Full Screen,
   About, Check for Updates. Extend `menu.rs`'s role map for `togglefullscreen`, `zoom`, `front`,
   `minimize`, `delete`, `services`, `hide`, `hideOthers`, `pasteAndMatchStyle`. Switch the popup call
   to `popup_at(window, position)` so the menu opens under the hamburger, not at the cursor. Do **not**
   add a native menu bar.
6. **1.6 Dialogs, single instance, and a non-interactive shutdown path.** Startup errors get a dialog
   before exit (today `lib.rs:229` prints to stderr and vanishes), and lock contention gets its own message
   naming the cause rather than the raw
   `pkg/waveserver/waveserver.go:468` "acquiring wave lock" text. Restore the three missing confirm dialogs
   as DOM modals, and hang confirm-on-quit off `WindowEvent::CloseRequested` + `api.prevent_close()` so
   `Alt+F4` is covered. **Because that makes exit interactive, add `shutdown_backend()` now**: kill the
   sidecar, wait for it, confirm the data-dir lock is released, and expose an "update in progress" flag that
   bypasses confirm-on-quit. `RunEvent::Exit` (`lib.rs:273-281`) stays only as a backstop. Phase 2 calls
   `shutdown_backend()` before `update.install()`; without it, an unattended update installs while
   `wavesrv` still holds the lock. Add the save-image dialog. Single-instance callback focuses the existing
   window.
7. **1.7 Keys.** Three layers, cheapest first. (a) Config: `zoom_hotkeys_enabled(false)`,
   `devtools(false)` in release. (b) JS: `preventDefault` on `F5`/`Ctrl+R`; kill the `contextmenu`
   default (its "Refresh" item is a second reload vector) except inside
   `input, textarea, .monaco-editor, .xterm-helper-textarea, [contenteditable]`; add a `beforeunload`
   backstop while terminals are open — Tauri closes windows through the OS path, so this does not trap
   the user. Guard editable focus, but whitelist `.xterm` so terminal chords still fire. Ignore
   `keydown` while `e.isComposing` — routing composition keystrokes to the PTY is exactly what produces
   duplicated Vietnamese and CJK input. Remember `e.key` is **uppercase** when Shift is held.
   (c) Windows-only: `SetAreBrowserAcceleratorKeysEnabled(false)` via `with_webview` + `webview2-com`
   pinned to Tauri's version, which kills `Ctrl+F`/`F3`/`Ctrl+P` by construction. Then implement chord
   mode in `keymodel.ts` and move the Ctrl+Shift state broadcast into a frontend listener. Delete the
   `<webview>`-era reinjection members (`onReinjectKey`, `registerGlobalWebviewKeys`,
   `setWebviewFocus`) — the iframe path cannot use them.
8. **1.8 Stop lying.** `getZoomFactor`/`onZoomFactorChange`: implement via CSS scale or remove the
   zoom UI. `getPathForFile`: use Tauri's drop event so the background picker works, or disable
   drag-drop there. `clearWebviewStorage`: implement or remove the button. `captureScreenshot`:
   remove the RPC path or implement it. `onFullScreenChange`: emit an event from
   `host_set_fullscreen`. `build_time`: stamp it instead of `0` (`host.rs:56`).
9. **1.9 Windows correctness in Go.** Set `CREATE_NO_WINDOW` (`0x08000000`) on every non-PTY child
   process. Adopt the shared exec rule: execute a real `.exe` directly; route `.cmd`/`.bat` through
   `cmd /C` with the tested batch quoting path; invoke `.ps1` explicitly through PowerShell with an argv
   array — never treat PowerShell scripts as batch files. Routing a real executable through a command
   shell reopens metacharacter injection (CVE-2024-24576 shape). Prove the already-implemented `wsh`
   named-pipe fallback on Windows rather than recreating it.
10. **1.10 Snap Layouts — DECIDED: deferred out of this phase, not dropped.**
    The prerequisite is done: `min_inner_size` is now 500 px wide (`window.rs:28`), which is what
    Microsoft requires before a window may enter a snap zone at all, so `Win+arrow` and drag-to-edge
    work today. What is deferred is only the **flyout on maximise-button hover**, which needs the
    transparent Win32 child window returning `HTMAXBUTTON`, because WebView2 answers `WM_NCHITTEST`
    first and no amount of subclassing the Tauri HWND changes that (`tauri-apps/tauri#4531`, open
    since 2022, blocked upstream).
    Reasons to defer rather than build now: (a) the overlay is positioned arithmetically from button
    width and count, so it must not be written before real hardware confirms the titlebar's geometry —
    which is 1.12, and 1.12 cannot run here; (b) it is the one item in the phase that fails *silently*
    when the geometry drifts, so building it blind is how it ships broken; (c) both off-the-shelf
    crates are poor bets — `tauri-plugin-frame` is ~9 months old with one author, and
    `tauri-plugin-decorum` has been stale since 2024-09 and injects its own titlebar HTML that would
    fight the React one.
    **When it is built, vendor the ~380 LOC child window into `src-tauri`** rather than depend on
    either crate: it is pure Win32 window plumbing, so it stays inside the zero-business-logic rule,
    and vendoring is immune to abandonment. Diagnostic for the subclassing trap, worth keeping: if the
    maximise button still shows its CSS `:hover`, the webview got the mouse and the child window did
    not.
11. **1.11 Capture the Electron baseline.** While a real Windows display is available, install the
    published `v0.20.0` Electron release and record idle RAM, RAM at 10 and 25 tabs, and cold start into
    `plans/reports/`. Phase 3 deletes the ability to measure this and its gate depends on the file existing;
    the prior plan's `phase-0-baseline.md` names these numbers and contains none of them.
12. **1.12 Cross-platform QA.** Execute the matrix below on real Windows 11 and macOS hardware.

13. **1.13 Owned process-tree shutdown.** Implement the awaited ownership flow specified below; preserve
    cancellation semantics, surface remote uncertainty and prove exact-handle escalation on hardware.
14. **1.14 CSP.** Inventory every packaged main-frame requirement (`script/style/connect/worker/font/img/media`
    plus preview framing), author the narrowest policy in `src-tauri/tauri.conf.json`, and separate remote
    preview content from the privileged app origin. Run production/package mode because dev-server allowances
    are not release policy. Add negative tests for injected remote script/frame access and a regression test
    that forbids returning to `null`, wildcard sources or `unsafe-eval` without a reviewed exception.
15. **1.15 Native-path confinement.** Route `host_open_native_path` through one canonical allowlist check
    seeded by explicit picker/project/app-owned paths. Revalidate at call time, resolve symlinks/junctions,
    reject NUL/nonexistent/unsupported targets and avoid leaking resolved outside paths in renderer errors.
    Positive and escape tests cover local paths plus Windows case/UNC behavior.

## Todo

- [x] 1.1 Capabilities + single-instance/dialog plugins (`tauri-plugin-single-instance`,
      `tauri-plugin-dialog`; window-action permissions granted explicitly)
- [x] 1.2 React titlebar with drag region and platform-split window controls
- [x] 1.3 Per-OS window construction (macOS keeps native traffic lights), `isLinux()` + Linux gap,
      `window:nativetitlebar` read in Rust with the default flipped, min size, opaque window + DWM rounded
      corners, bounds persistence with display clamp
- [x] 1.4 Command registry over `globalKeyMap`
- [x] 1.5 App menu ported from `emain-menu.ts`; `showWorkspaceAppMenu` no longer throws
- [x] 1.6 Startup error dialog (incl. a named lock-contention message), confirm-on-quit, save dialog,
      single-instance focus, `shutdown_backend()` + update-in-progress bypass
- [x] 1.7 Ctrl+Shift state, WebView2 default-key suppression; delete webview key members
- [x] 1.8 Remove or implement all six silently-wrong HostApi members; stamp `build_time`
- [x] 1.9 `CREATE_NO_WINDOW` on every non-PTY exec site; exec-shim rule; `wsh` named-pipe fallback
- [x] 1.10 Snap Layouts decision: **deferred** (min width now permits snapping; flyout waits for hardware)
- [ ] 1.11 Electron `v0.20.0` baseline captured (idle RAM, RAM at 10 and 25 tabs, cold start) — **needs a
      real display**
- [ ] 1.12 Windows 11 + macOS QA matrix executed and recorded in `plans/reports/` — **needs hardware**
- [ ] 1.13 Confirmed Quit performs a bounded, awaited shutdown of every app-owned local/WSL/SSH process
      tree, escalating only exact owned handles, recording uncertain remote termination, flushing state and
      releasing the data lock before Rust reaps `wavesrv`; cancelling confirmation leaves all work running
- [ ] 1.14 Replace `app.security.csp: null` with a least-privilege CSP proven against bundled assets,
      loopback HTTP/WS endpoints, workers/fonts/images and required preview behavior; remote/untrusted content
      must not inherit app privileges or force a wildcard fallback
- [ ] 1.15 Constrain `host_open_native_path`: accept only canonical user-approved/project/app-owned paths,
      reject NUL/symlink escapes and unsupported targets, and test an untrusted renderer cannot reveal or open
      arbitrary filesystem locations

## Implementation status (2026-09-06)

Implemented and verified on this machine (Linux, headless Xvfb): the window builds with per-OS
decorations, saved+clamped geometry, and a real shutdown path; the titlebar draws drag + controls on
Windows/Linux with macOS traffic lights; the app menu opens; F5/Ctrl+R/Ctrl+F/Ctrl+P are swallowed;
the pet HUD no longer covers the controls; the startup dialog, single-instance focus, and
confirm-on-quit are wired; `build_time` is stamped; every non-PTY Go exec site is hidden; and `wsh`
gains a named-pipe fallback for Windows without AF_UNIX. Full frontend suite (151 tests) and the Go
suite pass; `cargo check`/`go build` clean on Linux and cross-compiled Windows; a release binary was
built and launched headlessly to a live shell prompt.

**Blocked on real hardware (cannot be done here):** 1.11 (Electron RAM/cold-start baseline) and 1.12
(the Windows 11 and macOS QA matrix — drag, double-click maximise, Snap flyout, IME, ConPTY, WSL,
console-flash). These are the phase's gate for phase 2 and 3. A Windows 11 machine is the hard
prerequisite; without it the phase cannot be declared done. The checklist above is the work to run
there.

## QA matrix (execute on hardware, record results)

| Area | Windows 11 / WebView2 | macOS / WKWebView | Linux / WebKitGTK |
|---|---|---|---|
| Window drag, min/max/close, double-click maximise | must pass | must pass | must pass |
| All three controls present, hit-testable, not overlapping tabs | must pass | **native traffic lights** | must pass |
| `window:nativetitlebar` both values behave as documented | must pass | must pass | must pass |
| Snap: Win+arrow, drag-to-edge | must pass | n/a | WM-dependent |
| Snap Layouts flyout on maximise hover | 1.10, may defer | n/a | n/a |
| App menu + every accelerator | must pass | must pass | must pass |
| xterm WebGL renderer | must pass | must pass | known-weak, canvas fallback OK |
| Monaco (editor + diff) | must pass | must pass | must pass |
| IME: Vietnamese + CJK composition, no duplicated glyphs | **must pass** | must pass | must pass |
| Clipboard copy/paste incl. paste into a TUI | must pass | must pass | must pass |
| `backdrop-filter`, `@container` (frontend pins Chrome ≥128) | must pass | verify | verify |
| ConPTY: pwsh + Git Bash spawn, resize, exit | **must pass** | n/a | n/a |
| `wsh` CLI reaches the server | **must pass** | must pass | passes today |
| WSL connection (`wsl://`) | **must pass** | n/a | n/a |
| SSH remote block + automatic `wsh` install | must pass | must pass | passes today |
| Second launch focuses instead of failing | must pass | must pass | must pass |
| No console window flashes | **must pass** | n/a | n/a |

### 1.13 Owned process-tree shutdown acceptance

Fresh source changes the earlier conclusion. Rust `Backend::shutdown()` kills and waits for the `wavesrv`
sidecar only (`src-tauri/src/lib.rs:71-91`). Go shutdown starts controller cleanup asynchronously
(`pkg/waveserver/waveserver.go:85-103`, especially `:90`), sleeps 500 ms, then exits; that is not proof that
Claude/Codex grandchildren, WSL processes, SSH-launched commands or durable jobs stopped. Preserve 1.6's
implemented close/sidecar work, but do not equate it with all-agents-stopped.

Before phase 4 managed launch builds on this lifecycle, make Go shutdown an awaited bounded sequence:
freeze new app-owned launches; snapshot exact ownership handles/generations; request graceful stop; wait on
completion barriers; escalate local process groups/Windows Job Objects only for exact owned handles; request
WSL/SSH cancellation and record `termination-unconfirmed` if the remote cannot acknowledge; flush controller,
session and terminal state; release the database/data-dir lock; acknowledge Rust, which may then reap
`wavesrv` as last resort. Never `pkill`/`taskkill` by provider name or target an adopted/user-started process.
Cancelling the quit confirmation changes nothing. Detached-window close is not app Quit. Timeout leaves a
visible recovery record on next start rather than claiming success.

Test matrix: local child+grandchild ignoring graceful stop; WSL child; SSH disconnect during cancellation;
durable job; detached window close; user process with the same executable; update-driven unattended exit;
crash during each shutdown stage. Windows process-tree proof and WSL/ConPTY cases require real Windows 11.
Rollback restores the current terminal-only stop path but must warn before exit if owned processes remain;
never silently return to sidecar-only semantics after orchestration ships.

## Success Criteria

- [ ] A Windows 11 user can install the NSIS build, move/resize/maximise/close the window, and reach
      a shell prompt without touching Alt+F4
- [ ] `showWorkspaceAppMenu` is implemented; no HostApi member throws except by explicit design, and
      none returns a fabricated value
- [ ] Launching twice focuses the first window; the data-dir lock is never contended
- [ ] A forced startup failure shows a dialog naming the cause
- [ ] Window geometry survives restart, including after unplugging the monitor it was on
- [ ] macOS shows real traffic lights; Linux's controls sit in a reserved gap, not on top of the tab strip
- [ ] With `window:nativetitlebar` at its shipped default the custom titlebar is the one users see
- [ ] `shutdown_backend()` releases the data-dir lock before the process exits, with no dialog shown when
      the update-in-progress flag is set
- [ ] After confirmed Quit, every exact app-owned local child and descendant is reaped within the configured
      deadline; WSL/SSH/durable ownership is reconciled, uncertainty is recorded, and an unrelated same-name
      process survives. Cancelling Quit leaves every agent running
- [ ] Packaged app starts with a non-null least-privilege CSP; terminal, Monaco, bundled workers/assets and
      approved loopback backend function, while an injected remote frame/script cannot call app APIs
- [ ] `host_open_native_path` opens a trusted project/app-owned path and refuses an outside path plus a
      symlink escape; renderer input alone cannot widen the allowed roots
- [ ] Renderer capability set contains no `core:webview:allow-create-webview-window`; phase-7 detached windows
      can only be constructed through the fixed-URL Rust command
- [ ] `grep -rn "CREATE_NO_WINDOW\|HideWindow" pkg/ cmd/` returns every non-PTY exec site
- [ ] The QA matrix above is filled in with real results, no "assumed"

## Risk Assessment

- **Windows hardware access.** Every item marked "must pass" on Windows needs a real machine; CI can
  build but not launch. *Signal it broke:* the matrix stays unfilled. *Response:* if no Windows box is
  available, this phase cannot be declared done — stop and say so rather than shipping phase 2 on top.
- **Per-OS window construction is where a titlebar plan quietly loses two platforms.** Assigning the React
  controls to "Windows/Linux" while suppressing decorations everywhere leaves macOS with no controls at all,
  and Linux with buttons drawn into a 6 px reservation. *Signal:* it only shows up at 1.12, at the end of
  the phase. *Response:* 1.3 makes construction per-OS and the QA matrix now has a row per platform for
  control presence and overlap.
- **`wsh` transport on Windows.** The named-pipe fallback now exists, but remains unproven on real Windows.
  *Signal:* `wsh` cannot authenticate/reach the server while the GUI works. *Response:* keep Phase 1 open,
  diagnose the existing `wshsocket_windows.go` path on Windows 11, and fix that implementation; do not add a
  second transport or infer success from Linux.
- **Owned descendant cleanup remains incomplete after the implemented sidecar shutdown.**
  `Backend::shutdown()` (`src-tauri/src/lib.rs:71-91`) waits for `wavesrv`, but Go starts controller cleanup
  asynchronously then exits (`pkg/waveserver/waveserver.go:85-103`). *Signal:* a provider/child remains after
  GUI exit or a remote termination is reported complete without acknowledgement. *Response:* 1.13 is an
  unchecked gate: awaited graceful shutdown, exact ownership, bounded escalation and restart reconciliation.
  Do not mark it complete from a clean `wavesrv` exit alone.
- **Min-width vs snapping conflict.** ≤500 px (330 recommended by the technique's author) is narrow
  for a tiled terminal with a widget rail.
  *Signal:* the layout breaks below ~700 px. *Response:* keep 900 and drop Snap Layouts (1.10)
  permanently — snapping into a zone is worth less than a usable minimum window. This is a decision,
  not a defect; record whichever way it goes.
- **Menu port drift.** 469 LOC of menu with ~20 accelerators; missing one silently drops a binding.
  *Mitigation:* drive the port from the exported registry and assert every registry id appears in
  either the menu tree or the keymap.
- **Snap Layouts dependency risk.** `tauri-plugin-frame` is ~9 months old with one author;
  `tauri-plugin-decorum` has been stale since 2024-09 and injects its own titlebar HTML. Vendoring is
  the lower-risk end state.

## Security Considerations

- The exec-shim rule is a security control, not a cosmetic one: routing a real `.exe` through
  `cmd /C` lets `& | ( ) ^ !` in branch names, file paths and remote names from a hostile repository
  escape into command execution.
- `app.security.csp` is `null` today. Replace it in 1.14 with the smallest packaged-app policy that admits
  required self/bundled workers/assets and exact loopback backend endpoints. Validate Monaco, xterm, markdown
  and preview flows; never resolve breakage with `*`, `unsafe-eval` or arbitrary remote script/frame access.
- The renderer receives **no** `create-webview-window` permission. Phase 7's tear-off is a narrow Rust
  `host_tear_off_tab` constructor with a fixed app-local URL and label-scoped capability; test the permission
  remains absent.
- `host_open_native_path` currently has no path validation (`host.rs:98-101`). 1.15 canonicalizes and confines
  to roots established by explicit user choice or app ownership. Scheme filtering from `host_open_external`
  is not sufficient for filesystem paths; symlinks and renderer-controlled absolute paths are test cases.

## Next Steps

Phase 2 (identity, signing, updater) depends on this phase's unchecked hardware and owned-process shutdown
gates — the updater must not ship before a Windows build has been launched and teardown proven. Later ADE
phases run serially after Electron retirement; phase 4 reuses the command registry and process ownership
rather than starting while this phase is incomplete.

