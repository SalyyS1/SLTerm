# Phase 3 — Single-webview, in-DOM tabs

**Est.** 3-4 weeks · **Done under Electron** · **Depends on:** Phase 0 benchmarks, Phase 1 carry-over, Phase 2 gate

## Goal

Remove the per-tab renderer architecture — simultaneously the biggest Electron memory win and the
hard prerequisite for any lighter runtime — while it is still measurable and reversible.

## Why under Electron

`emain/emain-tabview.ts:115` defines `class WaveTabView extends WebContentsView` with an LRU cache
(`MaxCacheSize=10` at `:243`, `window:maxtabcachesize` default in
`pkg/wconfig/defaultconfig/settings.json:15`, wired at `emain/emain.ts:440`). **Neither Tauri stable
nor Wails v3 has an equivalent**, so this refactor is required either way.

Doing it under Electron means the before/after is measurable against the Phase 0 baseline and a bad
result is revertible. Doing it during the runtime swap would confound two large changes.

**If the Phase 2 spike proves Tauri's `unstable` multiwebview is viable, revisit whether this phase
is still needed** — it may become optional rather than required.

## Work

### 3.1 Dynamic tab identity

Retire the one-document-equals-one-tab assumption. `emain` currently sends `wave-init` with a fixed
`tabId` that becomes `staticTabIdAtom` (`frontend/app/store/global.ts:120`), with ~20 references.

Notably: `frontend/layout/lib/layoutModelHooks.ts`, `frontend/app/view/term/term-model.ts`,
`termwrap.ts`, `frontend/app/store/keymodel.ts`, `frontend/app/workspace/workspace.tsx`,
`frontend/app/tab/tabbar.tsx`. Layout and keybinding state become per-tab scoped.

### 3.2 One webview, warm tabs CSS-hidden

Render "tabbar + active tab" in a single document. `frontend/app/tab/tabcontent.tsx`'s
`TabContent({tabId})` is already self-contained, so visually nothing should change.

Match claude-terminal's proven approach: **keep views mounted and flip `visibility`**, never unmount
on tab switch. That is what makes their tab switching lossless.

### 3.3 Suspend/virtualization policy

Replaces the `WebContentsView` LRU. Cold-tab teardown of xterm and Monaco instances with
`SerializeAddon` snapshot restore (built in Phase 1). Memory guardrails with an explicit cap.

### 3.4 Retire `emain-tabview.ts`

`emain/emain-window.ts` reduces to window management only.

## Validation

- Benchmarks at **10 and 25** live terminal tabs vs the Phase 0 baseline.
- **Jank measurement with one high-throughput tab running** — this is the honest test of losing
  per-tab process isolation and moving to a shared main thread.
- Full Phase 1 regression suite still green (tab switching is in it).

## Risk

Collapsing per-tab `WebContentsView`s forfeits **per-tab crash isolation** and puts every xterm and
Monaco instance on one renderer heap and one main thread. One heavy terminal can then jank the rest.

Mitigation: strict cold-tab teardown, output-rate backpressure, and a per-tab watchdog if the jank
numbers are bad. If the 25-tab numbers are worse than Electron's, **document the finding and stop** —
per-tab isolation may be worth more than the memory saving, which would push the runtime decision
toward Tauri's `unstable` multiwebview.

Rollback: this is a large frontend refactor. Keep it on a branch until the benchmarks justify the
merge.
