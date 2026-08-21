# Phase 2 — Host adapter boundary + Tauri spike → DECISION GATE

**Est.** 2-3 weeks, partly parallel to Phase 1 · **Depends on:** Phase 0

## Goal

Make the shell replaceable behind one interface, migrate the things that *must* move while Electron
is still running, and settle the runtime with measured data rather than argument.

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

`emain/authkey.ts` injects `X-AuthKey` via `session.webRequest`. **Neither Tauri nor Wails can
inject headers that way.** Without a fix, every subresource load 403s: `<img>`, `<video>`, markdown
images, term stickers, streaming preview.

Make `pkg/authkey` accept the key via query param (or cookie) in addition to the header, and update
the four media-URL builders: `markdown-util.ts:168`, `preview-streaming.tsx:64`,
`termsticker.tsx:110`, `waveutil.ts:10`.

### 2.4 safeStorage → OS keyring, **under Electron**

`pkg/secretstore/secretstore.go:53,185` calls `ElectronEncryptCommand` over the `electron` wshrpc
route. **Swapping the shell makes already-stored secrets undecryptable.**

Re-encrypt to an OS-keyring-backed store while Electron is still present. Rename the route
`electron` → `host`. This must not slip into Phase 7.

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
