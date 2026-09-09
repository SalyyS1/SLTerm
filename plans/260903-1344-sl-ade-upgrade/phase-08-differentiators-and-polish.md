---
phase: 8
title: "Phase 8: Differentiators and polish"
status: todo
priority: P2
effort: "2-3w"
dependencies: [7]
---

# Phase 8: Differentiators and polish

## Overview / dependencies

Finish SL-ADE-specific pet behavior, configurable keybindings, theme robustness, IME/TUI paste and measured responsiveness before autonomous orchestration magnifies defects. Read [architecture contract](./architecture-contract.md). Phase 7 blocker supplies unified registry/provider/workbench. Owner: polish maintainer; exclusive access to shared config/keymodel/terminal/pet files.

## Requirements and architecture

- Go remains authoritative for one app-level pet: selection, XP, coins, inventory, mood/hunger/energy and decay survive restart. Frontend animation is presentation. Existing pet event commands must be reconciled, not duplicated.
- XP sources are real, idempotent domain events keyed by event ID: shell command, verified session turn, review commit, explicit integration. Agent/pet binding default off. A worker claim alone never awards verified completion XP.
- Sprite/item assets local and licensed; offline works. PTY reactions consume a bounded ANSI-decoded **copy** and never alter raw terminal output. User regex/config is validated/bounded off the render loop.
- All commands from existing registry have exactly one resolved binding or explicit unbound status. User overrides validate command IDs and conflicts; cheatsheet/palette/menu display the resolved mapping. Preserve existing bindings by default; don't copy competitor chords over user muscle memory.
- Theme/background has explicit built-in/custom identity and schema validation. Migration derives the flag once from shipped immutable keys, not editable display order. Invalid custom data remains recoverable and produces actionable error.
- Vietnamese Telex/VNI and CJK composition each produce input exactly once in shell and Claude/Codex TUIs. Pasted text/image behavior is tested by target/provider/OS; unsupported image paste says so. Key dispatch ignores composing events.
- Meet performance budget in architecture contract at 1/10/25 tabs and 1/2/4/8 agents; pet, state derivation and reactions can be disabled independently to isolate regressions.

Data flow: backend domain event → dedupe + pet transition in wstore transaction → snapshot → React animation. PTY raw bytes → existing storage/render path and separate bounded decoder → non-authoritative visual reaction. Config load → defaults registry + user overrides → validated one-to-one binding map → menu/palette/cheatsheet.

Existing evidence: command API `frontend/app/store/commands.ts:49,71,87`, key registration `keymodel.ts:665,672-676`; PTY output append `pkg/blockcontroller/shellcontroller.go:565-580`; pet RPC types begin `pkg/wshrpc/wshrpctypes.go:915`; current server/package paths must be reverified before editing. Existing `procutil`/phase-4 event infrastructure is reused.

## File inventory

Existing modify:
- `pkg/petengine/`, its current tests/server adapters, `pkg/blockcontroller/shellcontroller.go`, session/VCS event sources from phases 5–6.
- `frontend/app/view/pet/`, `frontend/app/store/commands.ts`, `keymodel.ts`, app menu/palette/cheatsheet, `frontend/app/view/term/termwrap.ts`.
- `pkg/wconfig/`, defaults/themes/backgrounds and existing pickers; current setting/migration owner.
- `pkg/wshrpc/wshrpctypes.go:915` only if missing additive event contract; generation outputs as architecture contract.
New proposed only where absent: `pkg/petengine/decay.go`, `frontend/app/view/pet/pet-selector.tsx`, `frontend/app/store/keybindings.ts`, focused IME/reaction/keybinding tests. Bundle local pet assets under existing asset convention rather than new remote loader.

## Steps

1. Inventory current Go/frontend pet owners and persistence; define one schema and migration/reset notice. Do not delete old state until rollback path and user-visible migration decision are recorded.
2. Route idempotent event receipts from real command/session/review events; add decay using persisted timestamps and capped catch-up after clock jump/sleep. Verify no duplicate XP on event replay/restart.
3. Move visual reactions from DOM mutation to bounded decoded PTY observer; offline assets/dialogue/select UI. Test ANSI split chunks, repeated lines and binary-like output without raw-stream changes.
4. Layer keybinding config over registry defaults; conflict/reserved/browser/IME validation, atomic save and live cheatsheet. Apply after command registration; unknown future IDs retained but reported.
5. Add explicit built-in identity and validate themes/backgrounds. Migrate known shipped keys; ambiguous custom item remains custom/recoverable.
6. Execute automated composition event tests and manual Windows first, macOS/Linux release checklist in terminal plus Claude/Codex TUI. Test text/image paste, AltGr/dead keys, shortcuts and focus.
7. Benchmark against phase-3 baseline with features toggled. Tune batching/polling/mount cap; do not weaken lossless output or silently change ≤21MB artifact target.

## Test matrix

| Level | Cases | Expected |
|---|---|---|
| Unit | duplicate/out-of-order pet events, restart, clock rollback/30-day sleep | exactly-once XP; bounded decay |
| Unit | binding duplicate/unknown/invalid/chord/platform mapping | named error, defaults preserved |
| Unit | ANSI/UTF-8 split/repeated output/pathological regex | raw bytes unchanged; observer bounded |
| Migration | old pet/theme/background/config | deterministic outcome, backup, no silent loss |
| Integration | command/session/review event to pet; config external edit | correct one transition; CAS conflict |
| E2E hardware | Telex, VNI, CJK, AltGr, text/image paste in shell/Claude/Codex | exact typed text once; unsupported named |
| Performance | 25 tabs/8 agents, pet/reactions on/off | p95 within budget; component attribution |

Implementation validation: focused Go pet/config tests, focused Vitest, typecheck, full Go/frontend suites; hardware matrix remains unchecked until actually recorded.

## Success criteria

- [ ] Pet persists, progresses once per event and works offline; agent-event XP default off.
- [ ] Repeated terminal lines remain repeated; pet observer never drops/mutates raw/replayed output.
- [ ] Every registered command resolves deterministically; conflict names both commands; cheatsheet matches.
- [ ] Existing custom themes/backgrounds migrate or remain safely recoverable; malformed JSON visible.
- [ ] Hardware IME/paste matrix passes for both providers on supported OSes, or release is blocked with exact failed row.
- [ ] Performance measurements meet agreed budget; unknown measurements aren't marked complete.

## Risks / compatibility / rollback

Medium × medium pet-state migration → backup/versioned migration and notice; rollback leaves new snapshot readable or imports backup with consent. Medium × high keybinding lockout → validate before atomic replace, always-reserved recovery action/reset UI. High × high IME regression → hardware release gate and composing-event tests. Medium × medium stream/regex cost → separate bounded observer and independent disable flag.

Existing bindings/theme keys remain valid aliases for at least one minor release. Rollback disables reactions/new config layer, restores defaults, preserves pet/config backup and never touches terminal history. Phase 10 begins only after measured terminal lifecycle and stop behavior are trustworthy.
