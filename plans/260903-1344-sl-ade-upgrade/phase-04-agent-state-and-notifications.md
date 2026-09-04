---
phase: 4
title: "Phase 4: Agent state and notifications"
status: todo
priority: P1
effort: "1-2w"
dependencies: [1]
---

# Phase 4: Agent state and notifications

## Overview

Make an agent's state legible without clicking into its pane: **working / waiting / done / idle /
stopped**, as a glyph on every block header and tab, plus one OS notification when an agent starts
waiting for you. This is the smallest, highest-leverage ADE feature in the plan — the landscape survey
found it in every serious product in the category, and the reference implementation is ~185 LOC of pure
frontend TypeScript with no backend at all.

It comes before the session layer deliberately: the state model is the substrate the agent board
(phase 7), the notifications here, and the session HUD (phase 5) all read from.

## Key Insights

- **The reference heuristic is frontend-only and reads xterm's already-parsed buffer.** No PTY tap, no
  Rust, no Go. Full rule from `claude-terminal/src/lib/terminalState.ts` +
  `src/hooks/useSessionStateDetection.ts`:
  `stopped` if the process exited → else `busy` if any byte arrived in the last **600 ms** → else
  classify the last **15 buffer rows** → else keep the previous state. Poll every **500 ms**, one
  global interval for all terminals.
- **The classifier is three ordered rules**, and its documented bias is to guess `idle`:
  1. explicit blocking phrases win immediately — `Do you want to proceed?`,
     `Do you trust the files in this folder?`, `(y/n)`, `[y/n]`;
  2. if a plain input box is visible (`? for shortcuts`, or a lone `>` line) it is `idle`, even if a
     numbered list from the last response is still on screen;
  3. a selection menu is `waiting` only when **two or more** option lines exist **and** one carries the
     `❯` cursor — the cursor is what separates a live picker from a finished response.
  *"A missed prompt is a minor annoyance; a false 'needs attention' alarm erodes trust in the whole
  feature."*
- **The activity clock is deliberately not in the state store.** `markTerminalActive(id)` writes into a
  module-level plain `Map` because the output handler runs thousands of times per second on streaming
  chunks and a store write would re-render on every one.
- **Notifications need four gates**, all present in the reference: rising edge only
  (`prev !== 'waiting'`), not the focused active pane, not inside a do-not-disturb window, and
  one-notification-per-waiting-episode with re-arm on exit.
- **`translateToString(true)`** is what makes this cheap — xterm hands back clean text with no ANSI and
  no trailing whitespace, so the regexes never see escape sequences.
- **SLTerm's notification mechanism has a CLI caller and no owner after phase 3.** `NotifyCommand` is
  declared (`pkg/wshrpc/wshrpctypes.go:122`, payload `:495`, generated clients at `wshclient.go:605` and
  `frontend/app/store/wshclientapi.ts:501`) and **`wsh notify` already calls it** on the host route
  (`cmd/wsh/cmd/wshcmd-notify.go:42`). The `host` route id is
  `frontend/app/store/wshrpcutil-base.ts:17` and its **only** registrant is `initElectronWshrpc`
  (`:121-132`), whose client is `emain/emain-wsh.ts` — which phase 3 deletes. So the owner of this route
  is a **frontend** Tauri client (`initHostWshrpc`), added in phase 3, whose handlers `invoke` into Rust.
  There is no "Rust-side wshrpc handler" to build: `src-tauri/src/` has no websocket, no wsh client and
  no notification plugin, and adding one would put business logic in the shell.
- **Reuse the existing in-app notification surface.** `frontend/app/notification/usenotification.tsx`
  and `atoms.notifications` already exist and are coupled to the Electron bridge at
  `usenotification.tsx:10`. Extend that, rather than standing up a second parallel policy path.
- **The heuristic can only see mounted blocks, and the warm-tab cap is 2.** The classifier reads xterm's
  buffer, and `frontend/app/workspace/workspace.tsx:44-49,57,62,94` renders `TabContent` only for tabs
  inside `mountedTabIds`; a tab outside the warm set has no xterm instance at all. So a long-running
  agent in a cold tab produces no state, no glyph and no notification — the exact case the feature exists
  for. This is a boundary the phase must state and then close, not a detail.
- **`block:jobstatus` is the wrong `stopped` signal for agent blocks.** The claude and codex widgets are
  `"controller": "cmd"` (`pkg/wconfig/defaultconfig/widgets.json:19,33`), and jobs exist only for durable
  *shell* blocks (`pkg/blockcontroller/blockcontroller.go:177`). The event is published by
  `pkg/jobcontroller/jobcontroller.go:221`. The signal that already reports an agent's exit is the
  controller runtime status — `BlockService.GetControllerStatus` feeding `shellProcFullStatus` in
  `frontend/app/view/term/term-model.ts:219,364,374`.
- **Today's only "needs input" signal is the terminal bell.** `termwrap.ts:209-224` sets a tab
  indicator on BEL. It fires for any program, is tab-scoped rather than block-scoped, and requires the
  agent to emit BEL at all. It reaches the shell over the same `host` route, so it breaks with `emain/`
  unless phase 3's replacement lands.
- **The heuristic's known failure mode is documented by the category leader.** Orca infers state from
  OSC titles plus agent hooks and still has an open bug where slow agent startup false-positives idle
  and loses an injected dispatch. Prefer an explicit signal (OSC title, or an agent hook) when one is
  available and treat the text heuristic as the fallback, not the primary.
- **The patterns are English-only and track Claude Code's TUI.** The reference keeps
  `WAITING_PATTERNS` exported specifically so it is tunable when the TUI changes. Put it in config, not
  in a compiled constant.
- **`cmd:interactive` and `cmd:login` are dead meta keys.** The `claude` and `codex` widgets both set
  them (`pkg/wconfig/defaultconfig/widgets.json:15-46`); they are declared in
  `pkg/waveobj/metaconsts.go:42-43` and read by no Go code. An agent-aware block needs a real marker,
  so either wire these or add one.
- **A hand-launched agent is a real case the marker design excludes.** Typing `claude` in an ordinary
  terminal block gives it no agent meta, so no glyph and no notification; and phase 5's resume flags and
  OTEL env go through `createCmdStrAndOpts`, which `pkg/blockcontroller/shellcontroller.go:425-431` calls
  only on the `BlockController_Cmd` branch — the shell branch at `:415-424` never sees it. This phase must
  decide the boundary explicitly rather than leave it to be discovered.

## Requirements

**Functional**

- Every block running an agent carries a state glyph: working, waiting, done, blocked, idle, stopped.
- For a block whose tab is **not** mounted (the warm-tab cap defaults to 2), state comes from an explicit
  signal and the last known state persists; where no explicit signal exists, the guarantee is scoped to
  mounted blocks and stated in the UI.
- The glyph appears on the block header and on the tab that contains it, so a background tab still
  shows that something needs attention.
- Entering `waiting` raises exactly one OS notification, unless the user is already looking at that
  pane or is inside a do-not-disturb window.
- The waiting patterns are user-editable configuration, not compiled constants.
- A plain shell block is not an agent block and shows no glyph.

**Non-functional**

- The output path takes no new per-chunk store write.
- One poller for the whole app, not one per block.
- The classifier is unit-tested against captured Claude Code and Codex screens, including a numbered
  list that must classify as `idle`.
- False `waiting` is treated as worse than missed `waiting`; the tests encode that bias.

## Architecture

```
frontend/app/store/agent-state.ts        classifier (ported), state enum, config-driven patterns
frontend/app/store/agent-activity.ts     module-level Map: markActive(blockId) / getLastOutputAt
frontend/app/store/agent-poller.ts       one 500ms interval; reads term buffers, writes states
frontend/app/element/state-dot.tsx       glyph + tooltip table
frontend/app/notification/agent-notify.ts  4-gate policy, layered on the existing usenotification surface
frontend/app/store/wshrpcutil-base.ts    host-route handlers (added in phase 3) gain notify
src-tauri/src/notify.rs                  native toast via tauri-plugin-notification, no policy
```

State source, in priority order:

1. **explicit** — an OSC title the agent sets, or an agent hook writing a marker file. Trusted, and the
   **only** source that works for a block whose tab is not mounted.
2. **process** — the controller runtime status (`BlockService.GetControllerStatus` →
   `shellProcFullStatus`, `term-model.ts:219,364,374`) → `stopped`. `block:jobstatus`
   (`pkg/jobcontroller/jobcontroller.go:221`) applies only to durable shell blocks, not to the
   `controller: cmd` agent widgets.
3. **activity** — a byte within 600 ms → `working`.
4. **text heuristic** — the classifier over the last 15 rows. Fallback only, and mounted blocks only.

Cold blocks: the last known state is persisted per block id so a glyph survives unmounting, and the
explicit signals in level 1 keep updating it. If neither an OSC title nor a hook is available for an
agent, the phase's guarantee is scoped to mounted blocks and says so.

Which blocks are agents: a block is agent-aware when its meta marks it so. Wire the existing
`cmd:interactive` / `cmd:login` keys, or add an explicit `agent:kind` meta set by the `claude` and
`codex` widgets. Do not infer from the command string — an agent launched through a wrapper script
would be missed. A block launched by hand (`claude` typed into a shell block) gets a "treat as agent"
action that sets the meta; resume and cost tracking additionally need a respawn, because both are
spawn-time only.

Glyph vocabulary, copied from the category leader so muscle memory transfers: spinner = working,
amber `?` = waiting on you, emerald dot = done, red = blocked/failed, grey = idle, no glyph = plain
shell.

## Related Code Files

- Create: `frontend/app/store/agent-state.ts`, `agent-activity.ts`, `agent-poller.ts`
- Create: `frontend/app/element/state-dot.tsx`, `frontend/app/notification/agent-notify.ts`
- Create: `src-tauri/src/notify.rs`; add `tauri-plugin-notification` to `src-tauri/Cargo.toml` and its
  permission to `capabilities/default.json`
- Modify: `frontend/app/store/wshrpcutil-base.ts` (the phase-3 `host`-route client gains a notify handler)
- Modify: `frontend/app/notification/usenotification.tsx` (drop the `getApi()` coupling at `:10`, reuse
  `atoms.notifications` as the in-app surface)
- Modify: `frontend/app/view/term/termwrap.ts` (call `markActive` on data; keep the BEL indicator)
- Modify: `frontend/app/view/term/osc-handlers.ts` (OSC-title state signal)
- Modify: `frontend/app/block/blockframe.tsx` (glyph in the header), `frontend/app/tab/tab.tsx`
  (glyph on the tab)
- Modify: `frontend/app/store/global.ts` (state atoms, persisted last-known state), `frontend/wave.ts`
  (mount the poller once)
- Modify: `pkg/wconfig/defaultconfig/settings.json` (`agent:*` keys: patterns, poll interval, DnD, sound)
- Modify: `pkg/wconfig/defaultconfig/widgets.json` (agent marker on the claude/codex widgets)
- Reference (read-only): `/home/stackops/saly/claude-terminal/src/lib/terminalState.ts`,
  `src/lib/terminalActivity.ts`, `src/lib/notificationGate.ts`, `src/components/StateDot.tsx`,
  `src/hooks/useSessionStateDetection.ts`, `src/hooks/useNotification.ts`,
  `docs/superpowers/specs/2026-06-01-session-state-smart-notifications-design.md`

## Implementation Steps

1. **4.1 Mark agent blocks, and decide the hand-launch boundary.** Choose between wiring
   `cmd:interactive`/`cmd:login` and adding an explicit `agent:kind` meta; set it on the `claude` and
   `codex` widgets. Then decide and write down what happens for `claude` typed into a plain shell block:
   ship a "treat this block as an agent" action that sets the meta (state and notifications work
   immediately; resume and cost need a respawn because both are spawn-time only), or add runtime
   detection via an OSC title. Do not leave this to be discovered in phase 5.
2. **4.2 Activity clock.** `markActive(blockId)` from the terminal data path into a module-level `Map`.
   Do not route it through jotai — the reference documents this as the specific mistake to avoid.
3. **4.3 Classifier.** Port `classifySettled` with its three ordered rules and its idle bias. Move
   `WAITING_PATTERNS` into settings so it survives a Claude Code TUI change without a release. Unit-test
   with captured screens: a `(y/n)` prompt, a `❯ 1./2.` picker, a finished numbered list (must be
   `idle`), an input box with a list above it (must be `idle`), and one CJK plus one Vietnamese screen.
4. **4.4 Poller.** One 500 ms interval mounted once. Per agent block: stopped from the controller
   runtime status → working (600 ms activity window) → classify last 15 rows via
   `translateToString(true)` → else keep previous. Skip non-agent blocks. Persist the last computed
   state per block id so it survives unmounting.
5. **4.5 Explicit signals, and the cold-block path.** Add an OSC title handler (`osc-handlers.ts`
   already exists for OSC work) so an agent that reports its own state overrides the heuristic, and where
   Claude Code hooks are available let a hook write the state. This is also the only source that works for
   a block outside the warm-tab set (`window:maxtabcachesize` defaults to **2**), so it is what closes the
   background-agent gap rather than an optimisation. If no explicit signal is available for an agent,
   scope the guarantee to mounted blocks in the requirements and say so in the UI tooltip.
6. **4.6 Glyphs.** `state-dot.tsx` with the tooltip table. Render in the block header and, aggregated,
   on the tab: a tab shows the most urgent state among its blocks (waiting > blocked > working > done).
7. **4.7 Notifications.** Four gates, then the phase-3 `host`-route client's notify handler `invoke`s
   `src-tauri/src/notify.rs` (`tauri-plugin-notification`). Policy — DnD window, sound, per-episode
   dedupe — lives in the frontend and Go config; Rust only shows the toast. Support the overnight DnD case
   (start > end). Layer this on the existing `usenotification.tsx` / `atoms.notifications` surface rather
   than a second parallel path.
8. **4.8 Settings.** `agent:pollintervalms`, `agent:busywindowms`, `agent:waitingpatterns`,
   `agent:notify`, `agent:notifysound`, `agent:dndstart`, `agent:dndend`. Defaults matching the
   reference: 500, 600, the four patterns, on, on, unset, unset.

## Todo

- [ ] 4.1 Agent-block marker wired; hand-launch boundary decided and written down
- [ ] 4.2 Activity `Map` fed from the terminal data path, no store churn
- [ ] 4.3 Classifier ported + unit tests including the two idle-bias cases
- [ ] 4.4 Single 500 ms poller with the four-level priority; last state persisted per block
- [ ] 4.5 OSC-title / hook override ahead of the heuristic, and as the cold-block path
- [ ] 4.6 Glyph on block header and tab, with tab aggregation
- [ ] 4.7 Notify handler on the phase-3 host route + `tauri-plugin-notification`; four gates; DnD incl.
      overnight; layered on the existing notification surface
- [ ] 4.8 `agent:*` settings with defaults

## Success Criteria

- [ ] Start `claude` in a block, ask it something long: the glyph shows working, then done
- [ ] Trigger a permission prompt: the glyph goes amber and one notification fires
- [ ] Keep the pane focused: the same transition fires **no** notification
- [ ] A finished response containing a numbered list classifies as idle, not waiting
- [ ] A plain shell block never shows a glyph
- [ ] Switching to another tab still shows that a background agent is waiting, including after that tab
      falls out of the warm set (or, if no explicit signal is available, the limitation is documented and
      the tooltip says so)
- [ ] Editing `agent:waitingpatterns` changes behaviour without a rebuild
- [ ] `wsh notify "title" "body"` from a shell raises a toast (it does not today)
- [ ] `claude` typed into a plain shell block can be promoted to an agent block and then shows a glyph
- [ ] The terminal output path shows no measurable regression with 10 streaming blocks

## Risk Assessment

- **Heuristic drift.** The patterns match Claude Code's current TUI; a redesign breaks them silently
  and the app quietly stops noticing prompts. *Signal:* waiting never fires while prompts clearly appear.
  *Response:* patterns are configuration, and step 4.5's explicit signals mean the heuristic is not the
  only source. Revisit when a Claude Code release changes the prompt UI.
- **False positives destroy trust faster than false negatives earn it.** *Signal:* users report
  notifications for agents that were not waiting. *Response:* tighten toward idle — the two-option +
  cursor rule exists precisely for this, and the tests encode it.
- **Notification spam across many blocks.** Ten agents finishing together is ten toasts.
  *Response:* per-episode dedupe plus a coalescing window; if it still annoys, aggregate to
  "3 agents need input" — decide from real use, not up front.
- **Poller cost with many blocks.** 500 ms × N buffer reads of 15 rows. *Signal:* input latency with
  20+ blocks. *Response:* the warm-tab cap already bounds how many blocks have a buffer at all; skip
  blocks whose activity timestamp shows nothing changed since the last classification. Note this bound is
  also the coverage gap in the row above — it is a limit, not only a mitigation.
- **`translateToString` behaviour on wide/CJK glyphs is unverified for the pattern set.**
  *Response:* include a CJK and a Vietnamese screen in the classifier tests; the terminal's IME
  correctness is a stated product guarantee elsewhere in this plan.

## Security Considerations

- Notification bodies are built from terminal content. Truncate hard, strip control characters, and
  never include buffer text verbatim in a toast — a hostile repository can print a convincing
  notification body.
- The Rust notify command must not accept arbitrary formatting or file paths from the frontend beyond
  a title and a body string.
- OSC sequences are attacker-controllable by anything running in the PTY. Treat an OSC-reported state
  as a hint about a block the user already trusts, never as authority for an action.

## Next Steps

Phase 5 (session layer) hangs its cost/token HUD and resume UI off these states. Phase 7's agent board
is a second view over the same atoms — build it there, not here.

