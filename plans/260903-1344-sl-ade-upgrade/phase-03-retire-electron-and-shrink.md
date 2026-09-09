---
phase: 3
title: "Phase 3: Retire Electron and shrink"
status: todo
priority: P1
effort: "2-3w"
dependencies: [1, 2]
---

# Phase 3: Retire Electron and shrink

## Overview

Delete the Electron shell and everything that exists only to serve it, unify the release pipeline on
one tag scheme, then spend the freed room on the largest remaining payload: Monaco's language workers.
This is the phase that makes "convert everything to Tauri + Rust/Go for lightness" true rather than
aspirational — today both runtimes are maintained and every frontend change has to work under both.

## Gate

**Do not start until all three hold:** phase 1's QA matrix is green on Windows 11 *and* macOS; phase 2
has demonstrated an in-place update; and the Electron baseline measurements exist as a file in
`plans/reports/`. Electron is the only rollback that exists, and step 3.3 destroys the ability to
measure it — the prior plan's `phase-0-baseline.md` lists idle RAM and RAM-at-10-tabs as items to
measure and contains no figures, so **the baseline has never actually been captured**. Capture it in
phase 1 (which already requires a real Windows display) by installing the published `v0.20.0` Electron
release and recording idle RAM, RAM at 10 and 25 tabs, and cold start. Git history keeps `emain/`
recoverable, but a broken Tauri build with no Electron fallback and no update channel leaves users
stranded on a manual reinstall.

## Key Insights

- **The size win is already measured, not projected.** Same code, two shells:

  | Artifact | Electron `v0.20.0` | Tauri `tauri-v0.20.0` |
  |---|---|---|
  | Windows installer | 123.1 MB | **24.1 MB** |
  | Linux deb | 97.6 MB | **24.6 MB** |
  | Linux AppImage | 151.5 MB | (added in phase 2) |
  | macOS | 138.9 / 144.1 MB zip | 28.4 MB dmg |

  For scale: Orca, the category leader, is 172 MB on Windows and 194 MB as an AppImage.
- **`electron.vite.config.ts` cannot simply be deleted.** It builds three bundles — main (`:76`),
  preload (`:101`), renderer (`:122`) — and `package.json:29` defines `build:prod` as
  `electron-vite build --mode production`, which `tauri.conf.json:8`'s `beforeBuildCommand` calls.
  Removing Electron means migrating the renderer half to a plain `vite.config.ts`, not dropping the file.
- **The Monaco cut is already done and shipped. Do not plan it again.**
  `frontend/app/monaco/monaco-env.ts:17-52` is the custom entry: it imports
  `monaco-editor/esm/vs/editor/editor.api`, adds only the basic-languages contribution and the JSON
  language service, and registers exactly two workers (`editor.worker?worker`, `json/json.worker?worker`).
  The shipped bundle proves it — `dist/frontend-tauri/assets/` contains `editor.worker` (541 KB) and
  `json.worker` (840 KB) and **no** ts/css/html/yaml worker. `frontend/app/element/markdown.tsx:34`
  already does `await import("mermaid")`.
- **The real, current numbers** (from `dist/frontend-tauri`, not from `node_modules`): staged frontend
  **26 MB**, of which `monaco-*.js` **6.9 MB**, `mermaid-*.js` **4.1 MB**, `cytoscape-*.js` **1.5 MB**,
  `monaco-*.css` 206 KB. Every "44 MB frontend / 26.5 MB Monaco / 13 MB ts.worker" figure inherited from
  the prior plan measured a pre-cut tree and is stale.
- **Lazy-loading cannot shrink the installer.** `mermaid-*.js` and `cytoscape-*.js` sit in the staged
  directory Tauri bundles whether or not they are dynamically imported. Lazy-loading is a startup-cost
  win, and must be measured as one.
- **`electron.vite.config.ts:186` carries a dead `optimizeDeps.include: ["monaco-yaml/yaml.worker.js"]`**
  naming a package that is not in `package.json`. It goes with the config migration.
- **`hostSwitchesTabsInDocument()` becomes a constant.** `frontend/util/host.ts:55-57` returns true only
  under Tauri; once Electron is gone, the `StackedTabs` gate in `workspace.tsx` is unconditional and
  `emain-tabview.ts`'s per-tab `WebContentsView` model retires with it — closing item 3.4 of the prior
  plan.
- **`window:maxtabcachesize` defaults to 2** and is an Electron tab-view concept reused as the warm-tab
  cap. It stays meaningful in-document, but the default was chosen for a different mechanism and should
  be re-tuned once phase 1 makes benchmarking on a real display possible.
- **Four `ElectronApi`-only members die with the shell** (`getDataDir`, `getHomeDir`, `setWaveAIOpen`,
  `doRefresh`), plus two declared-but-never-exposed (`onNavigate`, `onIframeNavigate`) and one
  exposed-but-never-declared (`openNewWindow`). `HostApi` shrinks to what the Tauri shell actually
  honours.
- **The `host` wshrpc route dies with `emain/`, and nothing else registers it.** The route id is
  `frontend/app/store/wshrpcutil-base.ts:17`, and its only registrant is `initElectronWshrpc`
  (`:121-132`) whose client lives in `emain/emain-wsh.ts`. Two live callers use it: the terminal bell
  (`frontend/app/view/term/termwrap.ts:217`) and `wsh notify` (`cmd/wsh/cmd/wshcmd-notify.go:42`).
  Deleting `emain/` without a replacement makes both fail — the bell throws on every BEL. A Tauri
  variant of `initElectronWshrpc` is therefore part of *this* phase, not phase 4's problem.
- **The Electron auto-updater is probably already dead.** `electron-builder.config.cjs:124-127` uses
  the generic provider with `url: …/releases`, so it fetches `…/releases/latest.yml` — not a path
  GitHub serves. Worth confirming before writing migration notes that promise existing installs an
  upgrade path. UNVERIFIED.

## Requirements

**Functional**

- `emain/` and every Electron dependency are gone; `npm ls electron` finds nothing.
- The `host` wshrpc route still has a registrant, so the terminal bell and `wsh notify` keep working.
- One workflow, one tag scheme: pushing `v0.23.0` builds exactly one runtime.
- An install shipped during phase 2 updates itself to the first `v0.23.0` build.
- The frontend builds through a plain Vite config with no Electron plugin.
- Monaco still opens files, edits, and shows diffs, with its two-worker set intact.
- Markdown still renders mermaid diagrams and graph views, on demand.
- Old `v*` and `tauri-v*` releases stay downloadable forever — they are the only URLs existing
  installs know.

**Non-functional**

- Windows installer **≤ 21 MB** — a real delta against the measured 24.1 MB, not a ceiling the current
  build already clears.
- No mermaid or cytoscape chunk in the initial module graph; startup JS transfer measured before/after.
- Idle RAM, RAM at 10 and 25 tabs, and cold start compared against the **captured** Electron baseline
  (see the gate), recorded in `plans/reports/`.
- No `HostApi` member survives that the Tauri shell does not implement.

## Architecture

```
DELETE   emain/ (19 files, 4236 LOC, 43 ipcMain registrations)
DELETE   electron-builder.config.cjs, .github/workflows/release.yml
DELETE   frontend/util/electron-host.ts
MIGRATE  electron.vite.config.ts → vite.config.ts (renderer only)
SHRINK   frontend/util/host.ts        → Tauri only; hostSwitchesTabsInDocument() removed as a branch
SHRINK   frontend/types/custom.d.ts   → HostApi only; ElectronApi and its 4 extras deleted
NEW      frontend/app/store/wshrpcutil-base.ts  initHostWshrpc: the Tauri registrant for the host route
RENAME   .github/workflows/release-tauri.yml → release.yml, trigger v[0-9]+.[0-9]+.[0-9]+*
SPLIT    the 6.9 MB monaco-*.js chunk out of the startup graph (the worker cut is already done)
```

The `webview.tsx` import of `WebviewTag` from `electron` (`frontend/app/view/webview/webview.tsx:21`)
is the last type-level dependency; it is only used for a type annotation on the iframe path and goes
with the rest.

## Related Code Files

- Delete: `emain/**`, `electron-builder.config.cjs`, `.github/workflows/release.yml`,
  `frontend/util/electron-host.ts`, `zigcc.bat` if unused after the workflow merge
- Create: `vite.config.ts`
- Delete: `electron.vite.config.ts` (after migrating its renderer config)
- Modify: `package.json` (drop electron/electron-vite/electron-builder/electron-updater deps, the
  `postinstall` `electron-builder install-app-deps` hook, and the `dev`/`start` scripts; repoint
  `build:dev`/`build:prod`)
- Modify: `frontend/util/host.ts`, `frontend/types/custom.d.ts`, `frontend/util/tauri-host.ts`
- Modify: `frontend/app/workspace/workspace.tsx` (unconditional `StackedTabs`),
  `frontend/app/store/tab-mount-policy.ts` (re-tune the cap)
- Modify: `frontend/app/view/webview/webview.tsx` (drop the `electron` type import)
- Modify: `frontend/app/store/wshrpcutil-base.ts` (Tauri `host`-route registrant replacing
  `initElectronWshrpc`), `src-tauri/src/host.rs` (bell / notify / focus commands it invokes)
- Modify: `vite.config.ts` chunking for the monaco split; verify `frontend/app/monaco/monaco-env.ts`
  (already the custom entry — do not rewrite it)
- Modify: `Taskfile.yml` (drop Electron package tasks), `README.md` (download table + size claim)
- Modify: `.github/workflows/release-tauri.yml` → `release.yml`

## Implementation Steps

1. **3.1 Confirm the gate.** Phase 1 QA green on Windows and macOS; phase 2 update round-trip proven;
   the Electron baseline file exists. Write the go/no-go into `plans/reports/`.
2. **3.2 Migrate the build.** Extract the renderer half of `electron.vite.config.ts` into
   `vite.config.ts`, drop the dead `monaco-yaml/yaml.worker.js` optimizeDeps entry (`:186`), repoint
   `build:dev` / `build:prod`, and confirm `scripts/stage-tauri-frontend.mjs` still finds its input.
   Remove the `postinstall` hook. **Assert the two-worker Monaco set survives**: after the first build
   through the new config, `dist/frontend-tauri/assets/` must contain `editor.worker` and `json.worker`
   and nothing else worker-shaped.
3. **3.3 Replace the host route, then delete the shell.** First add a Tauri `initHostWshrpc` in
   `frontend/app/store/wshrpcutil-base.ts` registering the `host` route with handlers that `invoke`
   into Rust (bell, notify, focus). Only then delete `emain/`, `electron-builder.config.cjs`,
   `electron-host.ts` and the Electron deps. Collapse `host.ts` to the Tauri resolver and delete the
   `ElectronApi` type with its four extras and three dead declarations. Run typecheck; every error is a
   real coupling to fix.
4. **3.4 Retire the tab-view branch.** `hostSwitchesTabsInDocument()` disappears as a condition;
   `StackedTabs` becomes the only path. This closes prior-plan item 3.4.
5. **3.5 Finish the pipeline unification.** Phase 2 already flipped `prerelease: false` and froze the
   updater endpoint, so this step only deletes `release.yml`, renames `release-tauri.yml` to
   `release.yml`, and changes the trigger to `v[0-9]+.[0-9]+.[0-9]+*`. **The endpoint URL must not
   change here** — if it would, phase 2 chose the wrong URL. **Start at `v0.23.0`** — version numbers
   0.20 through 0.22 are already published across the two old lines (`v0.20.0` Electron,
   `tauri-v0.21.0`/`tauri-v0.22.x` Tauri), so reusing one would make two different builds share a
   version. Keep every existing release and tag; do not delete history that install URLs point at.
   Acceptance: a client installed during phase 2 updates itself to this `v0.23.0`.
6. **3.6 Re-target the shrink at what is actually left.** The worker cut is done; the remaining payload
   is the 6.9 MB `monaco-*.js` chunk, 4.1 MB mermaid and 1.5 MB cytoscape. Measure, then attack: split
   the monaco chunk so the editor is not in the startup graph, and confirm mermaid/cytoscape are absent
   from the initial graph (markdown already lazy-imports mermaid — verify the chunk graph agrees).
   Record before/after for both installer bytes and startup JS transfer.
7. **3.7 Measure the runtime.** On a real display: installer size, installed size, idle RAM, RAM at 10
   and 25 terminal tabs, cold start. Compare against the captured Electron baseline and re-tune
   `window:maxtabcachesize` from the numbers instead of inheriting 2.
8. **3.8 Publish the claim.** Put the measured installer size in the README next to a comparison row —
   the category leader ships 172 MB on Windows. Cite the report path, not a remembered number.

## Todo

- [ ] 3.1 Gate recorded: Windows + macOS QA green, update round-trip proven, Electron baseline captured
- [ ] 3.2 `vite.config.ts` replaces the renderer half; dead `monaco-yaml` entry removed; two-worker set asserted
- [ ] 3.3 Tauri `host`-route client added, **then** `emain/`, Electron deps, `ElectronApi` deleted; typecheck clean
- [ ] 3.4 `StackedTabs` unconditional; tab-view branch retired
- [ ] 3.5 One workflow, `v*` trigger, starting at `v0.23.0`; endpoint unchanged; old releases untouched
- [ ] 3.6 Shrink re-targeted at the 6.9 MB monaco chunk + mermaid/cytoscape startup graph, measured
- [ ] 3.7 Runtime benchmarks against the captured baseline; warm-tab cap re-tuned
- [ ] 3.8 README download table and measured size claim citing the report

## Success Criteria

- [ ] `grep -rn "electron" package.json frontend/ src-tauri/ --include='*.ts*' --include='*.json'`
      returns nothing but historical comments
- [ ] `npm ci && npm run typecheck && npm test` pass with no Electron packages installed
- [ ] A BEL in a terminal still sets the tab indicator, and `wsh notify` still raises a toast
- [ ] Pushing a `v0.23.0` tag produces exactly one set of installers
- [ ] A client installed during phase 2 updates itself to `v0.23.0` without the endpoint changing
- [ ] `dist/frontend-tauri/assets/` contains exactly two Monaco workers, before and after 3.2
- [ ] Windows installer **≤ 21 MB**, with Monaco still functional in all four editor surfaces
- [ ] No mermaid or cytoscape chunk in the initial module graph; startup JS transfer recorded
- [ ] Idle RAM, RAM at 10 and 25 tabs, and cold start are recorded next to the captured Electron figures
- [ ] Every previously published release is still downloadable

## Risk Assessment

- **No rollback after this phase.** *Signal it was premature:* a Windows or macOS defect surfaces that
  the QA matrix missed and there is no shippable alternative. *Response:* the pre-decided answer is to
  fix forward using the phase-2 update channel — which is exactly why phase 2 must ship first, and why
  the gate is not negotiable. `git revert` of the deletion commit is the emergency path; keep it as a
  single, clean commit to make that viable.
- **Deleting `emain/` silently kills the `host` route** unless 3.3's ordering is respected. *Signal:*
  every BEL throws and `wsh notify` times out after 2 s. *Response:* the Tauri host client lands first,
  in its own commit, with the bell as its acceptance test.
- **The Monaco chunk split can break an editor surface silently.** A language client without its worker
  fails at runtime, not at build time. *Signal:* the config editor stops validating JSON, or completions
  vanish. *Response:* the two-worker assertion in 3.2 is the tripwire; test all four surfaces by hand
  before merging; ship the chunk split separately from the Electron deletion so one revert does not undo
  both.
- **The renderer build migration is where a "simple deletion" turns into a week.** `electron-vite`
  supplies defaults (aliases, env prefixes, target) that a bare Vite config does not. *Mitigation:*
  migrate and prove the build **before** deleting anything, in that order.
- **Users on Electron may have no upgrade path.** If the generic-provider updater is indeed dead, the
  only migration is a manual download. *Response:* say so in the release notes; do not imply an
  automatic transition.
- **Benchmarks may not favour the swap on RAM.** Collapsing per-tab `WebContentsView`s forfeits per-tab
  crash isolation and puts every xterm and Monaco instance on one heap. *Signal:* 25-tab numbers worse
  than Electron's. *Response:* the prior plan's rule stands — record the finding, tune the warm-tab cap,
  and treat multi-window (phase 7) as the pressure valve rather than reversing the runtime decision that
  phase 2 has already shipped.

## Security Considerations

- Deleting `emain/preload.ts` removes the `contextBridge` surface entirely — 43 `ipcMain` handlers stop
  existing. That is a net reduction in attack surface, not a change to manage.
- `configureAuthKeyRequestInjection` went with Electron; the auth key now rides URLs and headers from
  the frontend. Confirm no code path still assumes session-level injection.
- Check that no deleted Electron path was the only enforcement point for something — in particular the
  URL-scheme restriction that `host_open_external` now owns alone (`host.rs:91-93`).

## Next Steps

Phase 4 starts the Claude/Codex capability and backend-owned agent-state foundation after this runtime
consolidation and its measurements. Phase 9 remains last because it must include every import and generated
contract added through orchestration phase 10.

