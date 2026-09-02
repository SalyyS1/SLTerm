# Phase 3 — Single-webview, in-DOM tabs

**Est.** 3-4 weeks · **Done under Electron** · **Depends on:** Phase 0 benchmarks, Phase 1 carry-over, Phase 2 gate

## Status

| Item | State | Notes |
|---|---|---|
| 3.1 Dynamic tab identity | **done** | `atoms.staticTabId` derives from the active tab, so all ~50 readers follow a switch. Layout models subscribe per tab, not just for the one on screen. |
| 3.2 One webview, warm tabs hidden | **done, unmeasured** | `StackedTabs` in `workspace.tsx`, gated on `hostSwitchesTabsInDocument()` so the Electron path is untouched. |
| 3.3 Suspend/virtualization policy | **done, cap unmeasured** | Least-recently-shown eviction in `tab-mount-policy.ts`, capped by the existing `window:maxtabcachesize` (default 10 — the same knob and the same number the Electron tab-view cache already used). Where the cap *should* be still needs the benchmarks below; that it exists no longer does. |
| 3.4 Retire `emain-tabview.ts` | open | Only after the benchmarks below say the in-document path wins. |

**The gate this phase asks for has not been cleared.** Benchmarks at 10 and 25 live
terminal tabs, and jank with one high-throughput tab, need a running window; the machine this
was built on has no display. What exists is a path that typechecks, builds, and cannot affect the
Electron rendering path — not a measured replacement for it.

Two things to look for first when someone does run it:

- **A tab coming back blank or stale.** Nothing triggers an xterm refresh on becoming visible,
  because no resize happens — the geometry never changed. If a tab returns unpainted, that is where
  to look, and the fix belongs next to `TermResyncHandler`.
- **Mounting cost with many visited tabs.** Every visited tab keeps its terminals, so a session that
  cycles through twenty tabs holds twenty tabs' worth of xterm and Monaco on one heap. That is
  precisely what 3.3 exists to bound, and precisely what the plan says to measure before trusting.

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

**Landed.** The dependency this was waiting on is Phase 1.6: a tab can only be unmounted safely once
its terminals hand their screens over instead of dropping them, and they now do. Eviction is
least-recently-shown, the shown tab is never evicted, and tabs that no longer exist go immediately.

The cap reuses `window:maxtabcachesize` rather than inventing a second setting — it configures exactly
this idea for the Electron tab-view cache, and its default of 10 is the number the app already ships.
Reusing it means one knob whichever shell is hosting, and it means the number can be tuned from
settings once there is a display to measure on. The status note said a cap needs the numbers that
justify it; that argues for making the number adjustable, not for shipping no bound at all — an
unbounded warm set is the leak this phase's own risk section describes.

The policy is a pure function (`resolveMountedTabs`) with the recency list passed in, so the eviction
order is tested without a DOM: cap changes, closed tabs, never-evict-the-active, and tabs with no
recorded recency going first. Survivor order is preserved deliberately — reordering mounted tabs would
move DOM nodes, and moving a node reloads an iframe.

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
