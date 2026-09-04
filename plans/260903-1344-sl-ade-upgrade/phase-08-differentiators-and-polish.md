---
phase: 8
title: "Phase 8: Differentiators and polish"
status: todo
priority: P2
effort: "2-3w"
dependencies: [1, 4]
---

# Phase 8: Differentiators and polish

## Overview

Finish the three things that are SLTerm's own rather than borrowed: the pet, user-configurable
keybindings, and a terminal that gets Vietnamese and CJK input right. Each is currently half-wired — the
pet's Go engine ticks state nobody reads, keybindings are hardcoded closures, and IME correctness is an
untested property. None of these come from the reference app; they are the reasons to keep SLTerm as the
base instead of starting from claude-terminal.

## Key Insights

**Pet — two divergent models of the same animal.**

- `pet-controller.syncState` deliberately skips `petInstanceAtom` ("pet selection is local", "session
  data is read-only"), so the Go engine's XP / mood / hunger ticking runs orphaned — nobody reads it.
- `PetAddXPCommand` has a server implementation (`pkg/wshrpc/wshserver/wshserver_pet.go:84`) and
  generated clients on both sides, and **no caller**. `SessionTracker.OnCommand` / `OnActivity`
  (`pkg/petengine/session.go:64,77`) likewise have none, so the visible XP bar effectively never advances.
- Coins, inventory, XP and the selected pet are plain jotai atoms → they reset on every reload.
- Hunger and energy never decay in the backend, so the care loop cannot progress there either.
- The ACTIVE / IDLE / SLEEPING labels shown in the UI reflect nothing the engine computes.
- Sprites load from the network: animated sheets from `play.pokemonshowdown.com`
  (`frontend/app/view/pet/pet-overlay.tsx:31-33`) and item icons from `raw.githubusercontent.com`
  (`pet-model.ts:229`) → blank offline or when rate-limited. The local PNG set was already downscaled and
  WebP'd during the size work (4.05 MB → 439 KB); bundle what the pet actually needs and drop the fetches.
- Terminal reactions hang off a `.xterm-rows` MutationObserver — fragile and wasteful. Move to the PTY
  data stream, and note the consequence: reactions then see raw ANSI, so the regex table needs stripping
  applied first.
- Keep what works: the rAF movement loop, the throw physics (`GRAVITY=1200`, `FRICTION=0.98`,
  `BOUNCE=0.5`), and the mood-weighted behaviour selection.
- The user authorised rebuilding this from scratch with Go as the source of truth and local state reset.
- **No competitor in the surveyed category has any personality layer.** Binding pet XP to agent lifecycle
  events (a task finished, a review merged) is near-zero cost and makes the "needs you" state emotionally
  legible. Whether that reads as unserious to a professional audience is a real question — hence a
  default-off decision recorded below rather than assumed.

**Keybindings — no override mechanism at all.**

- `registerGlobalKeys()` hardcodes ~25 bindings; there is no `keybindings.json`, no config key, no editor.
  The only knobs are two booleans (`app:disablectrlshiftarrows`, `app:disablectrlshiftdisplay`).
- The command registry from phase 1 is the prerequisite and it will already exist.
- The existing `parseKeyDescription` grammar is good and should be reused: `Cmd:Shift:d`, physical codes
  like `c{Digit1}`, `+` for chord segments.
- Keep the platform abstraction (`Cmd` → Meta on macOS, Alt elsewhere) but **document it in the UI** — the
  same binding string means different physical keys per OS, which becomes confusing the moment users can
  edit it.
- The category leader persists user bindings to `~/.orca/keybindings.json` and its defaults are worth
  matching where they do not clash: `Ctrl+Shift+[`/`]` cycle all tabs, `Ctrl+Alt+[`/`]` same type,
  `Ctrl+Tab` most recent, `Ctrl+J` quick open.

**Theme and background robustness.**

- Custom-versus-builtin classification relies on `display:order` threshold conventions (`<50` builtin,
  `>=100` deletable, `200+` custom colour) plus key prefixes (`bg@custom-`, `custom-`). Hand-editing
  `display:order` can make a theme undeletable. Replace with an explicit `builtin` flag.
- Malformed custom theme JSON currently degrades to `{}` silently.

**IME correctness is a stated product guarantee elsewhere in this plan.**

- The category leader carries an IME regression checklist and live bugs on duplicated CJK text and broken
  image paste into TUIs. This is an open field, and it matters directly for a Vietnamese-authored product.
- Phase 4's classifier already has to ignore `keydown` while composing; the tests belong here.

## Requirements

**Functional**

- One pet per app, its XP / coins / inventory / selection owned by Go and surviving a restart.
- XP advances from real activity: shell commands and agent lifecycle events.
- Hunger and energy decay so the care loop progresses; the UI labels reflect what the engine computes.
- Sprites render with the network disabled.
- A user can rebind any registered command in `keybindings.json`, restart, and have it take effect;
  conflicts are reported rather than silently last-wins.
- The cheatsheet shows live bindings, including user overrides.
- A malformed custom theme produces a visible error instead of an empty object.
- Vietnamese and CJK composition in the terminal produce exactly the typed text, once.

**Non-functional**

- The Go pet engine is the only source of truth; the frontend holds no authoritative pet state.
- Reaction matching runs on ANSI-stripped text, not raw PTY bytes.
- Pet state reset is announced in release notes, not discovered.
- Agent→pet binding defaults off.

## Architecture

```
pkg/petengine            sole source of truth: XP, coins, inventory, selection, mood, decay
  decay.go               NEW hunger/energy decay on a tick
  tracker.go             OnCommand / OnActivity finally called
pkg/blockcontroller      calls SessionTracker on the command path; emits agent lifecycle events
frontend/app/view/pet    consumes PetGetState / PetGetProfile; local atoms deleted
  pet-selector.tsx       NEW real selector (the old one was a placeholder, deleted in the prior plan)
  reactions.ts           PTY-stream driven, ANSI-stripped, table from config
frontend/app/store/keybindings.ts   keybindings.json layered over registry defaults + conflict check
frontend/app/view/waveconfig        keybinding editor surface; explicit `builtin` flag on themes/bgs
```

Pet XP sources, all opt-in per source: shell command executed, agent entered `done`, review committed,
worktree merged. The binding to agent events is a setting (`pet:agentevents`) defaulting to **off** — it
is the one part of this that could read as unserious in a professional context, and that should be the
user's choice rather than a default.

## Related Code Files

- Modify: `pkg/petengine/*` (+ `decay.go`), `pkg/blockcontroller/shellcontroller.go` (tracker calls)
- Modify: `pkg/wshrpc/wshrpctypes.go` if the pet needs an event-ingest command; `task generate`
- Modify: `frontend/app/view/pet/*` (drop local authoritative atoms, delete the duplicate dialogue pool
  in `pet-controller.ts`, keep `pkg/petengine/dialogue.go` as the single source)
- Create: `frontend/app/view/pet/pet-selector.tsx`, `frontend/app/store/keybindings.ts`
- Modify: `frontend/app/store/keymodel.ts` (layer user bindings over the phase-1 registry)
- Modify: `pkg/wconfig/*` (`pet:*` keys incl. `pet:agentevents`; keybinding file schema; `builtin` flag
  on themes and backgrounds; validation on write)
- Modify: `frontend/app/view/waveconfig/theme-picker.tsx`, `background-picker.tsx` (builtin flag)
- Modify: `frontend/app/view/term/termwrap.ts` (reaction hook on the data stream)
- Bundle: pet sprite assets locally (already optimised during the size work)

## Implementation Steps

1. **8.1 Pet: single owner.** Delete the frontend's authoritative atoms; read `PetGetState` /
   `PetGetProfile`. Announce the state reset in the release notes for whichever version ships it.
2. **8.2 Pet: real progression.** Call `SessionTracker.OnCommand` / `OnActivity` from the shell command
   path. Add decay so hunger and energy move. Make the UI's state labels render what the engine reports.
3. **8.3 Pet: assets and dialogue.** Bundle sprites locally; delete the duplicate dialogue pool and keep
   the Go one; ship the real selector.
4. **8.4 Pet: reactions.** Move off the MutationObserver onto the PTY data stream, strip ANSI before
   matching, and externalise the reaction table to config.
5. **8.5 Pet: agent events.** Bind XP to agent lifecycle events behind `pet:agentevents`, default off.
6. **8.6 Keybindings.** `keybindings.json` layered over the registry, conflict validation on load,
   platform-mapping note in the UI, and the cheatsheet driven from the merged result. Adopt the
   category's default chords where they do not clash with existing ones.
7. **8.7 Theme robustness.** Explicit `builtin` flag replacing the `display:order` conventions; schema
   validation on write with a visible error on failure.
8. **8.8 IME regression tests.** Vietnamese (telex and VNI where the OS provides them) and CJK
   composition into a shell and into a TUI, plus image paste into a TUI. Write them as a checklist that
   runs at release time, since composition needs a real input method.

## Todo

- [ ] 8.1 Go owns pet state; frontend atoms removed; reset announced
- [ ] 8.2 XP from real commands; hunger/energy decay; honest state labels
- [ ] 8.3 Local sprites, single dialogue source, real pet selector
- [ ] 8.4 Reactions on the PTY stream with ANSI stripped, table in config
- [ ] 8.5 Agent-event XP behind `pet:agentevents` (default off)
- [ ] 8.6 `keybindings.json` with conflict validation and a live cheatsheet
- [ ] 8.7 `builtin` flag + theme/background schema validation
- [ ] 8.8 IME + TUI paste checklist, run and recorded

## Success Criteria

- [ ] Pet XP, coins and inventory survive a full restart and advance from real shell commands
- [ ] One pet per app, not one per block
- [ ] Sprites render with networking disabled
- [ ] Hunger and energy visibly change over time and feeding them matters
- [ ] Rebinding a shortcut in `keybindings.json` takes effect after restart; a duplicate binding is
      reported by name
- [ ] The cheatsheet matches live bindings including overrides
- [ ] A malformed custom theme shows an error naming the file and the problem
- [ ] Typing Vietnamese with telex into a shell prompt and into a TUI produces the exact text, once
- [ ] No UI element implies a feature that does not exist

## Risk Assessment

- **The pet rewrite has a user-visible cost** — a state reset. Already accepted by the owner; the risk is
  shipping it silently. *Response:* release notes, and a one-time in-app notice if the old atoms are found.
- **Reaction source change sees raw ANSI.** *Signal:* reactions fire on escape sequences, or stop firing.
  *Response:* strip before matching, and unit-test the table against a captured colourised prompt.
- **Keybinding refactor is broad and shallow** — it touches every action site and missing one silently
  drops a binding. *Mitigation:* drive it from the exported registry so any unregistered action is
  detectable; assert every registry id resolves to exactly one binding after merge.
- **Platform key mapping will confuse users** once bindings are editable, because the same string means
  different physical keys. *Response:* show the resolved physical chord for the current OS next to the
  binding string in the editor.
- **IME cannot be tested in CI.** *Signal:* an IME regression ships. *Response:* accept it as a release
  checklist item rather than pretending it is automated, and keep the checklist short enough to actually
  run.
- **Agent→pet binding could undercut the product's credibility** with the audience an ADE targets.
  *Response:* default off, and keep the pet a separate view rather than putting it in the titlebar.

## Security Considerations

- Bundled sprite assets remove two remote fetches from the startup path — a supply-chain and
  offline-availability improvement, not just a size one.
- `keybindings.json` is user-authored config: validate it, never `eval` it, and map ids to handlers
  through the registry so a malformed file cannot invoke arbitrary code.
- Theme and background JSON are also user-authored and reach CSS; validate against a schema and reject
  unknown properties rather than passing values through.
- The reaction table is config-driven regex over terminal output — bound its size and compile with a
  timeout guard so a pathological pattern cannot stall the render loop.

## Next Steps

Nothing depends on this phase. Phase 9 finishes the rebrand and can run before, after or alongside it.

