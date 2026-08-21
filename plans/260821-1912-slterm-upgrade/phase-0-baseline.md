# Phase 0 — Baseline, guardrails, quick wins

**Est.** 1-2 weeks · **Runtime-independent** · **Depends on:** nothing

## Goal

Establish the measurements every later phase is judged against, remove code that actively misleads
readers, and bank the config-only performance win before any refactor destabilizes things.

## Context

Every claim in later phases about "lighter" or "faster" is meaningless without a recorded baseline.
Separately, the review found dead modules and one broken RPC call that will waste time for anyone
who reads this code before they are removed.

## Work

### 0.1 Benchmark harness

Extend the existing `benchmarks/` directory. Record and commit a baseline for:

- idle RAM (all processes: Electron main + renderers + `wavesrv`)
- RAM at 10 live terminal tabs
- cold start → first paint
- installed size

These four numbers gate Phase 3 and Phase 7.

### 0.2 Tab cache RAM cut

`pkg/wconfig/defaultconfig/settings.json` — `window:maxtabcachesize` 10 → 2. Already wired through
`emain/emain.ts:440`, so this is a pure config change. Also disable the pre-warmed hot-spare tab in
`emain/emain-tabview.ts`.

Largest immediate RAM cut available, zero rendering or feature risk. Measure the delta.

### 0.3 Lazy-load heavy chunks

`electron.vite.config.ts` already splits `monaco`, `shiki`, `mermaid`, `plot` via `manualChunks`.
Make them load on demand rather than at startup. Enable `backgroundThrottling` for hidden views.

### 0.4 Fix the broken pet RPC

`frontend/app/view/pet/pet-controller.ts:66`:

```ts
(RpcApi as any).PetSelectCommand(TabRpcClient, { petId }).catch(() => {});
```

`PetSelectCommand` does not exist. The real name is `PetSelectPetCommand`
(`pkg/wshrpc/wshrpctypes.go:205`). The `as any` hid the mismatch from the compiler and the
swallowing `.catch()` hid it at runtime — **pet selection has never reached the backend**.

Fix the name, drop the `as any`, and let the rejection surface.

### 0.5 Delete dead pet modules

Written but never imported anywhere:

- `frontend/app/view/pet/pet-sprites.ts` — a canvas `SpriteAnimator` engine
- `frontend/app/view/pet/pet-grab.ts` — physics helpers
- `frontend/app/view/pet/pet-dialogue.ts` — dialogue scheduler
- `frontend/app/view/pet/pet-selector.tsx` — explicit "Phase 07" placeholder
- `frontend/app/view/pet/pet-settings.tsx` — never rendered (only `vibe-settings` is live)

Rendering is actually remote GIFs + CSS keyframes. Leaving a canvas sprite engine in the tree makes
anyone reading this module reason about the wrong architecture.

### 0.6 Single pet mount

`frontend/app/view/term/term.tsx:400` mounts `<PetOverlay />` **inside the block render**, so N
terminal blocks spawn N independent pets. Move to one app-level mount.

### 0.7 Branding cleanup

The fork is ~90% rebranded. Remaining user-visible leftovers:

| Location | Issue |
|---|---|
| `CNAME` | still `docs.waveterm.dev` — will serve SLTerm docs on Wave's domain |
| `tsunami/frontend/index.html` | title "Tsunami App" + `wave-logo-256.png` favicon |
| `tsunami/engine/clientimpl.go:169` | serves the above |
| `frontend/app/view/term/term-model.ts:188` | "Switch to Wave App" |
| `frontend/app/element/quicktips.tsx` | "Open Wave AI Panel" / "Focus Wave AI" |
| `public/logos/wave-*.png`, `frontend/logos/wave-*.png` | unreferenced, delete |
| `build/icon.icns`, `build/icon.ico`, `build/icons/*.png` | **binaries unverified** — only SVG sources confirmed rebranded |

Inspect the icon binaries visually. If they still carry Wave artwork the installed app and taskbar
icon are wrong.

**Leave internal identifiers alone**: `wavesrv`, `wsh`, `wavebase`, `waveobj`, `wcloud`,
`WaveVersion`. These are plumbing, not branding, and the JSON tags they imply
(`json:"rootnode"` etc.) are load-bearing for persistence.

### 0.8 Pre-merge branding guard

Script that diffs incoming upstream merges for reintroduced Wave brand strings in `package.json`,
`frontend/i18n/locales/*.json`, `index.html`, and dialog text. Wire into CI or a git hook.

### 0.9 Config write validation

Custom themes (`termthemes/custom.json`) and backgrounds (`presets/bg.json`) are written raw via the
`FileWrite` RPC, bypassing `SetBaseConfigValue`'s reflection validation. Malformed JSON silently
reads back as `{}`. Validate on write.

### 0.10 Cheatsheet drift — DEFERRED to Phase 6, with reason

Originally scoped as a quick win. It is not one.

`getAllGlobalKeyBindings()` (`frontend/app/store/keymodel.ts:594`) is **declared but neither
exported nor called** — dead code. More importantly it returns only key strings
(`Array.from(globalKeyMap.keys())`, e.g. `"Cmd:n"`) with **no labels**, so the cheatsheet cannot be
generated from it.

And `quicktips.tsx` displays *pseudo*-bindings for readability — `"Cmd:Digit"`,
`"Ctrl:Shift:Arrows"` — which are not registered keys at all (the real registrations are
`Cmd:1`…`Cmd:9` in a loop). So even a drift *check* would produce false failures without a
display-vs-real mapping.

Making the cheatsheet authoritative requires the registry to carry command ids and human labels —
which **is** the command-id indirection refactor in Phase 6. Deferred there rather than faked here.

## Validation

- Benchmarks recorded and committed; RAM delta from 0.2 measured and noted.
- `npm run build:prod` clean, `task build:server` (or equivalent Go build) clean.
- Pet selection verified to reach the Go backend (log or debugger).
- One pet visible with multiple terminal blocks open.
- `grep -ri "waveterm\|Wave Terminal\|Wave AI\|Switch to Wave"` returns nothing in user-visible
  surfaces.
- Icon binaries visually confirmed to carry the SL mark.

## Risk / rollback

Low throughout. 0.2 and 0.3 are config/loader changes — revert the values. 0.5 deletes unreferenced
files — recoverable from git. 0.7 touches strings and assets only.

The one item needing care is 0.6: moving the pet mount changes where the overlay sits in the DOM,
so verify z-index and pointer-events still let the pet be grabbed and thrown.
