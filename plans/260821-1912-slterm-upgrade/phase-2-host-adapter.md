# Phase 2 — Host adapter boundary + Tauri spike → DECISION GATE

**Est.** 2-3 weeks, partly parallel to Phase 1 · **Depends on:** Phase 0

## Goal

Make the shell replaceable behind one interface, migrate the things that *must* move while Electron
is still running, and settle the runtime with measured data rather than argument.

## Status

| Item | State | Notes |
|---|---|---|
| 2.1 `HostApi` interface | **done** | 46 members in `types/custom.d.ts`; `ElectronApi = HostApi & {6 extras nothing calls}`. Resolution in `util/host.ts`, implementations in `util/electron-host.ts` and `util/tauri-host.ts`. No `getApi()` call site changed. |
| 2.2 Server as a library | open | Not needed while the backend runs as a sidecar; the handshake already works. |
| 2.3 Auth key without the header | **done** | Plus the production CORS the shell needs — see below. |
| 2.4 safeStorage → OS keyring | **done** | Migrates on first read under Electron, backs the old file up, and never needs the shell again. |
| 2.5 Tauri spike | **partly** | The shell compiles, spawns the sidecar, injects the snapshot and can resolve its own startup handshake. Nothing on the checklist below has been *observed* — this environment has no display. |
| 2.6 Wails comparison | open | |
| 2.7 Written decision | open | Blocked on 2.5's checklist. |

### First size measurement (Linux x64, this machine)

The release binary builds and bundles, so the size question has real answers rather than estimates:

| | Electron (`release/linux-unpacked`) | Tauri |
|---|---|---|
| Runtime | **285 MB** (Chromium, Node, `.pak`, libs) | **19 MB** (`slterm`, fat LTO + `opt-level="z"` + strip) |
| App payload | 78 MB (`resources/`) | 44 MB frontend + 25 MB `wavesrv`/`wsh` |
| Total unpacked | 362 MB | ~88 MB |
| **Installer** | not built for Linux | **23 MB** (`.deb`) |

The payload is the same code either way, so the runtime row is the whole story: the part Electron owns
shrinks about 15×. Idle RAM is still unmeasured — that needs a running window.

The 23 MB installer is after trimming assets, which took the frontend from 51 MB to 44 MB:

- **Fonts 9.5 MB → 4.4 MB.** Hack Nerd Font Mono shipped as four 2.3 MB TTFs. WOFF2 is the same
  11,645 glyphs in a better container — verified glyph and cmap counts before deleting the originals.
- **Pet sprites 4.05 MB → 439 KB.** Eleven 640×640 PNGs for a sprite the size slider caps at 128 px;
  384 px still covers a 3× display. Lossy WebP for the opaque ones, lossless for the cut-outs, whose
  alpha edges sit against the terminal background. One sheet nothing referenced is gone.
- The raster path of `vite-plugin-image-optimizer` needed `sharp`, which npm kept declining to install,
  so it had been printing ten failures per build and optimizing nothing. Now scoped to SVG, which SVGO
  handles without a native module. Builds are warning-free.

Untouched, and where the remaining weight is: **Monaco and its language workers are 26.5 MB of the
44 MB** — `ts.worker` alone is 13 MB, and the project already turns its semantic validation off
(`monaco-env.ts` sets `noSemanticValidation: true`). Dropping the TS, CSS, HTML and YAML workers would
take ~17 MB off, at the cost of completions in those languages, and needs a custom Monaco entry point
(`editor.api` plus chosen contributions) rather than just not importing the workers — importing
`monaco-editor` pulls the language clients in, and a client without its worker fails at runtime.
`mermaid` (3.9 MB) and `cytoscape` (1.5 MB) are the next tier.

### What 2.1 turned up that the write-up did not

**A third of HostApi is synchronous, and Tauri has no synchronous IPC.** Electron answered
`getPlatform`, `getEnv`, `getAuthKey`, `getConfigDir`, `getUserName`, `getHostName`,
`getAboutModalDetails`, `getIsDev` and friends over `ipcRenderer.sendSync`, and the frontend reads
some of them at module scope — `frontend/wave.ts:40` resolves the platform before anything can be
awaited. `invoke` cannot serve that.

Resolved by having Rust compute those values at startup and inject them as a frozen
`window.__SLTERM_HOST__` snapshot through a webview initialization script, which is guaranteed to run
before the bundle and is re-injected on reload. The window therefore has to be built in Rust rather
than declared in `tauri.conf.json`: the snapshot depends on endpoints that are only known after the
backend handshake, and an initialization script has to be attached at construction.

**The startup handshake needs no Rust at all.** Electron's main process kept its own map of windows
to workspaces and tabs and pushed the result in as `wave-init`. The backend already owns all of it, so
`frontend/app/store/tauri-bootstrap.ts` asks it over the existing HTTP service API
(client → window → workspace → active tab, creating what does not exist). That is ~60 lines of
TypeScript instead of a Rust port of `emain-window.ts`, and it keeps the "Rust owns zero business
logic" rule intact.

**`getCursorPoint` needed no host call either.** Electron read the OS cursor and converted it to
window coordinates (`emain-ipc.ts:221`); the only consumer is the tiling layout's drag fallback, which
wants exactly that. Watching `pointermove` in the page gives the same number synchronously.

**Three members cannot be honoured by this shell and one class of them is a whole phase.**
`captureScreenshot` rejects; `getWebviewPreload` and `getPathForFile` return empty (no `<webview>`
tag, and dropped-file paths arrive through Tauri's own event instead). Native menus
(`showContextMenu`, `showWorkspaceAppMenu`) and tab/workspace switching throw by name — the latter is
Electron's multi-tab-view model, which Phase 3 replaces with in-DOM tabs. Wiring them to the backend
before Phase 3 lands would move a tab the window cannot then display.

## Work

### 2.1 `HostApi` interface

`emain/preload.ts` exposes ~65 methods on `window.api`; the frontend consumes **46 distinct
`getApi().X` calls across 25 files**. Only one frontend file imports electron at all
(`frontend/app/view/webview/webview.tsx:21`, and only for the `WebviewTag` type).

Extract `HostApi` from the existing `ElectronApi` contract (`frontend/types/custom.d.ts:82`),
covering exactly those 46 methods. Implement `electron-host.ts` against it. All `getApi()` call
sites keep compiling unchanged — this is the seam that makes Phase 7 a file-family swap instead of a
rewrite.

### 2.2 Server as a library

`cmd/server/main-server.go:459` — extract `main()` into:

```go
func Start() (webAddr, wsAddr string, err error)
```

`web.MakeTCPListener` is already called twice there, and `pkg/web/web.go:449` /
`pkg/web/ws.go:44` already take a plain `net.Listener`. So this is ~50 lines of glue and **zero
`pkg/` changes**. Keep the `WAVESRV-ESTART` stderr emission so the Electron path still works.

### 2.3 Auth key via query param  ← easy to miss, security-relevant

**Done.** `pkg/authkey` accepts the key from the `authkey` query parameter as well as the
`X-AuthKey` header, comparing in constant time. On the frontend, `withAuthKey` in
`util/endpoints.ts` stamps it onto every URL the engine loads by itself — `markdown-util.ts`,
`preview-streaming.tsx`, `termsticker.tsx`, `waveutil.ts` and `vdom-model.makeVDomUrl` — while
`util/fetchutil.ts` sets the header on programmatic requests to the server and on nothing else.

**Also required, and not in the original write-up:** the server only sent CORS headers in dev mode.
The frontend under Tauri is served from `tauri://localhost` (`http://tauri.localhost` on Windows),
so every `fetch` to the loopback server is cross-origin and was failing the preflight in a
production build regardless of the auth key. `corsMiddleware` in `pkg/web/web.go` now allows those
shell origins in production too, still reflecting any origin in dev. Access is gated by the auth
key, not the origin; the allowlist only decides who may *read* a response.

Open: serving the frontend from the Go server instead would make all of this same-origin and remove
both the query parameter and the CORS surface. Bigger change — `wavesrv` does not serve the SPA
today — and it is worth deciding before Phase 7 rather than after.

### 2.4 safeStorage → OS keyring, **under Electron**

**Done**, except the route rename.

The store used to hand its whole blob to Electron's `safeStorage` over the `electron` wshrpc route,
which means the file is only openable by a key the shell held. Now it seals the blob itself with
XChaCha20-Poly1305 under a 32-byte master key, and only that key goes to the OS — the keyring holds 44
characters instead of the whole store.

- `envelope.go` — seal/open, and the `SLTERM-SECRETS-1:` prefix that tells the two formats apart. AEAD
  rather than plain encryption because an attacker who can write the file could otherwise flip bits in
  a stored token and the store would hand the result to an SSH session.
- `master_key.go` — the key, from the OS keyring (`SLTerm` / `secrets-master-key`) or, where no keyring
  is reachable, a 0600 file next to the store. Electron's safeStorage fell back to a hardcoded key in
  exactly that case, so this is no weaker and is at least reported honestly through the existing
  `getsecretslinuxstoragebackend` rpc, which now answers `os-keyring` or `config-file` on every
  platform rather than probing Electron for a Linux backend name.
- Migration runs at the first read, while the shell is still there to answer, and writes through
  synchronously rather than waiting for the debounced writer. The original file is kept as
  `secrets.enc.pre-keyring`, and a failed shell decrypt leaves it untouched and says how to recover.

Two traps worth keeping in mind, both covered by tests:

- **An existing key file always wins over minting a keyring entry.** A machine that once had no
  keyring and later gains one would otherwise get a fresh key, leaving every stored secret sealed
  under one nothing looks for.
- **An unreadable key file is a hard failure, not something to replace.** A corrupt *keyring* entry is
  the opposite: it opens nothing, so refusing to start would only wedge the app.

Writes are now atomic (temp file + rename). The store is the only copy of the user's secrets and the
key file the only thing that opens it; neither survives a torn write.

Still open: renaming the `electron` wshrpc route to `host`. Nothing in Go calls
`ElectronEncryptCommand` any more — only the interface declaration, the generated client and emain's
handler remain — so the rename is now a cleanup rather than a dependency.

### 2.5 Tauri 2 spike

Throwaway Tauri shell loading the current Vite bundle against the sidecar Go server, with one
working terminal block. Measure on **Windows/WebView2 first** (user's priority platform), then
macOS/WKWebView, then Linux/WebKitGTK.

Verify specifically:

- xterm **WebGL** renderer
- Monaco
- `backdrop-filter`, `@container` (frontend pins `Chrome >= 128`)
- IME
- `ws://` from the `tauri://` origin — **unverified, and a hard blocker if it fails**
- clipboard
- multi-window (a Wave window + a builder window)
- the `unstable` multiwebview feature — could preserve per-tab isolation and make Phase 3 optional

### 2.6 Wails v3 comparison spike

Same checklist, as the documented fallback. Records *why* Tauri was chosen rather than asserting it.

### 2.7 Written decision

Go/no-go criteria: engine fidelity, multi-window, memory, startup. Fallback rule: **Tauri sidecar,
never a Rust backend.** If both spikes fail on Windows, the plan stops and gets rethought — do not
proceed into Phase 3 on hope.

## Validation

- All 46 `HostApi` methods enumerated and implemented by `electron-host.ts`; app runs unchanged.
- `server.Start()` callable in-process **and** the Electron path still boots.
- Media subresources load with the query-param key (test with the header injection disabled).
- Secrets written pre-migration still decrypt post-migration.
- Spike results recorded per-platform in `plans/reports/`.

## Risk

2.5's `ws://`-from-`tauri://` question is the single highest-leverage unknown in the whole plan; test
it on day one of the spike. 2.4 is destructive if botched — back up the secret store before
migrating, and verify round-trip on a copy first.
