# Windows terminal workspace preview

This isolated entrypoint exercises Tauri → private IPC → Zig → ConPTY → xterm.
It does not start the Go backend or import the existing application profile.
The Electron/Go entrypoints remain the release path. This preview is unsigned,
source-only and not the completed ADE.

## Build and run

Use the repository root as the working directory. Prerequisites: existing npm
dependencies, Rust/MSVC, system WebView2, PowerShell 7, and the exact local Zig
distribution described in [toolchain.json](../native-core/toolchain.json).
The core build script verifies its version/integrity and downloads nothing.

```powershell
npm run build:proof-core
npm run test:proof-core
npm run build:proof-host
& .\src-tauri\target\release\slterm.exe
```

Keep the executable in this checkout: the core executable is source-relative.
The ordinary Tauri build uses the same output path and can replace it. Close the
preview through **Dừng và thoát** before rebuilding; retain the prior executable
when testing a replacement. These commands do not create an installer.

## Available interactions

- Switch **Chia ô / Tự do**. Dock panes on any side, resize dividers and their
  intersections, or move free panes and resize their edges/corners.
- Auto arrangement wraps after five columns, as do workspace tabs. This rule
  does not limit running sessions. Manual docking stays manual until reset.
- The left session list supports focus, rename, split, zoom, show-only,
  hide/show, stop and close. Hidden sessions continue running. Stopping retains
  the transcript; closing removes a pane after confirmed exit/output drain.
- Right-click pastes. Ctrl+C copies a selection; another distinct Ctrl+C
  interrupts. Without selection it interrupts immediately. Ctrl+Shift+C/V are
  explicit copy/paste shortcuts. Clipboard errors remain visible.
- Ctrl+plus/minus, Ctrl+0, Ctrl+wheel and the font controls adjust terminal text.
  The native window supports edge resizing and maximize/restore.
- Settings include twelve themes, ANSI/custom colors, UI/terminal fonts and
  sizes, cursor, scrollback, spacing, density, radius, and local backgrounds.
  Backgrounds: PNG/JPEG/WebP/GIF, up to 8 MiB/32 megapixels. Fonts:
  TTF/OTF/WOFF/WOFF2, up to 4 MiB. Imports validate signature/decode; remote
  assets and SVG backgrounds are excluded.
- Settings also include manual **Nhập profile cũ** previews. JSON and selected
  SQLite/WAL snapshots are read-only and apply only whitelisted terminal
  settings after the user applies the draft. SQLite headers, page bounds, WAL
  salts/checksums and the narrow legacy `db_client.data` shape are validated;
  unsupported or overflow records fail closed. Secrets, `$ENV` references,
  commands, connections and old workspace/process graphs are shown as skipped
  and are never evaluated, copied or auto-reconnected. The native profile is
  never mutated by this preview.
- Edit shortcuts per action with conflict checks. Global appearance/shortcut
  groups can each be overridden by a workspace. An override is a snapshot;
  resetting inheritance returns that group to the global defaults.
- **Tài nguyên** shows the current SLTerm process and verified descendants,
  grouped into app, WebView, Zig core, shells and other owned processes. CPU
  needs two samples and is normalized across logical CPUs. Working set and
  private commit are separate counters; shared pages can be counted twice in
  summed working sets. Inaccessible processes produce an incomplete-total
  warning. WSL, providers or MCP processes outside this tree are excluded.
  Sampling runs every two seconds only while this panel is open and visible;
  closing it stops polling. This is local inspection, with no telemetry or
  terminal/agent count limit.
- **WSL2** is a read-only capability check. It calls the fixed system
  `wsl.exe` path with a three-second timeout, lists installed distributions and
  shows the raw status output. It never installs a distro, changes WSL
  settings, starts a distro or copies credentials; setup remains a separate
  consented wizard.
- **Tệp dự án** opens a resizable local editor dock. Browse/search file names,
  open multiple UTF-8 files, save with Ctrl+S, compare changes and inspect the
  latest disk version. Monaco, its workers and language grammars are bundled
  locally. Dirty close/quit prompts preserve the buffer unless explicitly
  discarded; typing while a save is pending keeps the newer edits unsaved.
  External changes use revision checks and offer compare/reload/explicit
  overwrite. Even overwrite compares against a freshly read revision.
- HTML/XHTML files also expose **Preview**. The preview runs in a sandboxed
  iframe with a unique origin and restrictive CSP (`connect-src 'none'`, no
  forms, frames, objects or parent navigation); scripts and native bridges are
  not enabled. It is a static preview, not a browser or project server.
- **SSH / SFTP** buttons open a dedicated pane using the Windows OpenSSH
  `ssh.exe` or `sftp.exe` binary. Host, optional user and port are validated
  before spawning; no password, key or token is collected. OpenSSH owns
  `known_hosts` verification and prompts inside the terminal, so changed or
  unknown host keys are never silently accepted. The connection descriptor is
  persisted without secrets and restored as a stopped transcript after restart;
  it is not a durable remote session or remote editor yet.
- **AI CLI** opens Claude or Codex's official local CLI in a dedicated pane. The
  provider command is a fixed allowlist; authentication stays inside the CLI
  login flow and SLTerm does not read, copy or send provider tokens. The pane's
  provider label is persisted with the layout, while restart restores its
  transcript as stopped history and never relaunches the CLI automatically.
- **Chat** is a thin prompt surface over that same official CLI: sending waits
  for the new pane to reach its running state, then delivers the prompt to it.
  Provider output remains in the terminal pane so ANSI redraws, approvals and
  login prompts are preserved; SLTerm does not emulate or proxy provider auth.
- **AI tools** reads the current workspace's `.claude/skills`, agents,
  commands and `.mcp.json` as a read-only inventory. It shows descriptions and
  safe MCP field/transport summaries, redacts secret-valued fields, never
  executes repository commands and never auto-enables a server or copies a
  credential.
- **Chạy nền** in the quit dialog hides the window while preserving the same
  application/core, sessions and editor buffers. Use the Windows tray to reopen
  it or request the normal quit confirmation. This requires a registered tray
  icon and is not a daemon or a restart-resume guarantee.

## Local editor save boundary

The current file API handles existing UTF-8 files, up to 8 MiB, in drive-local
workspace roots. Reads/uploads use bounded chunks. UNC paths, new-file creation,
hardlink saves and paths crossing reparse points are currently unsupported.
Directory handles stay pinned, revision checks happen under an exclusive target
handle, and the original file ACL protects staging/recovery copies.

Before mutating a target, the core writes, verifies and flushes a sibling
`.slterm-recovery-*.bak`. Saving then writes through the exclusively held target
handle, verifies and flushes it. Failed writes attempt restoration; failed
restoration retains the recovery path and reports an error. This is **not a
crash-atomic replacement**: a mid-save crash can require recovery from that
backup. Recovery copies are not automatically pruned. Actual post-mutation
disk/flush failure and a crash during commit still need fault-injection checks.

## Persistence and shutdown

The Zig core exclusively owns versioned SQLite preferences in the isolated
WebView profile:
`%LOCALAPPDATA%\dev.salyvn.slterm.terminal-proof\workspace-customization`.
The database is `ade-profile/profile.sqlite3`; Windows loads SQLite from the
system `winsqlite3.dll`. WAL/FULL writes use revision CAS and a checked online
pre-write backup at `profile.sqlite3.previous`. Foreign/future/corrupt schemas
or failed writes disable further changes until a successful fresh read.
**Đọc lại tùy chỉnh đã lưu** performs that read without replaying uncertain writes.
Local uploaded background/font blobs retain their IndexedDB owner. If SQLite
has no preferences document, the isolated preview's earlier settings are copied
once from IndexedDB; the original record is retained. This does not import the
legacy Electron profile or its secrets.
For disposable tests, `SLTERM_PROOF_PROFILE_DIR` accepts an absolute directory.
Shell/history scratch stays in per-run ignored `proof-results/host-*` paths.

Restart restores the complete workspace tree, pane geometry/visibility and saved
terminal transcript bytes as stopped panes. It never recreates a shell, sends
input, or treats a restored transcript as a running process. A pane without a
legacy run ID is shown as stopped without attempting an archive lookup. A
truncated, interrupted or stream-error archive is replayed with a visible
warning and remains stopped. Failed writes remain visible; unsupported/corrupt
schemas preserve data and disable writes. Quit flushes preference and workspace
writes; exiting without saving requires a separate choice.

Normal quit stops admission, requests shutdown, then requires the exact
versioned shutdown acknowledgement, successful core exit, output EOF and no
observed transport failure. Missing acknowledgement, failed transport or the
ten-second timeout keeps the host open with a visible issue. The user can retry,
cancel, or explicitly confirm **Buộc dừng và thoát**, which may lose final output.
Force recovery terminates only the owned core handle and exits with status 1;
confirmed graceful shutdown exits 0 after Tauri cleanup. Force is unavailable
before a shutdown failure. It never reports an unconfirmed shutdown as success.

The core has a 256 KiB output queue plus one in-flight frame of at most 64 KiB.
Serialization memory is separately bounded per active session; it is not a
global memory cap or a session-count limit. It preserves queued frames under
backpressure. Permanent unread stdout remains unconfirmed until it drains or
the user authorizes force recovery. Overload/write failure is explicit.

## Verification commands

```powershell
npx vitest run
npx tsc --noEmit -p tsconfig.proof.json
npm run typecheck
npm run test:proof-tools
npm run test:proof-core
npm run test:provider-proof
node scripts/terminal-proof/shutdown-recovery.mjs
```

Vitest owns frontend tests. The other scripts use Node's test runner; their
exclusions in Vitest avoid loading a suite with the wrong runner.
The shutdown GUI regression uses the current built executable, a disposable
profile and local test CDP port 19231. It refuses an occupied port, exercises a
deliberately killed test-owned core, verifies force confirmation/cancellation,
checks restored preferences without restored processes, and checks cleanup.

Native Rust unit tests must use the proof build configuration. For example:

```powershell
$priorConfig = $env:TAURI_CONFIG
try {
    $env:TAURI_CONFIG = Get-Content src-tauri/tauri.proof.conf.json -Raw
    cargo test --manifest-path src-tauri/Cargo.toml --features terminal-proof --lib
} finally {
    $env:TAURI_CONFIG = $priorConfig
}
```

Provider fixture/schema/declaration checks have their own
[scope and run guide](../scripts/provider-proof/README.md). They do not launch
providers or make model requests and are not integrated chat.

## Experimental SSH/SFTP dependency proof

The separate [Zig/C proof](../native-core/ssh-proof/build.zig) builds libssh2
with WinCNG and tests real SSH/SFTP packets against an in-memory loopback
fixture. Exact source/compiler/server integrity is recorded in
[dependency pins](../scripts/ssh-proof/dependency-pins.json) and build receipts.
This uses a pinned upstream development snapshot: the released trial exposed
an intermittent WinCNG DH handshake failure. It is not a production libssh2
dependency approval. The workspace UI currently uses the installed Windows
OpenSSH client for interactive SSH/SFTP panes; the pinned Zig/libssh2 path is
still isolated proof for a future native remote file/session service.

```powershell
pwsh -NoProfile -File scripts/ssh-proof/build-ssh-proof.ps1 -DownloadDependencies
pwsh -NoProfile -File scripts/ssh-proof/install-fixture.ps1
node --test --test-concurrency=1 scripts/ssh-proof/ssh-integration.mjs
```

Requires the existing Zig distribution, CMake, Ninja and Node. Downloads/builds
stay under ignored `proof-results/ssh-proof`; no global installation or root
package dependency changes. The builder checks available space and refuses
integrity mismatches. The fixture requires free loopback port19232, generates
keys only in memory and uses synthetic `none` authentication. It never accesses
accounts, real hosts, `.ssh`, known_hosts or credentials. Tests cover trusted,
changed/unknown host keys before authentication, Unicode, symlinks, permission
denial, cancellation, disconnect and repeated fresh handshakes. Real-host
authentication, OpenSSH interoperability, persisted trust, upload/edit/resume
and production lifecycle/security remain separate gates.

## Measurements and remaining gates

`node scripts/terminal-proof/proof-idle-resources.mjs` runs a disposable,
hidden-window ten-shell warm-idle diagnostic. It records executable/harness
hashes, shell identities, viewport, process-tree samples and shutdown outcome
under ignored `proof-results/idle-proof-*`. Test-only debugging is enabled only
for that owned launch. The normal application does not enable CDP.

The unchanged Electron comparison uses
[baseline-build.ps1](../scripts/terminal-proof/baseline-build.ps1) and
[baseline-launch.cjs](../scripts/terminal-proof/baseline-launch.cjs).
[measure-process-tree.ps1](../scripts/terminal-proof/measure-process-tree.ps1)
owns counter definitions. Include browser/backend/shell/conhost resources;
report WSL and provider/MCP resources separately when present. Private commit,
private working set and summed working sets are distinct metrics.

The controlled workload runner uses the existing built artifacts and fresh
disposable profiles. Run applications sequentially with no other build/test
workload. It refuses occupied ports and requires confirmed graceful cleanup:

```powershell
node scripts/terminal-proof/performance-run.mjs --app native --hidden
node scripts/terminal-proof/performance-run.mjs --app baseline --hidden
node --test scripts/terminal-proof/performance-controls.test.mjs
```

Each run prints its result directory. Pass the baseline directory followed by
the native directory to `node scripts/terminal-proof/performance-compare.mjs`.
`--help` lists geometry controls. `--out` and `--temp` accept fresh absolute
directories with existing parents, including on another volume when needed;
TEMP/TMP change only for the owned child launch. Storage volumes are recorded
and mismatches invalidate equivalence. Profiles and failed evidence are retained.

Measurements include a launch-to-observed-safe-shell upper bound (including
CDP/probe overhead), ten verified shells/ten idle samples, known-payload burst
render callbacks, synthetic keyboard input, resize stabilization/ConPTY
dimensions, and warm tab transitions. Tab tests add an eleventh shell after the
ten-shell phases. Electron tabs use separate CDP targets. Tab timing stops after
destination initialization/animation frames; final native positioning and
physical presentation are outside that boundary. These traces are not bare
startup, backend-only latency, or physical display timings.

Comparison checks bootstrap and controlled viewport/visibility, shell/modules,
pane topology, payload, artifact/source stability, shared instrumentation hashes
and storage volumes. Missing or mismatched controls remain visible; one run is
not statistical evidence. No threshold or gate approval is embedded in tools.
The user explicitly deferred the numerical gate for feature implementation.
Reviewed comparable evidence and user-approved budgets remain required before
claiming the final Windows release ready.
The first-input PSReadLine delay remains unresolved. WSL sandbox, durable
remote file/session behavior, live provider/runtime behavior, legacy import,
project preview isolation and
installer/update compatibility retain their own gates. No release publication
or account/host access is implied by this preview.
