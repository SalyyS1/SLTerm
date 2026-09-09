---
phase: 4
title: "Phase 4: Agent state and notifications"
status: todo
priority: P1
effort: "3-4w"
dependencies: [3]
---

# Phase 4: Agent state and notifications

## Overview

Build the shared Claude/Codex capability and managed-launch foundation, backend-owned agent observations and reliable attention notifications. This is not a frontend-only classifier port. Block rendering may unmount while its agent continues; status must remain useful in cold tabs and multiple windows.

Read [architecture contract](./architecture-contract.md), especially identity, lifecycle, trust and terminal invariants. Blockers: completed shell/process teardown, Tauri host-route replacement and phase-3 performance baseline. Owner: one agent-runtime maintainer; shared RPC/config/controller files exclusively owned here until handoff to phase 5.

## Requirements

- Both Claude Code and Codex discover/launch in existing PTYs; explicit provider marker and profile, never inference from command text alone. Record host, cwd, provider home, CLI version, requested/effective preferences and generation.
- Capabilities distinguish interactive TUI from structured execution, hooks, explicit session IDs/resume, usage and config support. Codex app-server is a separately owned integration, not a passive TUI observer.
- Process states and agent states are distinct. UI vocabulary: starting, working, needs-you, idle, turn-done, stopped, failed, unknown/stale. No claim that silence means task success.
- Backend snapshots continue without mounted xterm. Hooks/structured provider events are stronger observations; process exit overrides stale working hints. OSC and mounted-buffer heuristic are advisory only, not approval/readiness authority. When no verified authoritative signal exists, fail closed to `unknown/stale`; never promote a heuristic guess to exact needs-you/turn-done.
- Hand-typed agents may be marked for observation. Explicit managed relaunch is required for spawn-only hooks/session identity/usage. Promotion must not silently kill the current shell.
- One waiting-episode notification across all windows; suppress for focused agent, DnD (including overnight), denied OS permission and already-delivered episode. Notification content is generic and bounded; no private transcript snippets.
- Live terminal delivery is ordered and byte-preserving with bounded backpressure; no per-byte Jotai writes, destructive line dedup or provider parsing in Rust. Durable history advances only across acknowledged contiguous writes. Storage timeout/full disk closes the current segment with a visible gap, keeps live rendering responsive, and starts a new segment only after recovery; no gapped history is labeled complete or lossless.
- Observation capture has an explicit degraded contract. Queue overflow, hook timeout, endpoint loss, parser reset,
  disk/storage failure or event-sequence gap marks that launch `degraded` with cause and last-good timestamp;
  state falls back only to still-valid stronger sources, otherwise `unknown/stale`. Degraded capture can suppress
  attention/completion notification but can never manufacture `idle`, `turn-done` or successful completion.

## Architecture and data flow

User launch/profile → Go capability adapter → immutable launch receipt + generation → existing controller/PTY. Provider observation (hook/structured event), process transition and bounded output-derived hint → backend reducer → versioned snapshot → Jotai glyphs/sidebar/board and notification delivery owner.

Introduce `pkg/agent/` with adapter descriptors and launch/state services. Store active handles in process memory keyed by launch ID; persist receipt and state needed for recovery in existing wstore. A block controller is reused across launches: allocation `pkg/blockcontroller/shellcontroller.go:72-83`, sole production constructor caller `pkg/blockcontroller/blockcontroller.go:233`. Never attach unfenced mutable provider state to a shared controller. Late read/wait callbacks compare active generation before updates.

Existing launch trace: command builder `pkg/blockcontroller/shellcontroller.go:427` → local `:522`, WSL `:442,460,466`, SSH `:475,493,499`. Shell-typed commands bypass builder. Output loop `:565-580` appends raw bytes; derive bounded hints on a separate path. Wait/status transition `:599-617` and explicit stop `:98-124` emit idempotent terminal outcome. Stop interface callers are `pkg/blockcontroller/blockcontroller.go:99,278,326`.

Private managed-hook descriptor is atomically replaced per app generation. Hook reads descriptor every invocation, posts per-launch token, provider/session identity, generation and sequence. Validate size, timeout, expected host and active launch; reject stale/duplicate/spoofed ownership. Hook install is managed-entry merge with backup/CAS, removal only for own entries. Hook failure degrades state with diagnostics; never blocks provider indefinitely.

Backend observations for cold tabs: provider callbacks or structured launch channel, plus process lifecycle. Interactive Codex without a verified explicit event remains live/stale/unknown rather than pretending exact waiting coverage. Frontend OSC handler alone cannot solve cold tabs. Optional bounded backend OSC observer must preserve original bytes and treat titles only as hints. Snapshot timestamps reveal freshness and unsupported precision.

Capture health is a first-class sibling of agent state: `healthy | degraded | unavailable`, with cause,
source, dropped/gapped sequence range and last-good observation. The reducer never treats absence after a gap
as settled silence. A bounded derivation queue may coalesce superseded activity timestamps, but cannot drop
process exits, questions or approval requests. Live PTY bytes continue to render in order; durable capture
uses acknowledged contiguous offsets. The current source path has a two-second append deadline and logs then
continues on failure (`pkg/blockcontroller/blockcontroller.go:48,365-370` and
`pkg/blockcontroller/shellcontroller.go:565-580`), so implementation must replace that silent-loss behavior:
on append failure, record a visible gap/degraded segment boundary, never advance persisted/replay offsets past
the missing range, and resume into a new segment only after storage acknowledgment. On observer overload,
mark degraded before losing semantic observations, pause confidence-dependent notifications, request
snapshot/resync where supported and remain unknown until a fresh authoritative snapshot closes the semantic
gap. The UI shows capture health on tooltip/sidebar/board; diagnostics are bounded and contain no transcript
body.

## Related code files

Existing modify seams (source verified; detailed trace in architecture contract):
- `pkg/blockcontroller/shellcontroller.go:72,427,565,608`, `blockcontroller.go:233,317` — managed launch and lifecycle hooks.
- `pkg/shellexec/shellexec.go:40,156,177,295,338,584`, `conninterface.go:22,86,168,239` — host-specific launch/owned cancellation without a second PTY stack.
- `pkg/wshrpc/wshrpctypes.go:31`, existing generation task `Taskfile.yml:228`; new `pkg/wshrpc/wshserver/wshserver_agent.go`.
- `frontend/app/block/block.tsx:54-55` registration pattern; existing `frontend/app/store/commands.ts:49` and `keymodel.ts:665` launch commands.
- Existing `frontend/app/view/term/termwrap.ts`, `osc-handlers.ts`, `frontend/app/block/blockframe.tsx`, `frontend/app/tab/tab.tsx`, `frontend/app/notification/usenotification.tsx`, `frontend/app/store/wshrpcutil-base.ts:121` — render hints/notifications. Fresh symbol-level ranges outside the cited entry points must be checked at implementation.
- Existing `pkg/wconfig/defaultconfig/{widgets,settings}.json`, `pkg/wconfig/settingsconfig.go`, `src-tauri/{Cargo.toml,capabilities/default.json}`, `src-tauri/src/lib.rs`.
New proposed files:
- `pkg/agent/{adapter,launch,state,hooks,ownership}.go`, `pkg/agent/{claude,codex}.go`, matching tests; next available `db/migrations-wstore/*_agent_launches.{up,down}.sql` (reserve number only at implementation).
- `frontend/app/store/agent-state.ts`, `frontend/app/element/state-dot.tsx`, `frontend/app/notification/agent-notify.ts`; `src-tauri/src/notify.rs` (native display only).
- Generated outputs: Go client, TS client and Go TS types listed in architecture contract; sole current phase owns regeneration.
Read-only reference: `/home/stackops/saly/claude-terminal/src/lib/terminalState.ts:37`, `src-tauri/src/terminal.rs:132`; official Orca hooks/Codex docs linked in architecture contract.

## Implementation steps

1. Add tests for launch identity/capability descriptors first. Probe executables with timeout and safe host-local argv. Missing/auth/version errors visible; no automatic CLI install or approval bypass.
2. Implement immutable managed launch receipts. App-owned agents opt out of detached durable jobs. Apply phase-1 ownership and process-tree cancellation; include WSL/SSH host receipts and uncertain remote termination.
3. Implement reducer with generation and monotonic sequence; process exit precedence; freshness expiry. Keep agent-turn completion separate from command exit and later task verification.
4. Implement Claude managed hook integration and Codex verified structured/event capabilities; test merge/uninstall and descriptor reread after app restart. Capability-disable unsupported version paths rather than invent protocol support.
5. Add bounded activity/OSC derivation; port classifier idle-bias examples to mounted-buffer fallback, not backend authority. Avoid configurable unbounded JS regex on stream; validate bounded patterns or use linear-time Go matching.
6. Publish snapshot/bootstrap and incremental events, reconnect reconciliation, capture-health/gap metadata,
   resync and no per-chunk persistence/rendering. Replace the current append-timeout log-and-continue path
   with storage acknowledgement and contiguous capture segments: live terminal rendering continues, but a
   failed write closes the segment, fences replay offsets and exposes the missing range before a recovered
   segment begins. Session layer later adds transcript/history; do not invent duplicate logs here. Fault-inject
   full derivation queue, append timeout/disk-full, hook endpoint loss and event sequence gaps; prove degraded
   appears before confidence is lost, persisted history never hides a gap, and no false settled/completed
   transition occurs.
7. Add glyph + tooltip/source/freshness/capture health to block/tab, explicit mark-as-agent action and capability reasons. One notification coordinator handles multiwindow dedupe and click-to-focus.
8. Add settings: notification, sound, DnD, hint patterns/poll cadence, stale timeout; native permission/error UI. Preserve ordinary terminal/BEL/`wsh notify` behavior.

## Test scenario matrix

| Level | Scenarios | Expected |
|---|---|---|
| Unit | late previous-generation exit, duplicated hook, out-of-order event, process stopped + working hint | no state resurrection/cross-block leak |
| Unit | Claude numbered answer, input box, picker, Vietnamese/CJK screen; Codex unknown version | false waiting avoided; unknown explicit |
| Unit | split UTF-8/OSC, repeated lines, alternate-screen redraw | raw output unchanged; bounded derivation |
| Unit/fault | full observer queue, dropped sequence, append timeout/disk-full, hook timeout/restart, resync unsupported | capture marked degraded; durable segment exposes gap and fences offsets; live rendering stays responsive; no false idle/done |
| Integration | two providers, same cwd, simultaneous launch; managed hooks edited externally | distinct receipts; CAS conflict not clobber |
| Integration | cold tab, reconnect/new window, stale endpoint after restart | backend snapshot survives mount; old token rejected |
| Integration | wait loop/explicit stop/replacement/cancel | exactly one terminal outcome per launch |
| E2E Windows then macOS/Linux | permission prompt background/focused/DnD; 10 streams | one toast per episode; working input; no orphan process |

Commands at implementation: `go test ./pkg/agent ./pkg/blockcontroller ./pkg/shellexec`, `npx vitest run` focused new suites, `task generate`, `npm run typecheck`; then full `go test ./...` and frontend tests. Actual provider/hardware cases are manual recorded gates, not covered by synthetic fixtures alone.

## Success criteria

- [ ] Claude and Codex launch, cancel and report explicit capability/version receipts; no unsupported feature silently succeeds.
- [ ] Switching beyond warm-tab cap retains backend liveness/state freshness and never reports fabricated exact state.
- [ ] Previous-generation callbacks cannot overwrite new launch or cause notifications.
- [ ] Confirmed quit reaps owned agents/children; unrelated same-name process survives.
- [ ] Hooks survive endpoint changes and coexist with user settings; removal does not delete external changes.
- [ ] Focus/DnD/multiwindow cases deliver at most one toast per waiting episode.
- [ ] Repeated live output/replay has no missing or duplicated bytes under healthy storage; forced append failure keeps live rendering responsive, exposes a durable-history gap/new segment, and never advances replay offsets across the missing range. Ten-stream p95 regression stays within phase-3 budget.
- [ ] Forced queue/hook/sequence capture gaps produce visible `degraded`/`unknown` with cause and last-good
      time, never false idle/turn-done/completion; authoritative resync restores healthy state when available.

## Risk, compatibility and rollback

| Risk (likelihood × impact) | Mitigation / stop signal |
|---|---|
| Provider protocol drift: high × high | version fixtures and capability failure; degrade explicit unknown, never falsely authorize execution |
| Process leak / generation race: medium × high | owned handles, parent-death protection, awaited shutdown and generation tests; block release on surviving owned local children |
| Hook clobber / spoof: medium × high | managed merge/CAS, narrow tokens, schema/size limits; hooks never approve tasks |
| Stream latency: medium × high | coalesced observations, bounded queues and no destructive dedup; rollback derived observer if regression |

Additive markers/defaults leave existing blocks ordinary terminals. On rollback disable agent observations/managed launch entry, remove only managed hook entries after stopping owned launches, preserve receipts/history and leave underlying shell working. Do not downgrade schema destructively. No external Claude team/task JSON mutations. Next: phase 5 reuses adapter identities, receipts and event reducer.
