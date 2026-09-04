---
phase: 7
title: "Phase 7: ADE workspace UX"
status: todo
priority: P2
effort: "3-4w"
dependencies: [1, 4, 5, 6]
---

# Phase 7: ADE workspace UX

## Overview

Assemble the pieces from phases 4-6 into the workflow the category has converged on: a workspace is a
git worktree, agents run one per worktree, a board shows every agent's state across worktrees, and one
palette reaches every command, file, session and worktree. This is where SLTerm stops being a terminal
that can run agents and becomes an environment for supervising them.

SLTerm starts from an unusual advantage here: its block/tab/workspace tiling model is already a superset
of what the leading product calls tab groups and pane trees, and it already ships both a terminal and a
Monaco editor — the exact combination whose absence generates the category leader's top feature requests.

## Key Insights

- **Workspaces are currently tab groups with no project identity.** `waveobj.Workspace`
  (`pkg/waveobj/wtype.go`) carries `OID`, `Name`, `Icon`, `Color`, `TabIds`, `ActiveTabId` and a
  `Meta MetaMapType` — no root, cwd or repo field, but the `Meta` map means the worktree binding is a new
  meta key rather than a schema change. Additive either way.
- **The layout persistence to match is "switching worktrees swaps the entire pane tree"** — browser tab,
  terminal and diff all reappear exactly as they were. SLTerm persists block trees per tab already; the
  missing link is the worktree binding, not the persistence.
- **Pane boundaries should be pinned and persisted**, so a window resize never reshuffles the layout.
  The category leader calls this out as deliberate design, and it is the difference between a layout you
  trust and one you keep repairing.
- **There is no action registry to search.** Every global action is an anonymous closure in
  `globalKeyMap` (`frontend/app/store/keymodel.ts:396-566`) with no id and no label — which is why
  `view:launcher` can only search *widgets to open*. Phase 1 introduces the registry; this phase is its
  first real payoff.
- **The fuzzy matcher already exists in Go.** `pkg/suggestion` implements `FuzzyMatchV2`
  (`suggestion.go:221,232,409`) and already backs the file-path typeahead in the preview view. The
  palette should call it rather than adding a JS fuzzy library.
- **The agent board is an extension of an existing view, not a new one.** `view:agentteams` plus
  `AgentTeamsGetSnapshot` / `AgentTeamsGetTasks` already read `~/.claude/teams` and `~/.claude/tasks`
  and render a roster with status and `blockedBy`. The board adds columns, filters and click-to-focus
  over the phase-4 states.
- **Ship the board on by default.** The category leader flag-gated its equivalent behind an experimental
  setting with no keybinding, and a third party shipped a separate viewer just to see the data it was
  already collecting. That is a mistake with a documented outcome.
- **Tear-off must be built in Rust, not from JS, and that is a security constraint rather than a
  preference.** A window created with `new WebviewWindow` cannot carry an initialization script by design,
  and SLTerm's window is unusable without one — the script carries the wavesrv endpoints and the auth key
  (`lib.rs:195-208`, key at `host.rs:27`, re-exported by `tauri-host.ts:128`). The tempting fix, a local
  plugin whose `js_init_script` injects the handshake into *every* webview, combined with granting the
  renderer `core:webview:allow-create-webview-window`, would let any JS in the main frame open a window at
  an arbitrary URL and have the auth key injected into it. Because `pkg/web/ws.go:65` is
  `CheckOrigin: return true` and the key is accepted as a query parameter, that key alone is the whole
  wshrpc surface — block and shell control, i.e. RCE. **So: one narrow Rust command,
  `host_tear_off_tab(tab_id)`, builds the window with a fixed `WebviewUrl::App("index.html")` and attaches
  the init script at construction — exactly the mechanism `lib.rs` already uses for `main`.** No
  webview-creation permission is granted to the renderer, and no plugin injects into windows the app did
  not construct.
- **Harden the WS endpoint in the same phase.** Validate `Origin` against the shell origins the server
  already knows (`shellWebviewOrigins`, `pkg/web/web.go:510-515`) and prefer the header over the query
  parameter, so a leaked key is not by itself sufficient.
- **Tear-off is still cheaper here than in the reference.** There, terminal state lived in per-window
  stores and PTYs in Rust, so a transfer protocol was necessary. In SLTerm, blocks and tabs live in the Go
  backend and the frontend is just a client of the WS endpoint — a torn-off window is a second client
  pointed at a different tab id. **UNVERIFIED and gating:** whether `wavesrv` tolerates two simultaneous
  frontend clients on the same workspace.
- **Three tear-off traps, all with known answers:** capabilities match on window **label**, so
  `["main"]` silently denies every IPC call from a detached window (`["main", "detached-*"]`);
  `on_window_event` fires for every window, so closing a detached one runs the app-shutdown path unless
  guarded by label; and window options are **logical** pixels while a cursor position is **physical**,
  so passing cursor coordinates as options misplaces the window by the display scale factor.
- **`dragDropEnabled` (default true) conflicts with HTML5 drag-and-drop on Windows.** Disabling it to
  get HTML5 DnD would kill Tauri's file-drop events, which the files view wants. Use pointer-event
  dragging plus a separate always-on-top preview window, and leave the default alone.
- **Tab pinning can be done properly here.** The reference's pins do not survive a restart because
  restored terminals get fresh UUIDs; SLTerm has persistent object ids, so pins can be durable.
- **Per-hunk accept/reject is the best-in-class review model**, and the differentiator nobody but the
  category leader has is routing a comment on a diff line back into the agent's prompt.

## Requirements

**Functional**

- A workspace can be bound to a git worktree; switching workspaces swaps the whole block tree and every
  block's cwd follows.
- One palette (single chord) searches commands, files, open blocks, sessions and worktrees.
- An agent board lists every agent across worktrees in Needs You / Working / Done / Idle columns, with
  project and PR-state filters, and clicking a card focuses that agent's block.
- Agents are launched from a registry with per-agent arguments and an optional model / effort override,
  not from hardcoded widget entries.
- A tab can be torn off into its own window and dragged back.
- Pinned tabs survive a restart.
- A diff hunk can be accepted or rejected individually, and a comment on a diff line can be sent to the
  agent that made the change.

**Non-functional**

- The board is on by default with a keybinding, not behind an experimental flag.
- Pane boundaries persist; a window resize never reshuffles the layout.
- No new fuzzy-matching dependency; the palette uses `pkg/suggestion`.
- File drop keeps working (`dragDropEnabled` stays at its default).

## Architecture

```
pkg/waveobj              Workspace worktree binding as a new Meta key (no schema change)
pkg/wcore/workspace.go   bind / rebind / clear, and cwd propagation to new blocks
pkg/suggestion           reused for palette scoring; new sources: commands, sessions, worktrees
src-tauri/src/teardown.rs    host_tear_off_tab(tab_id): builds a detached window in Rust with the
                             init script attached at construction (no JS-created webviews)
frontend/app/palette/    palette.tsx + sources/{commands,files,blocks,sessions,worktrees}.ts
frontend/app/view/agentteams/  extended into the board: columns, filters, cards, click-to-focus
frontend/app/store/agent-registry.ts   agent definitions, launch args, model/effort override
frontend/app/tab/teardown/  pointer-drag tear-off, label conventions, drop routing
frontend/app/view/vcs/review.tsx  per-hunk accept/reject + comment→agent
```

The palette is a thin UI over sources: each source returns `{id, label, detail, run}` and the Go matcher
ranks them. Commands come from the phase-1 registry, so anything registered is searchable for free.

Comment-to-agent routing: a comment on a hunk becomes text written into the owning agent's PTY, prefixed
with the file and line. No new protocol — the agent is a terminal program and the terminal is the channel.
**Both halves of that text are untrusted**: the user's comment, and the git-derived file path (phase 6
returns `-z` output precisely so a name containing CR, LF or ESC arrives intact rather than pre-broken).
Everything written to a PTY goes through phase 6's `sanitize.go` — drop C0/C1 and ESC, never emit CR or LF,
cap length — the preview shows the sanitised bytes with control characters escaped visibly, and submission
happens on an explicit keypress rather than by appending a newline.

## Related Code Files

- Create: `src-tauri/src/teardown.rs` (`host_tear_off_tab`, window built in Rust)
- Create: `frontend/app/palette/palette.tsx` + `sources/*.ts`
- Create: `frontend/app/store/agent-registry.ts`
- Create: `frontend/app/tab/teardown/{tear-off.ts,drop-routing.ts,drag-preview.tsx}`
- Create: `frontend/app/view/vcs/review.tsx`
- Modify: `src-tauri/src/lib.rs` (register `host_tear_off_tab`; extract the init-script builder so both
  `main` and detached windows share it; guard `on_window_event` by label)
- Modify: `src-tauri/capabilities/default.json` (`windows: ["main", "detached-*"]`; **do not** add
  `core:webview:allow-create-webview-window`)
- Modify: `pkg/web/ws.go:65` (validate `Origin` against `shellWebviewOrigins`), `pkg/web/web.go` and
  `frontend/util/endpoints.ts` (prefer the auth-key header over the query parameter)
- Modify: `pkg/waveobj/wtype.go`, `pkg/wcore/workspace.go`, `pkg/wshrpc/wshrpctypes.go` (+`task generate`)
- Modify: `frontend/app/view/agentteams/agentteams.tsx` (board), `frontend/app/tab/tabbar.tsx` (pins,
  drag), `frontend/app/view/launcher/launcher.tsx` (fold into the palette or keep as the widget grid)
- Modify: `frontend/layout/*` (pin pane boundaries), `pkg/wconfig/defaultconfig/settings.json`
- Reference (read-only): `/home/stackops/saly/claude-terminal/src/lib/{windowMode,windowLayout,tabTransfer}.ts`,
  `src/hooks/useTabDrag.tsx`, `src/components/{CommandPalette,GlobalSearchModal,OrchestrationPanel}.tsx`,
  `src-tauri/src/main.rs:250-297` (per-window lifecycle guards)

## Implementation Steps

1. **7.1 Verify the multi-client premise.** Before any tear-off work: confirm `wavesrv` accepts two
   simultaneous frontend clients on one workspace. If it does not, tear-off needs a Go change and should
   move to its own phase — decide before building UI on top of it.
2. **7.2 Worktree-bound workspaces.** Add the binding meta key, propagate the root to new blocks' cwd, and
   make a workspace switch restore that worktree's block tree. Pin pane boundaries while in the layout
   code.
3. **7.3 Palette.** One chord, five sources, Go-side ranking. Commands from the phase-1 registry; files
   from the existing suggestion path; sessions from phase 5; worktrees from phase 6; open blocks from the
   layout model. Adopt the category's default chords so muscle memory transfers.
4. **7.4 Agent registry.** Generalise the `claude` / `codex` widget entries into a registry with launch
   args and optional model/effort overrides, and record what was requested versus what the agent actually
   started with — a receipt is what makes an override debuggable.
5. **7.5 Agent board.** Extend `view:agentteams`: four columns over the phase-4 states, filters for
   project and PR state, cards showing agent, worktree, age, last line and cost, click to focus the block,
   nested subagents as expandable children. Default-on, with a keybinding.
6. **7.6 Tear-off.** `host_tear_off_tab` in Rust first — fixed app URL, init script attached at
   construction, no webview-creation permission for the renderer — then the label conventions
   (`detached-<n>`, stable so window state does not accumulate dead entries), the capability label glob,
   the `on_window_event` label guard, pointer-event dragging with a preview window, and drop routing by
   hit-testing physical cursor position against each window's outer rect. Remember logical-vs-physical
   units when positioning. Land the `Origin` check and header-preferred auth key in the same phase.
7. **7.7 Pins.** Pin on the persistent object id so pins survive a restart.
8. **7.8 Review upgrades.** Per-hunk accept/reject over phase 6's diff, and comment-to-agent routing
   through the owning block's PTY.

## Anti-scope (decided, do not build)

- No cloud VMs, no hosted sandbox fleet, no mobile companion or relay. The relay is a whole subsystem and
  its most common bug reports are Windows pairing failures; SSH and WSL blocks already deliver remote
  work without hosted infrastructure.
- No chat UI as the primary surface. Terminals as blocks are the product's strength.
- No selling inference or credits. Bring-your-own subscription is the model.
- No supervisor/worker orchestration engine in this phase. It is the strongest available differentiator
  and the category leader's own version is still experimental and CLI-only — it deserves its own plan
  after this one lands, not a corner of this phase.

## Todo

- [ ] 7.1 Multi-client premise verified (gates 7.6)
- [ ] 7.2 Workspace ↔ worktree binding, cwd propagation, pinned pane boundaries
- [ ] 7.3 Palette over five sources with Go-side fuzzy ranking
- [ ] 7.4 Agent registry with per-agent args and model/effort override + receipt
- [ ] 7.5 Agent board default-on with columns, filters, click-to-focus, nested subagents
- [ ] 7.6 Rust `host_tear_off_tab`, tear-off, label guards, drop routing, WS `Origin` check
- [ ] 7.7 Durable tab pins on persistent ids
- [ ] 7.8 Per-hunk accept/reject and comment→agent routing

## Success Criteria

- [ ] Create a worktree, bind a workspace to it, switch away and back: the same blocks, same layout, same
      cwds
- [ ] One chord opens the palette; typing a command name, a file name, a session preview or a worktree
      name all reach the right thing
- [ ] Three agents in three worktrees appear on the board in the right columns and clicking one focuses it
- [ ] The board is reachable by keybinding with no setting to enable
- [ ] Launching an agent with a model override records both requested and effective values
- [ ] A torn-off window can run a terminal and talk to the backend; closing it does not quit the app
- [ ] Dropping a tab back into the main window reattaches it
- [ ] Pins survive a restart
- [ ] Accepting one hunk of a three-hunk diff stages only that hunk
- [ ] A comment on a diff line arrives in the agent's terminal with file and line context

## Risk Assessment

- **The multi-client premise may be false.** *Signal:* two clients on one workspace produce duplicated
  events or fight over block state. *Response:* 7.1 is a gate, not a task — if it fails, cut 7.6 from this
  phase and keep everything else, rather than building UI on an unverified backend property.
- **Tear-off has three silent failure modes** (label-scoped capabilities, unguarded window events,
  logical-vs-physical coordinates), each of which looks like an unrelated bug. *Mitigation:* they are named
  in Key Insights with their fixes; add the label guard in the same commit that can create a second window.
- **Any design where JS can create a webview that receives the auth key is an RCE path**, because the WS
  endpoint accepts any Origin and takes the key from the URL. *Signal:* a `create-webview-window` grant or
  an all-webviews init script appearing in a diff. *Response:* windows are built only by
  `host_tear_off_tab` with a fixed app URL; add a test asserting the renderer cannot create a window, and
  one asserting the key is absent from a child frame's scope in the `webview` view.
- **Board scope creep toward orchestration.** A board that shows tasks invites a task engine.
  *Response:* the anti-scope section is explicit; the board reads state, it does not schedule work.
- **Palette becomes a second launcher.** Two overlapping surfaces is worse than one.
  *Response:* decide in 7.3 whether `view:launcher` folds into the palette or stays as the visual widget
  grid; do not ship both doing the same job.
- **Per-hunk staging is fiddly.** Partial-hunk staging via patch application can corrupt a working tree.
  *Response:* build it on `git apply --cached` with a generated patch and verify against the file's hash
  before and after; refuse when the file changed underneath.

## Security Considerations

- The renderer never gets permission to create a webview, and no init script is injected into a webview
  the app did not construct with an app-local URL. The auth key is a full wshrpc credential.
- Scope the capability's window list to `["main", "detached-*"]` — never `["*"]`.
- Validate `Origin` on the WS upgrade and prefer the auth-key header over the query parameter, so a key
  that does leak is not sufficient on its own.
- Comment-to-agent routing writes text into a PTY. Sanitise **both** the user's comment and the
  git-derived path prefix; show the sanitised bytes with control characters visible before sending; submit
  on an explicit keypress, never by appending a newline.
- The board renders last-line previews from terminal output; strip control characters and cap length.
- Worktree paths reaching the palette must pass phase 6's confinement check before any action runs.

## Next Steps

Phase 8 makes SLTerm's own differentiators first-class on top of the registry and states built here. A
supervisor/worker orchestration engine is the natural follow-on plan once this phase is stable.

