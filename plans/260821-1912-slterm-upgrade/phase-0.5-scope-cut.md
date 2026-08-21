# Phase 0.5 — Scope reduction: cut non-ADE subsystems

**Status:** done · **Runtime-independent** · **Authorized by user:** cut anything not needed for an
AI development environment, without asking; keep the pet.

## Goal

SLTerm inherited Wave Terminal's full product surface. Much of it has nothing to do with driving AI
CLIs like Claude Code and Codex, and some of it was already broken. Every subsystem removed here is
one that no longer has to be ported through the Tauri swap in Phase 7.

## Removed

### Tsunami + app-builder framework — ~30,000 LOC

Wave's "build and publish Go web apps from your terminal" framework. Irrelevant to an ADE, and by
far the largest single win: it deletes a whole second Go module, a second frontend, a scaffold
packaging step, and a build target.

- `tsunami/` — own `go.mod`, own frontend, vdom engine, demos, templates
- `pkg/buildercontroller/`, `pkg/waveapp/`, `pkg/waveappstore/`, `pkg/waveapputil/`, `pkg/tsunamiutil/`
- `pkg/blockcontroller/tsunamicontroller.go`
- `pkg/wshrpc/wshrpctypes_builder.go` — 18-method `WshRpcBuilderInterface`, cleanly isolated
- 18 builder/app command impls in `wshserver.go` (`WaveFileReadStreamCommand` was interleaved and
  deliberately preserved)
- `frontend/app/view/tsunami/`
- go.mod `require` + `replace ./tsunami`
- 14 Taskfile tasks + the `build:tsunamiscaffold` target and its `extraResources` entry in
  `electron-builder.config.cjs`
- dead `tsunami:*` / `builder:*` config keys, meta keys, and WPS events

### Builder-window mode

Tsunami's UI: a second kind of Electron window for editing apps. Dead once tsunami is gone.

- `emain/emain-builder.ts` (118 LOC) plus its surface in `emain.ts`, `emain-ipc.ts`,
  `emain-menu.ts`, `emain-util.ts`, `preload.ts`
- `getWebContentsByWorkspaceOrBuilderId` → `getWebContentsByWorkspaceId`; the
  `workspaceOrBuilderId` threading collapses to `workspaceId`
- 5 `window.api` bridge methods and the `BuilderInitOpts` type
- `builderId` / `builderAppId` / `waveWindowType` atoms — with builder windows gone, two
  `waveWindowType` gates became constant and were unwrapped rather than left as dead branches
- the apps flyout in `widgets.tsx` (`AppsFloatingWindow`, `calculateGridSize`) — 169 lines
- `feature:waveappbuilder` setting

### Wave AI — already broken

The fork had gutted Wave AI's implementation but left its callers. This was not a working feature
being removed; it was broken code producing 3 of the 9 pre-existing typecheck errors.

- `frontend/app/workspace/workspace-layout-model.ts` — 301 lines, **zero consumers**, almost
  entirely AI-panel plumbing, and it called `WaveAIModel.getInstance()` which is defined nowhere
- `rateLimitInfoAtom` / `waveAIRateLimitInfoAtom` typed as `RateLimitInfo`, a type that does not
  exist; plus the `waveai:ratelimit` and `waveai:modeconfig` event subscriptions
- `waveaiModeConfigAtom` and its commented-out initializer in `wave.ts`
- `hasCustomAIPresetsAtom`, whose only use was filtering out the `defwidget@ai` widget
- the `ai` widget, and the `waveai` icon/label cases in `blockutil.tsx`
- `WaveAIEnableTelemetryCommand`

An ADE drives Claude Code and Codex in real PTYs. A separate built-in chat panel is not the product.

### wcloud telemetry — uploads to hosts that do not exist

`pkg/wcloud` posted to `api.github.com/SalyyS1/SLTerm/central`,
`wss://wsapi.github.com/SalyyS1/SLTerm/`, and `ping.github.com/SalyyS1/SLTerm/central`. The last two
hostnames are not real. This was a de-branded stub that phoned home to nowhere.

- `pkg/wcloud/` (355 LOC)
- `diagnosticLoop` + `sendDiagnosticPing` + their `InitialDiagnosticWait`/`DiagnosticTick` constants
- the upload half of `sendTelemetryWrapper` (local activity update kept)
- `GoSendNoTelemetryUpdate`, `SendTelemetryCommand`, and the hidden `wsh debug send-telemetry`

`pkg/telemetry` is **kept**: it records locally and is the substrate the error-reporting path uses.
Stripping it is a separate, larger job.

### Discord Rich Presence stub

`pkg/discordrpc` (161 LOC) had **zero consumers** and logged `"connected (stub)"` with a
`// TODO: Implement actual Discord IPC connection`. The vibe-settings UI shipped an "Enable Discord
Activity" toggle wired to a local `useState` — pure theater.

Removed the package, the `DiscordSection` (105 lines), and its orphaned SCSS (75 lines). The pet and
the rest of the vibe surface are untouched. Real Rich Presence stays available as Phase 6 work; what
is gone is UI that claimed a feature that did not exist.

## Deliberately kept

| Kept | Why |
|---|---|
| **Pet system** | User's explicit request — polished properly in Phase 6, not cut |
| `frontend/app/view/webview/` + `pkg/faviconcache` | Works today and is genuinely useful for an ADE (preview a dev server, read docs). Its loss is already scheduled for Phase 7 where the runtime forces it — removing it early would forfeit value for nothing |
| `pkg/vdom` + `frontend/app/view/vdom/` | Woven into `term-model.ts`'s vdom mode. Removing it means surgery in the exact file Phase 1 needs stable. ~3.8k LOC of low-cost surface vs destabilizing the terminal — poor trade. Revisit after Phase 1 |
| `pkg/jobcontroller` + durable shells | High value for an ADE: long-running agent sessions survive disconnects |
| `pkg/remote`, `pkg/wsl`, `pkg/wslconn`, `pkg/genconn` | SSH/WSL remotes are core to developing on remote machines |
| `pkg/telemetry` | Local recording, error-reporting substrate |
| Monaco / codeeditor, preview, sysinfo, helpview, launcher | Ordinary terminal-workstation surface |

## Result

**169 files changed, 253 insertions, 30,086 deletions.**

Surviving widgets: `terminal`, `files`, `web`, `sysinfo`.

## Validation

- `go build ./pkg/... ./cmd/...` — clean (exit 0)
- `go vet` on every touched package — clean
- Go bindings regenerated via `cmd/generatego`, `cmd/generateschema`, `cmd/generatets`
- `npm run typecheck` — **9 pre-existing errors → 6**. The 3 Wave AI errors are fixed; no new errors
  introduced. The remaining 6 (`streamdown.tsx` `mermaidConfig`, 4× `monaco-env.ts` module
  resolution, `notificationpopover.tsx`) are pre-existing and look like artifacts of an incomplete
  `npm install` in this environment (`npm ls typescript` reports `invalid`)
- `widgets.json` re-validated as JSON; `electron-builder.config.cjs` re-validated by loading it
- Taskfile checked for residual `tsunami` references — none

## Notes

The `pkg/vdom` decision is the one worth revisiting: it is retained only because removing it now
would touch `term-model.ts` immediately before Phase 1 hardens that file. Once Phase 1's regression
suite exists, removing vdom becomes a safe, mechanical change.
