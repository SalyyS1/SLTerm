# Phase 6 — SLTerm strengths: pet, keybindings, polish

**Est.** 2-3 weeks · **Runtime-independent** · **Depends on:** Phase 0 (dead code already deleted)

## Goal

Turn SLTerm's own differentiators from half-wired demos into coherent features, before the runtime
swap freezes the codebase. These are the reasons to keep SLTerm as the base rather than starting from
claude-terminal.

## Pet system — single owner rewrite

**User authorized rebuilding from scratch** ("đập đi xây lại cũng được, ngon là được"), and chose Go
as source of truth with current local state reset.

### The problem

Two divergent models of the same pet:

- `pet-controller.syncState` deliberately skips `petInstanceAtom` — comments say "pet selection is
  local", "session data is read-only"
- so the Go engine's XP/mood/hunger ticking runs **orphaned** — nobody reads it
- `PetAddXPCommand` is **never called**, and `SessionTracker.OnCommand`/`OnActivity` have **zero
  callers** → the visible XP bar effectively never advances
- coins, inventory, XP, selected pet are plain jotai atoms → **reset every reload**
- hunger/energy never decay in the backend, so the care loop cannot progress there either
- state labels (ACTIVE/IDLE/SLEEPING) shown in UI reflect nothing the engine computes

### The work

- `pkg/petengine` becomes the **sole** source of truth. Frontend consumes `PetGetState` /
  `PetGetProfile` instead of local-only atoms.
- Wire progression for real: call `SessionTracker.OnCommand`/`OnActivity` from the shell command path
  in `pkg/blockcontroller`.
- Add hunger/energy **decay** in the engine so the care loop actually progresses.
- Single dialogue source: keep `pkg/petengine/dialogue.go` (already RPC-exposed), delete the
  duplicate pool in `pet-controller.ts`.
- Ship the real pet selector (`pet-selector.tsx` was a "Phase 07" placeholder, deleted in Phase 0 —
  rebuild it properly).
- **Bundle sprite assets locally.** Currently loads from `pokemonshowdown.com` and
  `raw.githubusercontent.com` → blank sprites offline or when rate-limited.
- Move terminal reactions off the `.xterm-rows` MutationObserver onto the PTY data stream /
  `onLineFeed`, with the reaction table externalized to config. A DOM observer for this is both
  fragile and wasteful.
- Keep the good parts: the rAF movement loop, throw physics (`GRAVITY=1200`, `FRICTION=0.98`,
  `BOUNCE=0.5`), and `pet-behaviors` mood-weighted random selection.
- **Discord Rich Presence**: `pkg/discordrpc` is log-only stubs while `vibe-settings` implies it
  works. Either implement real IPC or remove the toggle. No UI implying a feature that does not exist.

State reset is accepted and should be **communicated in release notes**, not silent.

## Keybindings — make them user-configurable

Currently **entirely hardcoded** in `registerGlobalKeys()`. No config file, no override mechanism, no
editor UI. The only knobs are two booleans (`app:disablectrlshiftarrows`,
`app:disablectrlshiftdisplay`).

- Command-id indirection layer in `frontend/app/store/keymodel.ts` — this is the refactor that makes
  remapping possible, and it touches every action handler.
- `keybindings.json` layered over defaults, reusing the existing `parseKeyDescription` grammar
  (`Cmd:Shift:d`, `c{Digit1}` physical codes, `+` for chord segments).
- Conflict validation on load.
- Keep the platform abstraction (`Cmd` → Meta on macOS, Alt elsewhere) but **document it in the UI** —
  the same binding string means different physical keys per OS, which will confuse users once they can
  edit bindings.
- Note for Phase 7: Electron menu accelerators (`emain-menu.ts`) and the webview key-reinjection
  bridge (`emain-ipc.ts` + `preload.ts`) are a parallel native layer that must be re-implemented in
  the renderer. Design the command-id layer with that in mind.

## Tabs and layout polish

- Tab pinning on **stable tab OIDs** (claude-terminal's pins do not survive restart because restored
  terminals get fresh UUIDs — SLTerm has persistent OIDs, so it can do better).
- Tab/block tear-off between windows via WaveObj re-parenting.
- Orphaned-block reconciliation: `cleanupOrphanedBlocks` / `BlockService.CleanupOrphanedBlocks` /
  the `cleanuporphaned` action exist because tree leaves and `Tab.BlockIds` **can drift apart**. Make
  this robust rather than incidental, or leaked blocks accumulate.

## Theme / background robustness

- Validate custom theme and background JSON on write (Phase 0 covers the immediate fix; here, add a
  proper schema).
- Replace the brittle custom-vs-builtin classification — it currently relies on `display:order`
  threshold conventions (`<50` builtin, `>=100` deletable, `200+` custom color) and key prefixes
  (`bg@custom-`, `custom-`). Hand-editing `display:order` can make a theme un-deletable. Use an
  explicit `builtin` flag.

## Validation

- Pet XP/coins/inventory survive a full restart and advance from real shell commands.
- One pet per app, not per block.
- Sprites render with the network disabled.
- Rebind a shortcut in `keybindings.json`, restart, verify it takes effect; conflicting bindings are
  reported.
- Cheatsheet matches live bindings (Phase 0 wired the source; verify after the indirection refactor).
- Pins survive restart.
- Malformed custom theme JSON produces a visible error, not a silent `{}`.

## Risk

The keybinding command-id indirection is a broad, shallow refactor — it touches many call sites but
each change is mechanical. The risk is missing one and silently dropping a binding; drive it from the
exported registry so anything unregistered is detectable.

The pet rewrite has a user-facing consequence (state reset) that is already accepted. The subtler
risk is the reaction-source change: moving off the MutationObserver onto the PTY stream means
reactions now see raw ANSI, so the regex table needs stripping applied first.
