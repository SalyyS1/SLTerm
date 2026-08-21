# Phase 0.6 — ADE feature layer, build pipeline, first release artifact

**Status:** done · **Runtime-independent** · Delivered on branch `feat/ade-upgrade`, [PR #61](https://github.com/SalyyS1/SLTerm/pull/61)

## Goal

Make SLTerm actually usable as an AI development environment, get the whole
project building to an installer, and push it.

## Added — the ADE layer

### `pkg/aitools`

Reads and writes Claude Code's on-disk configuration:

| Target | Layout |
|---|---|
| `~/.claude/skills/<name>/SKILL.md` | **directory-per-item** — enumeration walks subdirectories, not a flat glob |
| `~/.claude/agents/*.md` | flat |
| `~/.claude/commands/*.md` | flat |
| `~/.claude.json` → `mcpServers` | plus project-scoped `.mcp.json` |

User and project scope are kept as **separate entries rather than merged**:
which file defines a server is exactly what someone needs to know when two
scopes disagree, and merging would hide it.

`description` is pulled from YAML front matter by a targeted scan rather than a
full YAML parse — we only ever want that one field, and a malformed block should
cost the description, not the whole listing.

Names are validated as single path segments before any join. Skill deletion
removes the owning directory, recomputed from the already-validated path, so an
empty directory is not left behind as a broken entry.

### `pkg/agentteams`

Read-only model over `~/.claude/teams/*/config.json` and
`~/.claude/tasks/<team>/*.json`. Task boards are sorted so in-progress work
rises and completed work sinks — the order someone scanning a board wants.

`team_name` arrives from the UI and is joined into a filesystem path, so it is
validated as a single path segment first; without that it is an
arbitrary-file-read vector.

Kept read-only deliberately, matching upstream: this observes what a running
session already decided. Controlling agents would be a different feature with a
different risk profile.

### Degraded state over silence

Both packages collect parse failures as `Warnings` instead of swallowing them.
These are undocumented private layouts owned by Claude Code; when the format
drifts, the UI shows a warning rather than an empty panel that looks
identical to "nothing configured". This is the one place the reference
implementation was clearly wrong — it uses bare `catch {}` / `continue`.

### Views and widgets

- `view:aitools` — tabbed Skills / MCP / Agents / Commands, list + content pane
- `view:agentteams` — leader/teammate tree plus task board, 3s poll (Claude Code
  emits no desktop event for team changes, so polling the small JSON files is
  the contract available)
- Widgets: **Claude**, **Codex** (both `controller: cmd` + `cmd:interactive`),
  **AI Tools**, **Agent Teams**

Both views ship as code-split chunks and are confirmed present inside
`app.asar`.

## Fixed — typecheck 9 errors → 0

The project had **no way to run `tsc`**; a `typecheck` script was added first,
which is how these surfaced.

| Error | Cause |
|---|---|
| 4× `monaco-env.ts` cannot find module | Monaco's language contributions end in `.contribution`, which TypeScript **strips as a file extension** before resolution, then looks for `.../monaco` and finds nothing. Vite resolves them fine. Declared as untyped side-effect modules in `frontend/types/monaco.d.ts`. |
| `streamdown.tsx` `mermaidConfig` | Streamdown 1.6.10 nests it as `mermaid={{config: …}}` |
| `streamdown.tsx` `defaultOrigin` | Not a prop in this version — absent from both the types and the runtime, so it was already being ignored |
| `notificationpopover.tsx` not callable | `notificationPopoverMode` declared `jotai.Atom<boolean>` (read-only) but created with `atom<boolean>(false)` (writable), so `useAtom`'s setter typed as `never` |

The 3 Wave AI errors were fixed by Phase 0.5's removals.

## Build pipeline

Four environment problems had to be solved before anything packaged:

1. **npm's optional-dependency bug** — 7 linux-x64 native packages in the lock
   were never installed (`lightningcss`, `@tailwindcss/oxide`, `@esbuild`,
   `@swc/core`, `@rollup`, `@parcel/watcher`). `npm ci` did not fix it; they need
   explicit installation, and a later `npm install` prunes them again.
2. **No Windows C toolchain** — `wavesrv` needs CGO for sqlite. Installed zig
   0.16.0 and cross-compiled with `zig cc -target x86_64-windows-gnu`, which is
   the path this repo's own `zigcc.bat` and Taskfile already expect.
3. **`wsh` for 6 platform/arch pairs** — CGO-free, so plain cross-compilation.
4. **The Linux `wavesrv` had to be removed before packaging** — the config's
   `bin/wavesrv.${arch}*` filter would otherwise have shipped both the ELF and
   the PE inside a Windows installer.

### Artifact naming bug found and fixed

The first successful package came out as **`SLTerm-linux-x64-0.16.0.exe`** — a
Windows NSIS installer named "linux". `${platform}` in `artifactName` resolves to
the **build host's** platform, not the target's, and the wrong name propagated
into `latest.yml`, which the auto-updater reads.

Fixed by pinning `artifactName` inside the `win` block to
`${productName}-win32-${arch}-${version}.${ext}`, which is correct regardless of
build host and matches the filenames `README.md` documents.

## Validation

- `go build ./pkg/... ./cmd/...` clean; `go vet` clean on every touched package
- `gofmt` clean on all changed files. Three files were regressed by line
  removals changing struct alignment (`wtypemeta.go`, `settingsconfig.go`,
  `wshserver.go`) and were reformatted; pre-existing unformatted files were left
  alone rather than adding unrelated churn
- `npm run typecheck` — 0 errors
- `npm run build:prod` — succeeds
- Windows x64 NSIS installer verified as a genuine PE: `MZ` magic + Nullsoft
  signature, ~129MB, with `wavesrv.x64.exe` and all 6 `wsh` binaries in
  `app.asar.unpacked`

## Not verified

- **The app was never launched.** This is a Linux host and the artifact is a
  Windows installer; there is no way to run it here. Everything above is
  build-time and static verification. First-run behavior of the two new views
  against real `~/.claude` state is untested.
- Icon binaries (`build/icon.icns`, `.ico`, `icons/*.png`) still unconfirmed as
  carrying SL artwork rather than Wave's — only the SVG sources were verified.
