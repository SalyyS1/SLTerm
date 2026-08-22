# SLTerm Upgrade — Plan Index

**Created:** 2026-08-21
**Base repo:** `/home/stackops/saly/SLTerm` (github.com/SalyyS1/SLTerm)
**Reference repo:** `/home/stackops/saly/claude-terminal` (github.com/talayash/claude-terminal, Tauri 2 + React, v1.31.2)

## Outcome

SLTerm keeps its identity (brand, tiling layout, theme/bg/font system, keybindings, pet) and gains
the Claude Code workstation capabilities claude-terminal demonstrates, while shipping on a
lightweight non-Electron runtime.

## Constraints (from user)

- Brand stays **SLTerm** — never revert to Wave branding.
- **No Electron.** Ship on the lightest/most stable runtime available.
- OS support: Windows + macOS + Linux, **Windows highest priority**.
- Web-browser block loss is **accepted** — degrade to iframe + open-in-system-browser.
- Pet system may be **rebuilt from scratch**; Go becomes source of truth, current local state reset.

## Non-goals

- Not a Wave upstream contribution. This is a permanent fork of the shell layer.
- No Rust business logic. Rust is shell-only (windows/menus/tray/dialogs/updater).
- No in-app orchestration *engine* — agent teams is an observability read model, matching upstream.

## Runtime decision: Tauri 2 + Go sidecar

**Chosen.** Rust shell replaces `emain/`; SLTerm's Go backend (`pkg/`, 52k LOC) is spawned as a
sidecar over its existing HTTP/WS endpoints and is otherwise **untouched**.

Panel scores were Tauri 70 / Wails 68 / Go-webview 38. Tauri wins on the user's stated priority
("ổn nhất, nhẹ nhất, nhanh nhất, hiệu quả nhất", Windows-first):

| | Tauri 2 | Wails v3 |
|---|---|---|
| Maturity | **Stable** | beta.12, near-daily prereleases |
| Windows engine | WebView2 (Chromium) | WebView2 (Chromium) — tie |
| Proven for this app class | **Yes** — claude-terminal is exactly this stack, shipping | No reference |
| Installer size | ~30-40MB (vs ~110-150MB Electron) | ~35-60MB |
| Auto-updater | **Built in** (`tauri-plugin-updater`, signed) | Hand-write in Go |
| Menus/tray/dialogs | **Built in** | Hand-write per platform in Go |
| Languages | Go + Rust shell + TS | Go + TS |

The one Wails advantage — single language — is bounded by a hard rule: **Rust owns zero business
logic**. Everything new lands in Go under `pkg/`. That keeps the "two backends own the same data"
muddle the panel flagged from ever materializing, while buying a stable runtime with a working
reference implementation the user already has on disk.

`cmd/server/main-server.go` already calls `web.MakeTCPListener` twice and both
`pkg/web/web.go` / `pkg/web/ws.go` take a plain `net.Listener` — and Electron *already* spawns
`wavesrv` as a child process with a `WAVESRV-ESTART` stderr handshake. The sidecar contract is
therefore proven in production today; Tauri only changes who spawns it.

**Fallback:** if the Phase 2 spike fails on WebView2, re-evaluate Wails v3. Never a Rust backend.

## Premise corrections (verified against source)

Three of the six requested ports **do not exist upstream**. Phase 4 is net-new design, not a port:

| Requested | Reality in claude-terminal |
|---|---|
| Skills list | Absent. Only `ClaudeConfigModal.tsx` over `~/.claude/{settings.json,agents/,commands/}`. "skill" appears once, in `changelog.json`. |
| MCP management | Absent. Zero refs in `src/` or `src-tauri/src/`, no deps. MCP is the Claude CLI's, not the wrapper's. |
| Workflow engine | Absent. "Workflow" = `OrchestrationPanel.tsx`, a **read-only** 3s poll of `~/.claude/teams/` + `~/.claude/tasks/`. |

And the headline feature is a **discipline, not an algorithm**: claude-terminal has no dedup, no
reflow, no line buffering. Its Claude output is clean because it never touches the byte stream —
real PTY (so Claude enables ANSI redraw), bytes never decoded to a string, no local echo, and a
pre-attach buffer so the leading `ESC` of Claude's banner can never be dropped. Dropping one
control byte wedges xterm's parser, and *that* is what turns Claude's in-place redraws into
stacked duplicate lines elsewhere.

SLTerm's `ptyOffset` + serialized-snapshot replay is already structurally sound. Phase 1 hardens
the real weak seams rather than importing a fix for a bug SLTerm does not have.

## Phases

| # | Phase | Est. | Runtime-dependent? | File |
|---|---|---|---|---|
| 0 | Baseline, guardrails, quick wins | done | No | [phase-0-baseline.md](phase-0-baseline.md) |
| 0.5 | Scope reduction — cut non-ADE subsystems | done | No | [phase-0.5-scope-cut.md](phase-0.5-scope-cut.md) |
| 0.6 | ADE feature layer, build pipeline, release artifact | done | No | [phase-0.6-ade-layer-and-build.md](phase-0.6-ade-layer-and-build.md) |
| 0.7 | CI repair + multi-platform release pipeline | done | No | [phase-0.7-ci-and-release.md](phase-0.7-ci-and-release.md) |
| 1 | Terminal rendering hardening | in progress | No | [phase-1-terminal.md](phase-1-terminal.md) |
| 2 | Host adapter + Tauri spike → gate | 2-3w | Prep | [phase-2-host-adapter.md](phase-2-host-adapter.md) |
| 3 | Single-webview in-DOM tabs | 3-4w | No (done under Electron) | [phase-3-tabs.md](phase-3-tabs.md) |
| 4 | Claude Code feature layer (Go) | 4-6w | No | [phase-4-claude-layer.md](phase-4-claude-layer.md) |
| 5 | Project / VCS layer (Go) | 3-4w | No | [phase-5-vcs.md](phase-5-vcs.md) |
| 6 | SLTerm strengths: pet, keybind, polish | 2-3w | No | [phase-6-slterm-polish.md](phase-6-slterm-polish.md) |
| 7 | Runtime swap to Tauri 2 | 6-10w | Yes | [phase-7-runtime-swap.md](phase-7-runtime-swap.md) |

Phase 0.6 delivered the first slice of Phase 4 (skills/MCP/agents/commands browser
and the agent-teams read model). What remains in Phase 4 is session
detection/resume and the OTLP cost HUD.

Phase 1 has landed the output-fidelity half: the ordered replay, the wrap guard, live font changes,
and the two real bugs the review turned up (held output was being discarded outright, and the batched
writer was corrupting split UTF-8). Still open there: spawn-time PTY sizing, binary WS frames,
layout-remount carry-over, background/renderer decoupling, and the view-transition regression suite.

Phase 2 has landed 2.1, 2.3 and 2.4: the `HostApi` seam (46 members, one resolution point, an Electron
and a Tauri implementation), the auth key off the header plus the production CORS the shell needs, and
the secret store off Electron's safeStorage onto an OS-keyring-held master key — the one item that
would have destroyed data if it slipped past the swap. The Tauri shell now compiles, spawns the
sidecar, injects its startup snapshot and resolves its own `wave-init` handshake from the backend —
release binary 19 MB against Electron's 285 MB of runtime. Nothing has been *observed* running: this
machine has no display. Still open in Phase 2: the spike checklist itself (WebGL, Monaco, IME,
clipboard, and `ws://` from the `tauri://` origin), the `electron` → `host` route rename, and the
written decision.

Native menus and tab/workspace switching are the two gaps that keep the Tauri shell from being usable
rather than merely bootable. Tabs are Phase 3 by design; menus are shell work.

Phases 0-6 are runtime-independent and keep Electron shippable. Phase 7 is the swap. Nothing built
in 0-6 has to be redone in 7 — that is the point of the ordering.

## Acceptance criteria

1. No duplicated or lost scrollback across: font change, theme change, tile drag, split, tab
   switch, resize during heavy output, `clear` after burst, SSH block. Asserted by tests.
2. Skills / MCP / Agents / Commands manageable in-app; agent teams + task board visible.
3. Git status/stage/commit/push, changelists, worktrees usable without leaving the app.
4. Pet XP/coins/inventory persist across restart and advance from real shell activity.
5. Keybindings user-remappable; cheatsheet generated from live bindings.
6. Installed size and idle RAM measured down vs the Phase 0 baseline. **Size: done** — 23 MB `.deb`
   against Electron's 362 MB unpacked; the runtime alone goes 285 MB → 19 MB. RAM still unmeasured.
7. Zero Wave brand strings in user-visible surfaces; SL artwork in all icon binaries.
8. Ships on Windows, macOS, Linux without Electron.

## Open questions

- Upstream Wave sync cadence after the shell fork — hand-port every `emain/` change forever, or
  freeze at a chosen upstream commit? Not blocking until Phase 7.
- Telemetry: `pkg/wcloud` endpoints are placeholder `github.com/SalyyS1/SLTerm/central` URLs that
  are not real services. Stand up, or strip the subsystem?
- Serve the frontend from `wavesrv` instead of the Tauri asset protocol? That makes everything
  same-origin and retires both the auth-key query parameter and the CORS allowlist, at the cost of
  teaching the Go server to serve the SPA. Decide before Phase 7 starts.
