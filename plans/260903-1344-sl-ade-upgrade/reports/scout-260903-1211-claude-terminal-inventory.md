# claude-terminal Feature Inventory (for SL-ADE plan)

Scout report. Read-only research. Repo: `/home/stackops/saly/claude-terminal`
(github.com/talayash/claude-terminal), Tauri 2 + React + TS. Reference target:
`/home/stackops/saly/SLTerm` (Wave fork, Go `pkg/` + React `frontend/` + Tauri `src-tauri/`).

Verdict legend: `ALREADY` = already in SLTerm · `PORT` = high value, take it ·
`ADAPT` = valuable but SLTerm's block/tab tiling model reshapes it · `SKIP` (+reason).

## 0. Repo shape / LOC census

| Area | LOC | Notes |
|---|---|---|
| `src/components/**` (85 files) | 18,058 | biggest: `FileChangesPanel.tsx` 1430, `TerminalTabs.tsx` 1055, `FileTreePanel.tsx` 898, `NewTerminalModal.tsx` 709, `TerminalView.tsx` 672 |
| `src/store` + `hooks` + `lib` + `utils` + `types` (non-test) | 9,347 | biggest: `appStore.ts` 1196, `terminalStore.ts` 927, `useKeyboardShortcuts.ts` 330 |
| `src/App.tsx` | 925 | event wiring, global listeners |
| `src-tauri/src/**` (16 files) | 10,948 | `commands.rs` 4,994 (!), `terminal.rs` 935, `database.rs` 788, `error_reporter.rs` 645, `lsp/*` 1,302 |
| `workers/ct-analytics` | ~2.6k (mostly lockfile) | Cloudflare Worker for opt-in telemetry |
| `docs/superpowers/{specs,plans}` | 28 design/plan docs | each shipped feature has a design doc — excellent porting reference |

Total app source ≈ **39k LOC** (~28k TS/TSX + ~11k Rust). Test files exist for
most of `src/lib` (vitest, `vitest.config.ts`).

Contrast with SLTerm: claude-terminal puts *everything* in Rust `commands.rs`
(git, fs, LSP, sessions, telemetry). SL-ADE's hard rule (Rust = shell only) means
**every Rust command below must be reimplemented as a Go RPC in `pkg/`**, not
copied. The Rust files are therefore *specifications*, not portable code. The
TS/TSX layer is the genuinely portable asset.

## 1. Master feature table

TBD

## 2. Agent-state detection heuristic (verbatim)

**This is the crown jewel. It is ~185 LOC total across 4 files and is 100%
frontend — zero backend dependency.** It reads xterm.js's *already-parsed* buffer,
so it works on any terminal frontend that uses xterm.js (SLTerm does).

### 2.1 The four states

`src/lib/terminalState.ts:2`
```ts
export type SessionState = 'busy' | 'waiting' | 'idle' | 'stopped';
```

### 2.2 The classifier — `src/lib/terminalState.ts` (58 LOC, verbatim)

```ts
/**
 * Phrases that unambiguously mean Claude is blocked waiting for a decision.
 * Kept as an exported, versioned list so they are cheap to tune as Claude
 * Code's prompt UI changes. Matched against the joined, trimmed tail text.
 */
export const WAITING_PATTERNS: RegExp[] = [        // :9
  /Do you want to proceed\??/i,
  /Do you trust the files in this folder\??/i,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
];

/**
 * Markers that mean the plain input box is on screen - i.e. Claude is idle and
 * ready for a new prompt, even if a numbered list from the last response is
 * still visible above the box.
 */
const IDLE_MARKERS: RegExp[] = [                   // :21
  /\?\s+for\s+shortcuts/i,
  /^[│|]?\s*>\s*$/,
];

/** A selectable option line, e.g. "❯ 1. Yes" or "2. No". */
const OPTION_LINE = /^(?:❯\s*)?\d+\.\s+\S/;        // :27

/**
 * Decide whether settled terminal output represents a blocking prompt
 * (`waiting`) or a ready input box (`idle`). Only called once output has gone
 * quiet - `busy` is handled by the caller via the activity timer.
 *
 * Bias: when uncertain, return `idle`. A missed prompt is a minor annoyance;
 * a false "needs attention" alarm erodes trust in the whole feature.
 */
export function classifySettled(lines: string[]): 'waiting' | 'idle' {   // :37
  const trimmed = lines.map((l) => l.trim());
  const joined = trimmed.join('\n');

  // 1. Explicit blocking phrases win immediately.
  for (const re of WAITING_PATTERNS) {
    if (re.test(joined)) return 'waiting';
  }

  // 2. If the plain input box is visible, Claude is idle regardless of any
  //    numbered list left over from its last response.
  if (IDLE_MARKERS.some((re) => trimmed.some((l) => re.test(l)))) return 'idle';

  // 3. A selection menu: two or more option lines AND at least one carries the
  //    `❯` cursor. The cursor distinguishes an interactive picker from a plain
  //    numbered list left in a finished response.
  const optionLines = trimmed.filter((l) => OPTION_LINE.test(l));
  const hasCursor = trimmed.some((l) => /^❯\s*\d+\.\s+\S/.test(l));
  if (optionLines.length >= 2 && hasCursor) return 'waiting';

  return 'idle';
}
```

### 2.3 The poller — `src/hooks/useSessionStateDetection.ts` (95 LOC)

Constants (`:15-17`):
```ts
const POLL_INTERVAL_MS = 500;
const BUSY_WINDOW_MS   = 600;
const BUFFER_TAIL_ROWS = 15;
```

Buffer read (`:20-30`) — note `translateToString(true)` strips trailing
whitespace and gives clean text without ANSI:
```ts
function readBufferTail(term: Terminal, rows: number): string[] {
  const buf = term.buffer.active;
  const end = buf.length;
  const start = Math.max(0, end - rows);
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const line = buf.getLine(i);
    out.push(line ? line.translateToString(true) : '');
  }
  return out;
}
```

Decision loop (`:49-69`) — the exact precedence:
```ts
for (const [id, inst] of store.terminals) {
  // Claude terminals only - skip plain shells and script children.
  if (inst.scriptParentId || inst.isShellTerminal) continue;          // :51

  // Exited process: pin to stopped and re-arm notifications.
  if (inst.config.status === 'Stopped') {                              // :54
    store.setTerminalState(id, 'stopped');
    notifiedRef.current.delete(id);
    continue;
  }

  let state: SessionState;
  const last = getLastOutputAt(id);                                    // :61
  if (last != null && now - last < BUSY_WINDOW_MS) {
    state = 'busy';                                                    // <-- output within 600ms == working
  } else if (inst.xterm) {
    state = classifySettled(readBufferTail(inst.xterm, BUFFER_TAIL_ROWS));
  } else {
    // No mounted buffer to read - keep the last known state.
    state = store.terminalStates.get(id) ?? 'idle';
  }
```

So the full rule is: **`stopped` if the PTY exited; else `busy` if any PTY byte
arrived in the last 600 ms; else run `classifySettled()` on the last 15 buffer
rows; else keep previous.** Poll = 500 ms, single global interval for all
terminals (mounted once in `App.tsx`).

Notification gate (`:74-86`):
```ts
if (state === 'waiting') {
  const lookingAtIt = id === store.activeTerminalId && focusedRef.current;
  const dnd = app.dndEnabled && isWithinDnd(app.dndStart, app.dndEnd, new Date());
  if (prev !== 'waiting' && !lookingAtIt && !dnd && !notifiedRef.current.has(id)) {
    const name = inst.config.nickname || inst.config.label;
    notify('Claude needs your input', `${name} is waiting for your response.`);
    if (app.notificationSoundEnabled) playNotificationSound();
    notifiedRef.current.add(id);
  }
} else {
  // Left the waiting episode - re-arm for the next prompt.
  notifiedRef.current.delete(id);
}
```
Four gates before a notification fires: rising edge only (`prev !== 'waiting'`),
not the focused active tab, not inside DnD hours, and one-per-episode dedupe.

### 2.4 The activity clock — `src/lib/terminalActivity.ts` (31 LOC)

Deliberately a **module-level plain `Map`, not Zustand** (`:1-8`):
> "terminalStore.handleTerminalOutput is invoked thousands of times per second on
> streaming chunks … Recording a timestamp in a plain Map avoids that re-render
> cost entirely."

API: `markTerminalActive(id)` / `getLastOutputAt(id)` /
`clearTerminalActivity(id)` / `getActiveTerminalIds(windowMs)`.

### 2.5 The dot — `src/components/StateDot.tsx` (19 LOC, verbatim table)

```ts
const DOT: Record<SessionState, { cls: string; pulse: boolean; title: string }> = {
  busy:    { cls: 'bg-success',          pulse: true,  title: 'Claude is working…' },
  waiting: { cls: 'bg-amber-400',        pulse: true,  title: 'Claude needs your input' },
  idle:    { cls: 'bg-text-tertiary/40', pulse: false, title: 'Idle' },
  stopped: { cls: 'bg-text-tertiary',    pulse: false, title: 'Stopped' },
};
```

### 2.6 DnD window — `src/lib/notificationGate.ts:12`

`isWithinDnd(start,end,now)` supports same-day *and* overnight windows
(`s < e ? cur>=s && cur<e : cur>=s || cur<e`); malformed/zero-length = disabled.
`playNotificationSound()` (`:25`) is a 880 Hz / 0.12 s / gain 0.05 Web Audio
oscillator — no audio asset shipped.

### 2.7 Verdict for SL-ADE

**PORT verbatim, first.** Zero backend, zero Rust, zero Go. Drop
`terminalState.ts` + `terminalActivity.ts` + `notificationGate.ts` + `StateDot.tsx`
into SLTerm's `frontend/`, and rewrite `useSessionStateDetection` as a poller over
SLTerm's block/term-view registry instead of `terminalStore.terminals`. The only
adaptation: SLTerm has no `isShellTerminal`/`scriptParentId` flags, so the "is this
a Claude terminal" filter must key off SLTerm's block meta (`view:term` blocks
launched via the `claude`/`codex` widget). Design doc:
`/home/stackops/saly/claude-terminal/docs/superpowers/specs/2026-06-01-session-state-smart-notifications-design.md`.

Known weakness to note in the plan: the patterns are English-only and cosmetic
(they break when Claude Code changes its TUI). The file comment acknowledges this
and keeps `WAITING_PATTERNS` exported precisely so it is tunable.

## 3. Sessions layer (deep)

### 3.1 How a Claude session id is discovered — `src-tauri/src/claude_session.rs` (252 LOC)

The mechanism is a **before/after directory diff**, not a CLI query. Verbatim
header (`:1-11`):
> Claude Code writes each conversation to `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`
> (cwd encoded by replacing `\`, `/`, and `:` with `-`). We snapshot the existing
> files before spawn and then poll for new ones afterwards; the new file's stem is
> the session id we need to pass to `claude --resume <id>` next time.

| Piece | file:line | Behaviour |
|---|---|---|
| `claude_projects_dir()` | `claude_session.rs:18` | `$HOME/.claude/projects` via `directories::BaseDirs` |
| `encode_cwd()` | `:39` | maps `\`, `/`, `:`, **and space** → `-`; everything else preserved. Tests at `:190-211`: `C:\Dev\Arik\claude-terminal` → `C--Dev-Arik-claude-terminal`; `C:\Dev\AlefBar - Kornish` → `C--Dev-AlefBar---Kornish` |
| `snapshot_session_files()` | `:47` | walks **every** project dir (not just cwd's) into a `HashSet<PathBuf>` — needed because the encoded dir may not exist yet on first run in a folder |
| `find_new_session_for_cwd(snapshot, cwd, exclude)` | `:77` | picks the **newest by mtime** `.jsonl` not in the snapshot and not in `exclude`. `exclude` = session ids already claimed by other live terminals; without it, N terminals in one cwd all converge on one conversation (`:72-76`) |
| `read_first_user_preview(path, 20, 120)` | `:121` | scans first 20 JSONL lines for `type == "user"`, reads `message.content` handling **both shapes** (plain string, or array of blocks with `.text`), collapses whitespace, truncates to 120 chars + `…` |
| `list_sessions_for_cwd(cwd)` | `:162` | all `.jsonl` in the encoded dir → `{id, modified_at (RFC3339), preview}`, sorted newest-first. Empty dir = normal first-run state |

Exposed to the frontend as `list_claude_sessions` (`commands.rs:1018`).

### 3.2 How resume actually works — `terminal.rs:132-146`

```rust
let injected: Vec<String> = if let Some(id) = resume_session_id.as_deref() {
    if id.contains(Self::SHELL_METACHARACTERS) { return Err(...); }
    // `--resume` is `[value]` in Claude's help (optional argument), so
    // Commander.js parses `--resume <id>` as "open picker" plus `<id>`
    // as a stray positional. The `=` form is the only safe way to
    // bind an optional argument.
    vec![format!("--resume={}", id)]
} else if continue_recent {
    vec!["--continue".to_string()]
} else { vec![] };
```
**Critical gotcha to carry into SL-ADE: it must be `--resume=<id>` (equals form),
not `--resume <id>`.** The injected flag is deliberately *not* persisted into the
saved `claude_args` (`terminal.rs:276`) so each restore re-decides which flag to use.

Fallback ladder (`commands.rs:315-335`, `SessionTimeline.tsx:89-96`):
`--resume=<id>` when an id was captured → `--continue` when not → plain spawn.
After a `--continue` spawn the backend immediately records which session it landed
on so a *second* restore uses `--resume` instead (a second `--continue` in the
same cwd would hijack a different conversation, `commands.rs:318-328`).

### 3.3 Cost/token metrics — embedded OTLP receiver (the clever bit)

Not JSONL parsing: claude-terminal spawns Claude Code with OpenTelemetry pointed
at a **localhost HTTP receiver inside the app**. `terminal.rs:253-263`:
```rust
cmd.env("CLAUDE_CODE_ENABLE_TELEMETRY", "1");
cmd.env("OTEL_METRICS_EXPORTER", "otlp");
cmd.env("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json");
cmd.env("OTEL_EXPORTER_OTLP_METRICS_PROTOCOL", "http/json");
cmd.env("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint);      // http://127.0.0.1:<ephemeral>
cmd.env("OTEL_EXPORTER_OTLP_COMPRESSION", "none");
cmd.env("OTEL_METRIC_EXPORT_INTERVAL", "3000");        // 3s vs default 60s
cmd.env("OTEL_METRICS_INCLUDE_SESSION_ID", "true");
cmd.env("OTEL_RESOURCE_ATTRIBUTES", format!("terminal.id={}", id));
```
Only injected when `cost_tracking` is on AND the receiver bound a port
(`commands.rs:286`). The `terminal.id` resource attribute is how one shared
receiver demultiplexes N terminals.

`otel_receiver.rs` (407 LOC) parses OTLP/JSON. Verified note at `:8-12`:
> VERIFIED (Task 1, claude v2.1.159): counters arrive as DELTA increments
> (`aggregationTemporality=1`) — each export is the delta since the last, so the
> aggregator SUMS them. Token values are `asDouble`, type key is `type` with
> camelCase values input/output/cacheRead/cacheCreation.

Defensive parsing: `point_u64` accepts `asInt`-as-string, `asInt`-as-number, or
`asDouble`, rejecting NaN/inf/negative before the `f64 as u64` saturating cast
(`:26-39`). Metrics read from `sum` or `gauge` (`:66-74`).

Frontend contract `src/lib/sessionMetrics.ts:36-38`:
> the BACKEND already summed the DELTA exports into a running total before
> emitting, so each payload is the full cumulative snapshot — the frontend takes
> **latest-value-wins, NOT summing**.

`SessionMetricsPanel.tsx` (102 LOC) renders: est. cost with a **budget bar**
(`sessionBudgetUsd`, turns red at/over budget, `:44-45`), input tokens, output
tokens, cache read, cache write, and "All tokens (incl. cache)". Every row has a
genuinely educational `title` tooltip explaining why cache reads dominate volume
but not cost.

### 3.4 The rest of the sessions UI

| Component | LOC | What it does | Backend |
|---|---|---|---|
| `SessionsPanel.tsx` | 393 | sidebar list of prior Claude conversations for the current cwd; pick one → resume | `list_claude_sessions` |
| `SessionTimeline.tsx` | 229 | modal over `session_history` DB rows: label, start/end, `formatDuration` (`:20`, s/m/h), filter box, one-click resume into `session.working_directory` (not app cwd, `:88`) | `get_session_history` + `create_terminal` |
| `SessionHistory.tsx` | 204 | per-terminal past-run log viewer | `get_session_log`, `read_log_file`, `delete_session_history` |
| `SessionInsights.tsx` | 19 | dumb presenter for an AI summary string | — |
| `titlebar/SessionWidget.tsx` | 180 | compact live session state/cost chip in the titlebar | store only |

AI session summary (`commands.rs:3058` `summarize_session`): reads the raw PTY log
(last 100 KB), strips ANSI with
`\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[A-Za-z]`, then pipes it to
`claude -p --model haiku "Summarize what was accomplished in this terminal session
in 2-3 bullet points. Be concise."` via stdin. Result cached in DB
(`save_session_summary` / `get_session_summary`). Every failure path returns
`Ok(None)` — never an error.

Also note: **every terminal's raw PTY output is teed to a log file**
(`commands.rs:264-274`, `<data_dir>/logs/<uuid>_<ts>.log`). That log is what
powers SessionHistory, summarize, and the timeline. `read_log_file` is
path-confined to the logs dir via `canonicalize()` + `starts_with()` and capped at
2 MB (tail); `get_session_log` caps at 512 KB (tail).

### 3.5 Verdict

| Sub-feature | Verdict for SL-ADE |
|---|---|
| `.claude/projects` discovery + `encode_cwd` + JSONL preview | **PORT** → new Go pkg (`pkg/claudesession`). ~250 LOC Go. Port the *tests* too — the space→`-` rule and the exclude-set rule are non-obvious. |
| `--resume=<id>` / `--continue` ladder | **PORT**. Cheap, high value, and the `=` form is a landmine. |
| PTY output tee to log file | **PORT** (SLTerm already has blockfile/blocklogs — check `pkg/blockstore`; likely ALREADY, needs verifying) |
| OTLP receiver + cost/token HUD | **PORT** but relocate: the HTTP receiver goes in Go (`pkg/`), not Rust. This is the only reliable way to get real cost data and it is already verified against a specific claude version. |
| `summarize_session` via `claude -p --model haiku` | **PORT** (trivial, ~60 LOC Go) |
| SessionTimeline / SessionsPanel / SessionHistory UI | **ADAPT** — in SLTerm these become a `view:sessions` block (or a launcher widget) rather than a modal, so they compose with tiling instead of covering it. |

## 4. Git / review layer (deep)

The single largest feature area: ~2,600 LOC of TSX + ~2,000 LOC of Rust across
**34 git commands**. Design docs:
`docs/superpowers/specs/2026-06-12-intellij-git-commit-panel-design.md`,
`2026-05-21-git-push-popup-design.md`, `2026-06-11-verified-review-cockpit-design.md`.

### 4.1 Changelists — the IntelliJ model, done properly

`src-tauri/src/changelists.rs` (330 LOC, of which ~185 is tests). Header verbatim:
> "Default" is implicit: any file without a row in `changelist_files` belongs to
> Default. So Default is always present, never created, never deletable.
> Mappings persist across commits ("sticky" — IntelliJ behaviour).

**Sticky mapping rules (all enforced in code + tests):**

| Rule | Enforced at |
|---|---|
| `Default` is a synthetic row with `id: None`, prepended to every list — never in the DB | `changelists.rs:47` |
| Name validation: non-empty after trim, ≤ 80 chars, `"Default"` reserved (case-insensitive) | `:19-31`, tests `:174-178`, `:247-260` |
| Uniqueness is **per repo_path**, so `"x"` can exist in `/r` and `/r2` | `UNIQUE(repo_path,name)`, test `:181-186` |
| Assignment is an UPSERT on `(repo_path, file_path)` → a file moves between lists, never duplicates | `:113-119`, test `:302-315` |
| Assigning to `None` = **delete the row** = back to Default | `:121-125`, test `:217-227` |
| Deleting a changelist cascades its file rows | `ON DELETE CASCADE` + `PRAGMA foreign_keys=ON`, test `:198-214` |
| **Worktrees get independent changelists** because `repo_path` is the worktree path | test `:318-329` |
| Ordering: `ORDER BY sort_order, created_at` | `:35` |

Mapping survives commits simply because nothing ever deletes rows on commit.

### 4.2 `ChangelistSection.tsx` (527 LOC) — checkbox semantics

Verbatim header (`:1-20`) — this is the contract to reproduce:
```
//   Changes            <- tracked files in the implicit Default changelist
//   <named changelist> <- tracked files assigned to user changelists
//   Unversioned Files  <- ALL untracked files, always their own group
// with IntelliJ checkbox semantics:
//   checked       = file is staged (included in the commit)
//   unchecked     = file is unstaged
//   indeterminate = partially staged (both staged and unstaged hunks)
// Toggling a checkbox stages/unstages the file; group checkboxes act on the
// whole group. Files named after Windows reserved devices (nul, con, ...)
// cannot be indexed by git - their checkbox is disabled and group toggles
// skip them.
```
Note the Windows-reserved-device-name guard — a real Windows-primary detail
SL-ADE inherits for free by copying this.

### 4.3 `FileChangesPanel.tsx` (1,430 LOC) — the review cockpit

Largest component in the repo. Contains: refresh, branch + worktree switcher,
ahead/behind counts, stage/unstage, commit, push, pull, stash list/apply/pop/drop,
discard, changelist tree, inline diff, search, pin, "open terminal here",
auto-stage modes (`'none' | 'tracked' | 'all'`, `:39`).

Notable UX pattern worth porting (`:12-33`): `pullWithStashConfirm()` — call
`git_pull_branch` with `autoStash:false`; if the error starts with
`"Working tree has uncommitted changes"`, prompt the user, then retry with
`autoStash:true`. **Backend owns stash/pull/pop atomicity**, frontend only owns
consent. Clean division of responsibility to mirror in Go.

### 4.4 Diff & push

- `InlineDiffView.tsx` (182 LOC) — fetches `get_file_diff` (per-terminal cwd) or
  `get_path_file_diff` (explicit path), staged/unstaged toggle, **100 KB guard**
  (`MAX_DIFF_SIZE = 100_000`, `:20`), binary + new + deleted flags. Parsing is a
  hand-rolled `utils/diffParser.ts` (81 LOC) → `DiffHunk[]`.
- `PushModal.tsx` (410 LOC) — driven by `get_push_preview` → `PushPreview`
  (`src/types/git.ts`): shows commits about to go out, upstream, `PushMode`
  (normal / set-upstream / force-with-lease), relative timestamps, warnings.
- `WorktreeModal.tsx` (415 LOC) — list worktrees, create (branch + base + path),
  remove with confirm, and **"open a Claude terminal in this worktree"**. This is
  the Conductor-style parallel-agent workflow in miniature.

### 4.5 Git command surface (34 commands)

`get_terminal_changes`, `get_path_changes`, `get_file_diff`, `get_path_file_diff`,
`git_create_branch`, `get_repo_remote_refs`, `get_upstream_branch`,
`git_pull_branch`, `get_worktree_info`, `list_worktrees`, `get_repo_branches`,
`checkout_branch`, `git_commit`, `get_last_commit_info`, `get_push_preview`,
`git_push`, `git_stage_files`, `git_unstage_files`, `git_stash_push`,
`git_list_stashes`, `git_stash_apply`, `git_stash_pop`, `git_stash_drop`,
`create_worktree`, `remove_worktree`, `git_discard_file`, `get_git_head_content`,
`scan_git_repos`, plus the 6 changelist commands.

### 4.6 Verdict

| Sub-feature | Verdict |
|---|---|
| changelists.rs schema + sticky rules + its 15 tests | **PORT** → `pkg/vcs` in Go. The prior SLTerm plan already scoped `pkg/vcs` with changelists; this file is the reference implementation. Port the tests verbatim (they encode the whole spec). |
| ChangelistSection tri-state checkbox tree | **PORT** (frontend, ~530 LOC, near drop-in) |
| FileChangesPanel | **ADAPT** — 1,430 LOC monolith. In SLTerm this becomes `view:vcs` as a block; split into header/tree/toolbar rather than porting as one file. |
| InlineDiffView + diffParser | **ADAPT** — SLTerm already has `view:codeeditor` (Monaco); prefer Monaco's diff editor over the hand-rolled hunk renderer, keep the 100 KB guard and the staged toggle. |
| PushModal / WorktreeModal | **PORT** (modals are fine as modals) |
| `pullWithStashConfirm` consent pattern | **PORT** (30 LOC, prevents a real footgun) |
| 34 git commands | **PORT as Go RPCs.** Do not port the Rust. See §9 for the Windows exec rule that MUST come along. |
| `scan_git_repos` | **PORT** (feeds the launcher / repo picker) |

## 9. Windows-specific Rust code

This is the highest-value-per-line section for a Windows-primary product.

### 9.1 The git-exec Windows/Unix split — `commands.rs:838-869` (verbatim doc comment)

```
/// SECURITY: On Windows we must NOT route git through `cmd /C` the way the
/// generic `shell_command` helper does for `.cmd`/`.bat` shims (npm/claude).
/// `git` is a real `.exe`, so we invoke it directly. Going through cmd.exe
/// lets cmd metacharacters (`& | ( ) ^ !`) in user-controlled args — branch
/// names, file paths, remotes coming from a hostile repository — break out
/// into command execution, because Rust's std only quotes args containing
/// whitespace and its cmd.exe caret-escaping (the CVE-2024-24576 fix) only
/// triggers when the spawned program itself is a `.bat`/`.cmd`, not `cmd.exe`.
/// Spawning `git.exe` directly means args are passed as literal argv elements
/// (no shell interprets them), which closes the whole injection family.
///
/// On Unix we keep using the login shell (`shell_command`) because git's PATH
/// resolution can depend on the interactive shell environment there, and the
/// single-quote escaping in `shell_command` already makes injection impossible.
```
Rule to carry into Go: **real `.exe` → exec directly; `.cmd`/`.bat`/`.ps1` shim
(npm, claude, npx) → must go through `cmd /C`.** Go's `os/exec` on Windows has the
same argv-quoting hazard class, so the rule transfers 1:1.

### 9.2 `CREATE_NO_WINDOW`

`0x08000000` set via `CommandExt::creation_flags` on every child process
(`commands.rs:809`, `:862`). Without it a console window flashes on each git/npm
call. Go equivalent: `syscall.SysProcAttr{CreationFlags: 0x08000000}` — **verify
whether SLTerm's Go `shellexec` already sets this; if not it is a visible
Windows-quality bug**. UNVERIFIED for SLTerm.

### 9.3 Claude spawn: `cmd.exe /C claude` vs `$SHELL -lc`

`terminal.rs:190-238`. Windows: `CommandBuilder::new("cmd.exe")` + `/C` + `claude`
+ raw args (PATHEXT resolves `claude.cmd`). Unix: `$SHELL -lc '<escaped>'` with a
14-entry shell allowlist and single-quote escaping of every arg.

Input validation before either path (`terminal.rs:84-88`) — args containing any of
```
& | ; ` $ ( ) { } < > ^ \n \r ' " \ ~ * ? [ ] ! \t #
```
are rejected outright. And `BLOCKED_ENV_VARS` (`:91-98`) prevents user profiles
from overriding `PATH PATHEXT COMSPEC SYSTEMROOT WINDIR LD_PRELOAD
LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH NODE_OPTIONS
NODE_EXTRA_CA_CERTS ELECTRON_RUN_AS_NODE HOME USERPROFILE HOMEDRIVE HOMEPATH`.

### 9.4 ConPTY quirks (portable-pty)

| Quirk | file:line |
|---|---|
| "a ConPTY read can block indefinitely after the writer/PTY is dropped" — shapes the reader-thread teardown | `terminal.rs:60` |
| Dead-pipe writes fail with **os error 232** ("the pipe is being closed"); treated as normal teardown, not an error | `terminal.rs:638`, `:332` |
| `resize` is a no-op once Stopped — resizing a dead ConPTY fails | `terminal.rs:674` |
| A fault-injection test simulates "writer that fails every write the way a dead ConPTY pipe does on Windows" | `terminal.rs:777` |
| PTY output channel sized **1000** because "100 caused backpressure into the PTY reader thread under load" | `commands.rs:260-263` |

### 9.5 macOS/Linux PATH resolution — `claude_path.rs` (203 LOC)

Not Windows, but explains the `-lic` choice. Verbatim (`:1-13`): launchd env
lacks the user's PATH; `$SHELL -lc` sources `.zshenv`/`.zprofile` but **not**
`.zshrc` where nvm/fnm/volta/asdf/npm-prefix live. Fix: resolve once via
`$SHELL -lic 'command -v claude'`, cache it, re-resolve if the cached path
vanishes, invalidate after `npm i -g @anthropic-ai/claude-code`. Windows returns
`None` because PATHEXT already handles it (`:41-43`).

Related: `extract_version_line()` (`commands.rs:878`) scans stdout **bottom-up**
for a semver-looking line, because `-lic` means an interactive shell may print
banners/conda-init noise before the real `--version` output.

### 9.6 Verdict

| Item | Verdict |
|---|---|
| git-direct-exec vs cmd-shim rule | **PORT the rule** into SLTerm's Go exec layer. Non-negotiable for Windows-primary. |
| `CREATE_NO_WINDOW` on all children | **PORT** (audit SLTerm's Go exec first) |
| Arg metacharacter rejection + `BLOCKED_ENV_VARS` | **PORT** to Go |
| ConPTY teardown/error-232/resize-when-dead handling | **PORT the knowledge**; SLTerm already has a Go conpty path (UNVERIFIED which library) — these are the bugs it will hit |
| `claude_path.rs` `-lic` resolution | **PORT** to Go, low priority (Windows-primary) but needed for the Linux/macOS builds |
| `extract_version_line` bottom-up scan | **PORT** (20 LOC, saves a confusing bug) |

## 11. SQLite schema (every table)

`src-tauri/src/database.rs:59-166`. `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`.
Location: `ProjectDirs::from("com","claudeterminal","ClaudeTerminal")` → data dir →
`claudeterminal.db`.

| Table | Columns | Purpose | SL-ADE |
|---|---|---|---|
| `profiles` | `id PK, name, description, working_directory, claude_args, env_vars, is_default, preview_json` | launch profiles (args/env/cwd + preview config) | PORT → SLTerm config/DB |
| `workspaces` | `id AI PK, name UNIQUE, terminals(JSON), created_at` | named saved layouts | ADAPT (SLTerm has workspaces/tabs already) |
| `session_history` | `id AI PK, terminal_id, label, started_at, ended_at, log_path, working_directory, claude_session_id` | one row per Claude run; powers SessionTimeline + resume | **PORT** |
| `snippets` | `id PK, title, content, category DEFAULT 'General', created_at` | prompt snippets | PORT |
| `session_summaries` | `terminal_id PK, summary, created_at` | cached `claude -p` haiku summary | PORT |
| `app_meta` | `key PK, value` | installation id etc. | PORT (SLTerm likely has equivalent) |
| `changelists` | `id AI PK, repo_path, name, sort_order DEFAULT 0, created_at DEFAULT datetime('now'), UNIQUE(repo_path,name)` | IntelliJ changelists | **PORT** |
| `changelist_files` | `repo_path, file_path, changelist_id REFERENCES changelists(id) ON DELETE CASCADE, PK(repo_path,file_path)` | sticky file→list mapping | **PORT** |

Indexes: `idx_profiles_name`, `idx_workspaces_name`,
`idx_session_history_terminal_id`, `idx_snippets_category`,
`idx_changelist_files_repo`, `idx_changelist_files_list`.

Migration style (`:140-164`): no `user_version`; instead `ALTER TABLE … ADD COLUMN`
in a loop, swallowing only `"duplicate column name"`. Simple and idempotent —
fine to copy, but SLTerm should use its existing migration mechanism instead.

## 5. OrchestrationPanel

`src/components/OrchestrationPanel.tsx` (335 LOC) + 2 Rust commands. It does **not**
orchestrate anything — it is a **read-only observer of Claude Code's own agent-teams
feature**. Nothing is spawned, scheduled, or routed by claude-terminal.

What it reads (`commands.rs:3493` `get_active_teams`, `:3175` `get_team_tasks`):

| Source | Path | Shape |
|---|---|---|
| Teams | `$HOME|%USERPROFILE%/.claude/teams/<dir>/config.json` | `{name, description, createdAt, leadAgentId, members[{agentId,name,agentType,model,joinedAt,cwd}]}` |
| Tasks | `$HOME/.claude/teams/<dir>/tasks/…` | `{id, subject, status, owner, blockedBy[], activeForm}` |

Behaviour:
- polls every **3000 ms** while mounted (`OrchestrationPanel.tsx:96`), refetching
  teams plus the tasks of the one expanded team;
- accordion: one team expanded at a time (`expandedTeam`), tasks lazily fetched on
  expand (`:76-92`);
- badges lead agent (crown), member count, task count;
- the only interactive bit: `findMatchingTerminal(cwd)` (`:100-108`) —
  case-insensitive, backslash-normalised, trailing-slash-stripped path compare
  against every open terminal's `working_directory`, so clicking a team member
  **jumps to the terminal running in that member's cwd** (`ExternalLink` icon);
- `get_team_tasks` validates `team_name` against `/`, `\`, `..`, `\0` before joining
  the path (`commands.rs:3178`) — path-traversal guard worth copying;
- failures are swallowed (`catch {}` / `console.error`), i.e. the panel degrades to
  empty rather than erroring. Note this is one of the few places that violates the
  project's own error-reporting rule in `CLAUDE.md`.

Opened with **F4** (`keymap.ts` id `toggle-orchestration`).

### Verdict

**ALREADY IN SLTERM** for the data layer: SLTerm already exposes
`AgentTeamsGetSnapshot` / `AgentTeamsGetTasks` and a `view:agentteams` +
`agents` widget. The only genuinely new ideas worth lifting are (a) the
**cwd→terminal jump**, which in SLTerm becomes "focus the block whose `cmd:cwd`
matches", and (b) the path-traversal guard. Do not port the component.

## 6. Command surfaces & modals

### 6.0 The keymap is a data table, not scattered handlers

`src/lib/keymap.ts` — "single source of truth for displayed labels and groups";
`hooks/useKeyboardShortcuts.ts` (330 LOC) is the handler. **25 entries** in 5 groups
(Terminals / Navigation / Editing / View / Git), `MOD` resolved from
`navigator.platform` (`keymap.ts:11-12`). Function keys drive the panels:
`F1` hints · `F2` git · `F4` agent teams · `F6` claude config · `F7` session timeline
· `F8` memory editor. Notable bindings: `Ctrl+P` palette, `Ctrl+Shift+F` global
search, `Ctrl+Shift+V` paste-as-file, `Ctrl+Shift+S` snippets, `Ctrl+Shift+W`
worktrees, `Ctrl+\` split, `Ctrl+G`/`Ctrl+Shift+G` grid.

**This is the shape SL-ADE's unbuilt "user-configurable keybindings" should take**:
a declarative table the palette, the tooltips, and the settings UI all read.
It is *not* yet user-editable in claude-terminal — the array is a constant.

### 6.1 CommandPalette — `CommandPalette.tsx` (506 LOC) + 2 libs

An IntelliJ "Search Everywhere". `lib/paletteSources.ts` declares a fixed-order
source registry with chips and legacy prefix chars:

| Source | prefix | contributes |
|---|---|---|
| Terminals | `@` | open terminals (with a `statusColor` presence dot) |
| Commands | `>` | every keymap action |
| Hints | — | the `get_hints` catalogue |
| Snippets | `#` | DB snippets |

Ranking = `lib/paletteMatching.ts`: `fuzzyMatch` (returns match ranges, rendered by
`palette/HighlightedText.tsx`) + `frecencyScore(usage)` at `:73-80` —
`count + recency` where recency is `8` if used <1 h ago, `4` <1 day, `2` <7 days,
else `1`. Deliberately small so "a one-off click can't outrank a daily habit"
(`:69-71`). Accessibility note in `paletteSources.ts:18-19`: status is always also
spelled out in the description, never conveyed by colour alone.

### 6.2 GlobalSearchModal — `GlobalSearchModal.tsx` (419 LOC) + `search_in_files`

Ripgrep-less recursive content search in Rust (`commands.rs:4674`): args
`{path, query, case_sensitive, include_file_contents}` → `SearchSummary
{results[], total_matches, total_files, truncated}` where each result is
`{file_path, relative_path, matches[{line, column, line_text, match_length}]}`.
Gated by `validate_path_is_trusted(&state, &path)` (`:4682`) — the same
path-confinement trust model the prior SLTerm plan scoped for `pkg/vcs`, and the
root is `canonicalize()`d and must be a directory. Empty query short-circuits.
Results are grouped per file, collapsible, and `truncated` is surfaced in the UI.

### 6.3 HintsPanel — `HintsPanel.tsx` (149 LOC) + `config.rs` (383 LOC)

A static, shipped-in-binary cheat sheet of Claude Code usage, served by `get_hints`.
Seven categories (`config.rs:42-228`): *Top 10 Commands, Getting Started, File
Operations, Git Operations, Code Generation, Debugging, CLI Flags*. Each hint =
`{title, command, description}`; each category carries an icon key mapped to a
lucide icon in the frontend (`HintsPanel.tsx:20-26`). Search box, collapsible
categories, click-to-copy. Also feeds the palette and the Prompt Editor's library.

### 6.4 ScriptsMenu + ScriptChildPane — package.json runner (137 + 107 LOC)

`list_package_scripts(cwd)` → `create_script_terminal`. Verbatim intent
(`ScriptsMenu.tsx:16-20`):
> "Dropdown that lists scripts from package.json in the terminal's cwd and spawns
> them as child terminals (visible split-below in the same tab). Auto-hides when
> there are no scripts — users see nothing for non-JS dirs."

`ScriptChildPane` renders the child **below** the Claude terminal VS Code style,
with a drag-to-resize handle (`height` state, default 240 px, `:20`). Children carry
`scriptParentId` — the same flag the state detector uses to *exclude* them from
Claude-state classification (§2.3 `:51`). `create_shell_terminal` is the sibling
("plain shell in this cwd", flagged `isShellTerminal`, also excluded).

### 6.5 PasteAsFileDrawer — `PasteAsFileDrawer.tsx` (420 LOC) + `pastes.rs` (309 LOC)

Solves a real Claude Code pain: pasting a 5,000-line log into the TUI. Instead the
clipboard content is written to a file and only the **path** is typed into Claude.

| Piece | Detail |
|---|---|
| Store dir | `<cwd>/.claudeterminal/pastes` (`pastes.rs:16`) |
| Self-ignoring | writes a `.gitignore` in `.claudeterminal` so pastes never pollute the repo (`GITIGNORE_DIR`, `:17`) |
| Filename validation | `^[A-Za-z0-9._-]+$`, ≤200 chars, must not start with `.` (`:19-36`) — blocks traversal and dotfiles |
| Default name | `paste-YYYY-MM-DD-HHMM` (`PasteAsFileDrawer.tsx:20-23`) |
| Kind detection | `lib/pasteKind.ts` client-side `detectKindClient` + `kindToExt`; extensions offered: `.json .log .xml .txt` |
| Editor | Monaco, so the paste is reviewable/trimmable before it lands |
| Lifecycle | `write_paste`/`list_pastes`/`read_paste`/`delete_paste`/**`purge_pastes`** — the drawer doubles as a paste manager with sizes (`formatBytes`) |

### 6.6 SnippetsModal — `SnippetsModal.tsx` (312 LOC)

CRUD over the `snippets` table with 4 default categories (`General, Prompts,
Commands, Templates`, `:21`). "Play" writes the snippet straight into the active
terminal (`writeToTerminal`). Small, self-contained, `Ctrl+Shift+S`.

### 6.7 PromptEditorDrawer — `PromptEditorDrawer.tsx` (592 LOC), the sleeper hit

The largest modal, and the one with the most product insight: a **Monaco-backed
compose box for Claude prompts**, with the hints catalogue, the snippets table, and
the pastes list all mounted inside it as insertable libraries.

Its clever part is `lib/terminalInput.ts` `captureClaudeInput(term)` — it seeds the
editor with whatever the user already typed into Claude's TUI input box. Verbatim
(`terminalInput.ts:19-39`): the hardware cursor is useless because "TUIs hide it and
draw their own", so it scans the bottom of the viewport for a prompt marker row
(`/^([>❯➜▶$#]\s+)(\S.*)$/u`), walks downward collecting continuation rows
(`/^(\s*[│|]\s?)?(.*)$/u`) until the box border ends, strips decoration and
alignment indent, and joins with newlines. Declared limitation: soft-wrapped long
lines come back split at the wrap points.

Guard: `looksLikePastePlaceholder()` (`:7-12`) rejects
`/^\[\s*(?:Pasted text|Image)\b[^\]]*\]$/iu` — Claude collapses pasted text/images
into a display token that is *not* the real text, so capturing it would be garbage.

### 6.8 MemoryEditor — `MemoryEditor.tsx` (445 LOC)

Three-tab editor (`claudemd | memory | rules`, `:21`) over
`list_claude_md_files` / `list_memory_files` / `read_memory_file` /
`write_memory_file`. Each `CLAUDE.md` is tagged with a **scope** and project name
(`ClaudeMdInfo {path, scope, projectName}`), so the user can see and edit the global
vs project vs subdir memory hierarchy in one place. `F8`.

### 6.9 ClaudeConfigModal — `ClaudeConfigModal.tsx` (460 LOC)

Three tabs (`settings | agents | commands`, `:8`) over 10 Rust commands:
`read/write_claude_settings` (raw `~/.claude/settings.json` editing with validation
and an `AlertCircle` error state) and full CRUD for `~/.claude/agents/*` and
`~/.claude/commands/*`. `F6`.

### 6.10 ProfileModal / SetupWizard / WhatsNewModal

- `ProfileModal.tsx` (380 LOC) — CRUD over the `profiles` table:
  `{id, name, description, working_directory, claude_args[], env_vars{}, is_default,
  preview: {enabled, url_override, framework_hint}}`. Uses
  `@tauri-apps/plugin-dialog` `open()` for the folder picker — **SLTerm's Tauri
  shell has no dialogs yet**, so this is one of the features blocked on the shell gap.
- `SetupWizard.tsx` (229 LOC) — first-run gate in `App.tsx`. `check_system_requirements`
  → `SystemStatus {node_installed, node_version, npm_installed, npm_version,
  claude_installed, claude_version}`; offers `install_claude_code`
  (`npm i -g @anthropic-ai/claude-code`) inline with an error state and a re-check.
- `WhatsNewModal.tsx` (89 LOC) + `src/changelog.json` — after an update, shows the
  entries newer than the last-seen version. `compareVersions()` is a hand-rolled
  3-part semver compare (`:18-26`) — note it ignores prerelease suffixes, which
  matters because **SL-ADE ships prereleases** (`tauri-v0.20.0` is a prerelease):
  port this with a real semver compare or it will misbehave on `0.21.0-beta.1`.

### 6.11 Notifications, sounds, toasts

| Piece | Files | Detail |
|---|---|---|
| Native notification | `hooks/useNotification.ts` (14 LOC) → `send_notification` | thin `invoke` wrapper; `notify-rust` in Rust. Only failure handling is `console.error`. |
| DnD window + sound | `lib/notificationGate.ts` | `isWithinDnd()` supports overnight windows; `playNotificationSound()` is an 880 Hz / 0.12 s / gain-0.05 Web Audio oscillator — **no audio asset shipped** (§2.6) |
| Focus gate | `hooks/useWindowFocused.ts` | suppresses notification for the tab you are looking at |
| Toasts | `store/toastStore.ts` (88) + `ToastContainer.tsx` (158) | 4 types with icon+colour+progress bar; the project's error convention routes user-action failures here plus `reportInvokeFailure` |

### 6.12 Chrome not in the brief but worth listing

| Component | LOC | Note |
|---|---|---|
| `ToolStripe.tsx` | 102 | IntelliJ left/right icon rails; active indicator hugs the window edge (`:19-21`) |
| `Sidebar.tsx` | 154 | two stacked panels (Sessions + Explorer) with a drag splitter and persisted `sessionsHeightRatio` |
| `StatusBar.tsx` | 286 | bottom bar: terminal count, model chip (per-model colour map `:25`), git branch + ahead/behind, DnD bell toggle, grid/split toggles, app version via `getVersion()`, `ProgressStripe` |
| `TerminalStatusBar.tsx` | 192 | per-terminal bar: restart/stop, copy, elapsed clock (`formatDuration`), truncated cwd (`truncatePath`, 3 segments), capture-input, rename |
| `FileTreePanel.tsx` | 898 | explorer with rename/trash/move/copy, drag-drop |
| `TerminalTabs.tsx` | 1055 | tabs + `useTabDrag` (298) + `pinnedTabs`/`pinnedTabOrder`/`tabOverflow`/`tabTransfer` libs — **pinning and tear-off, both on SLTerm's unbuilt list** |
| `PreviewPanel/Toolbar/InlineHint` + `previewStore` + `lib/preview` | ~450 | dev-server preview webview with framework detection |
| `lsp/` (Rust 1,302 + `lib/lsp`) | — | Monaco LSP bridge |
| `BottomTerminalPane.tsx` | 199 | bottom dock terminal |
| `SplitView.tsx` / `TerminalGrid.tsx` | 75 / 476 | split + up-to-8 grid with `gridNav`/`gridEmptyCells` |

### 6.13 Verdict table for §6

| Feature | Verdict for SL-ADE |
|---|---|
| `keymap.ts` declarative table | **PORT the pattern** — it is the missing foundation for SLTerm's unbuilt user-configurable keybindings |
| CommandPalette + fuzzy + frecency | **PORT** (~700 LOC incl. libs). SLTerm has no palette. Highest UX-per-LOC in the repo after §2. |
| GlobalSearchModal + `search_in_files` | **PORT** (Go RPC + component). Reuse the trust/confinement model already planned for `pkg/vcs`. |
| HintsPanel + `config.rs` hints data | **PORT** (data + 149 LOC). SLTerm has `view:quicktipsview` — **ADAPT** into it rather than adding a second surface. |
| ScriptsMenu + ScriptChildPane | **ADAPT** — SLTerm tiles blocks natively, so "child pane below parent" becomes "sibling block in the same tab". Keep `list_package_scripts` + the auto-hide rule. |
| PasteAsFileDrawer + `pastes.rs` | **PORT** (high value for TUI agents; ~730 LOC total). Keep the `.gitignore` self-ignoring trick and the filename regex. |
| SnippetsModal | **PORT** (small) |
| PromptEditorDrawer + `captureClaudeInput` | **PORT** — the single most differentiating UX in the repo after state detection. `captureClaudeInput` is xterm-buffer-only, zero backend. |
| MemoryEditor | **PORT**, but fold into SLTerm's `view:aitools` (which already does inventory/read/write) instead of a new modal |
| ClaudeConfigModal | **ADAPT** — agents/commands tabs are duplicated by SLTerm `AITools*`; only the raw `settings.json` tab is new |
| ProfileModal | **PORT**, but **blocked on the Tauri dialog gap** (needs `plugin-dialog`) |
| SetupWizard | **PORT** (229 LOC + 2 RPCs; first-run quality matters for a Windows-primary installer product) |
| WhatsNewModal + changelog.json | **PORT** with a real semver compare (prerelease-aware) |
| Toasts / notifications / DnD / sound | **PORT** (needed by §2; SLTerm has no DnD window or notification gate) |
| ToolStripe / Sidebar / StatusBar / TerminalStatusBar | **ADAPT** — SLTerm has its own chrome; cherry-pick the model chip, ahead/behind, elapsed clock, DnD bell |
| FileTreePanel | **ALREADY** (`view:preview` files) |
| Tab pinning / drag / tear-off / overflow libs | **PORT** — directly closes SLTerm's unbuilt "tab pinning/tear-off" item; the libs are pure functions with tests |
| Preview panel | **ALREADY-ish** (`view:webview`) — only framework detection + dev-server URL guessing is new |
| LSP bridge | **ADAPT / defer** — 1,300+ LOC Rust that must be rewritten in Go; a phase of its own |
| Telemetry / error-reporting endpoint | **SKIP** (needs an owner-run Cloudflare Worker) |

## 7. TitleBar / frameless window template

**This is the template SL-ADE should copy for its missing titlebar.** SLTerm's
Tauri shell already runs `decorations(false)`, so the whole gap is closed by this
file plus 8 lines of CSS.

### 7.1 Window config — `src-tauri/tauri.conf.json`

```json
{ "title": "ClaudeTerminal", "width": 1400, "height": 900,
  "minWidth": 900, "minHeight": 600,
  "decorations": false, "transparent": true, "resizable": true, "center": true }
```
plus `"macOSPrivateApi": true` at the `app` level (needed for transparency on macOS).

### 7.2 Drag — two mechanisms working together

CSS (`src/index.css:435-441`) — the whole mechanism:
```css
.drag-region { -webkit-app-region: drag; }
.no-drag     { -webkit-app-region: no-drag; }
```
JS fallback / primary on Windows (`TitleBar.tsx:142`):
```tsx
onMouseDown={(e) => {
  if (e.buttons === 1 && (e.target as HTMLElement).closest('.no-drag') === null)
    appWindow.startDragging();
}}
className="h-[var(--h-header)] … drag-region select-none"
```
Every interactive child carries `no-drag`. The `closest('.no-drag') === null`
check is what makes buttons clickable inside a drag region. **Double-click to
maximize is not implemented** — only the explicit maximize button. Snap (Win+arrow /
drag-to-edge) is handled by the OS because `startDragging()` uses the native
move loop; there is no custom snap code anywhere in the repo (verified: no
`snap`/`AeroSnap` matches).

### 7.3 Window controls

`isMac = navigator.platform.toUpperCase().includes('MAC')` (`:28`) selects between:
- macOS: three 12px traffic-light circles, `#ff5f57` / `#febc2e` / `#28c840`, left
  side, `close` / `minimize` / `toggleMaximize` (`:147-165`).
- Windows/Linux: three 46px-wide full-header-height buttons on the right,
  `Minus` / `Square` / `X`, close hovers to `#E04545` with white icon (`:331-355`).

All three call `@tauri-apps/api/window` `getCurrentWindow()` methods directly —
**no Rust command needed**, which fits SL-ADE's "Rust owns zero logic" rule.

### 7.4 What else lives in the titlebar (the IntelliJ toolbar analogy)

| Element | Source | Note |
|---|---|---|
| sidebar toggle (app icon button) | `:167-174` | Ctrl+B |
| project breadcrumb button | `:177-200` | `pickBreadcrumb(cwd)` → `parent/project`, status dot, opens the command palette |
| branch switcher dropdown | `:203-294` | `get_repo_branches` → filter input + `ListRow` list + current-branch check + inline "Push to remote…" footer (Ctrl+Shift+K) |
| `SessionWidget` | `titlebar/SessionWidget.tsx` (180) | IntelliJ "run widget" analog — live session state + cost |
| `UpdatePill` | `UpdatePill.tsx` (91) | see §8 |
| `ToolsMenu` | `titlebar/ToolsMenu.tsx` (79) | tool-window launcher menu |
| Search Everywhere (Ctrl+P) + Settings (Ctrl+,) | `:318-328` | |
| center brand + version | `:301-308` | hidden when `compactTitleBar` |

### 7.5 Multi-window / tear-off (relevant to SLTerm's missing multi-window)

- `src/lib/windowMode.ts` (46 LOC): a detached window is just
  `index.html?mode=detached&ids=<id,id>`; mode resolved **synchronously** from
  the URL before first render.
- `src/lib/windowLayout.ts` (76 LOC): detached window geometry + which sessions
  they hold, persisted in `localStorage` under `ct-window-layout`. Stable identity
  across restart via `keyOf()` = `sid:<claude_session_id>` else `cwd:<dir>`.
- `src/lib/tabTransfer.ts` (229 LOC) + `hooks/useTabDrag.tsx` + `DragPreview.tsx`:
  the drag-a-tab-out-to-a-new-window engine.
- `main.rs:250-297`: only the `main` window owns app lifecycle; `detached-*`
  windows return early from the close handler; closing `main` saves the session,
  closes all PTYs, then `exit(0)`.

### 7.6 Verdict

| Item | Verdict |
|---|---|
| Frameless titlebar (drag CSS + `startDragging` + platform-split controls) | **PORT** — copy near-verbatim, ~120 LOC. Closes SL-ADE's biggest visible gap. |
| Breadcrumb + branch switcher + tool cluster in the header | **ADAPT** — good IntelliJ-like model, but SLTerm's header already has tabs/workspace switcher; merge rather than stack two bars. |
| `windowMode` + `windowLayout` + `tabTransfer` tear-off | **PORT** — this is exactly the "multi-window + tab tear-off" item already on SLTerm's unbuilt list, and it needs **zero** Rust beyond `WebviewWindow::new`. |
| main-vs-detached close semantics | **PORT** (must come with tear-off or you get data loss) |

## 8. Updater UX (AutoUpdater + UpdatePill)

Plugin stack (`main.rs:60-67`): `tauri_plugin_updater`, `tauri_plugin_process`
(for `relaunch()`), `tauri_plugin_store`, `dialog`, `clipboard_manager`, `opener`,
`shell`.

Config (`tauri.conf.json` → `plugins.updater`):
- `pubkey` = minisign public key (base64), so artifacts must be signed with
  `TAURI_SIGNING_PRIVATE_KEY`.
- **Two endpoints**, tried in order: GitHub
  `releases/latest/download/latest.json`, then a Cloudflare Worker
  `.../update` fallback.
- `windows.installMode: "passive"` (silent-ish NSIS reinstall).
- `bundle.createUpdaterArtifacts: true`, targets `msi, nsis, dmg, app`.
- Windows code signing is delegated to a script:
  `signCommand: "powershell … scripts/sign-windows.ps1 -FilePath \"%1\""`.
  macOS signing/notarization is documented separately in
  `docs/macos-signing-plan.md`; updater flow in `docs/AUTO_UPDATE.md`.

`src/store/updaterStore.ts` (199 LOC) — the interesting parts:

| Feature | line |
|---|---|
| status machine: `idle · checking · available · downloading · ready · error · up-to-date` | `:37` |
| **transient-network classifier** — 9 regexes (`error sending request`, `could not fetch a valid release json`, `connection refused/reset/closed/aborted`, `dns error/lookup`, `failed to lookup address`, `timed out`, `network is unreachable`, `no such host`, `unable to resolve/connect`) that keep `status='error'` in the UI but **suppress telemetry**, because "a single user behind hotel wifi can dominate the error report" | `:13-29` |
| banner gating: `bannerDismissedVersion` ("Later" until next launch), `bannerSnoozedUntil` ("Remind in 4h"), `notifiedVersion` (dedupe desktop toast) | `:47-51` |
| analytics headers on the check: `X-Installation-Id`, `X-App-Version`, `X-OS` (optional, failure is non-fatal) | `:78-92` |
| re-check guard while downloading/ready | `:66-70` |

`UpdatePill.tsx` (91 LOC) renders **only** for `available | ready | error`
(`:16-18`):
- `available` → gradient accent pill "Update · v1.2.3"; clicking **clears the
  snooze/dismiss** and starts the download (`:48-52`).
- `ready` → outlined accent pill "Relaunch · v1.2.3" → `relaunch()`; tooltip
  promises "your terminals will be restored".
- `error` → red pill "Update failed", click retries the check.
Pop-in animation `scale: [0.9, 1.05, 1]` over 0.6 s.

`AutoUpdater.tsx` (217 LOC) is the full banner/modal with progress; `UpdatePill`
is the always-visible titlebar affordance. Design doc:
`docs/superpowers/specs/2026-05-08-relaunch-update-pill-design.md`.

`WhatsNewModal.tsx` (89 LOC) + `src/changelog.json`: after an update, show the
release notes for the new version from a **structured JSON changelog shipped in
the bundle** (not fetched).

### Verdict

| Item | Verdict |
|---|---|
| tauri updater plugin + signed artifacts + dual endpoint | **PORT** — SL-ADE has no updater at all today. Copy the config shape including the fallback endpoint. |
| `UpdatePill` + banner gating + snooze/dismiss/notified | **PORT** (great UX, ~290 LOC total, no backend) |
| transient-network error classifier | **PORT** if SL-ADE adds error telemetry; otherwise SKIP (only value is telemetry hygiene) |
| `WhatsNewModal` + `changelog.json` | **PORT** (89 LOC + data file; pairs naturally with the updater) |
| `scripts/sign-windows.ps1` + `signCommand` hook | **PORT the mechanism**; certificate is owner-specific |

## 9. Windows-specific Rust code

See section between §4 and §11 above (kept adjacent to the git layer it
constrains).

## 10. Rust command surface (every `#[tauri::command]`)

**116 commands**, all registered in one `generate_handler!` block —
`src-tauri/src/main.rs:132-249` (verbatim source of this list). Grouped by domain,
with the SL-ADE destination. Reminder: under the hard rule (Rust = shell only),
**every one of these becomes a Go RPC in `pkg/` or dies**; the Rust is a spec.

| # | Domain | Commands | SL-ADE destination |
|---|---|---|---|
| 7 | PTY / terminal | `create_terminal`, `write_to_terminal`, `resize_terminal`, `close_terminal`, `get_terminals`, `get_cursor_position`, `update_terminal_label`, `update_terminal_nickname` | ALREADY (Go `pkg/shellexec` + blockcontroller) |
| 3 | Profiles | `save_profile`, `get_profiles`, `delete_profile` | PORT → Go (SLTerm has `waveconfig`; likely a config surface, not a table) |
| 3 | Claude CLI mgmt | `get_claude_version`, `check_claude_update`, `update_claude_code` | PORT (small, high UX value) |
| 1 | Hints | `get_hints` | PORT (see §6) |
| 4 | Workspaces | `get_workspaces`, `delete_workspace`, `save_workspace`, `load_workspace` | ADAPT — SLTerm already has workspaces/tabs |
| 3 | Session restore | `save_session_for_restore`, `get_last_session`, `clear_last_session` | ALREADY (SLTerm persists layout) |
| 2 | Setup / requirements | `check_system_requirements`, `install_claude_code` | PORT (drives `SetupWizard`) |
| 2 | OS integration | `open_external_url`, `reveal_in_file_manager` | PORT — `open_external_url` closes SLTerm's missing "open in system browser" gap (webview block) |
| 1 | Claude sessions | `list_claude_sessions` | **PORT** → `pkg/claudesession` (§3.1) |
| 4 | File ops | `rename_path`, `trash_path`, `move_into_dir`, `copy_into_dir` | ADAPT — SLTerm `view:preview` (files) has some; `trash_path` (recycle bin, not delete) is worth taking |
| 1 | Notifications | `send_notification` | PORT (needed by the state detector, §2) |
| 34 | Git | see §4.5 | **PORT** → `pkg/vcs` |
| 6 | Changelists | `list_changelists`, `create_changelist`, `rename_changelist`, `delete_changelist`, `assign_files_to_changelist`, `get_changelist_assignments` | **PORT** → `pkg/vcs` (§4.1) |
| 4 | Session history / logs | `get_session_history`, `get_session_log`, `read_log_file`, `delete_session_history` | PORT (SLTerm has block logs — reconcile, don't duplicate) |
| 3 | Snippets | `save_snippet`, `get_snippets`, `delete_snippet` | PORT (tiny) |
| 2 | Agent teams | `get_active_teams`, `get_team_tasks` | **ALREADY** — SLTerm has `AgentTeamsGetSnapshot`/`GetTasks` |
| 2 | Claude settings | `read_claude_settings`, `write_claude_settings` | PORT → drives `ClaudeConfigModal`; overlaps SLTerm `AIToolsReadItem/WriteItem` |
| 4 | Claude agents | `list_claude_agents`, `read_claude_agent`, `write_claude_agent`, `delete_claude_agent` | **ALREADY** — SLTerm `AIToolsGetInventory/ReadItem/WriteItem/DeleteItem` covers this |
| 4 | Claude commands | `list_claude_commands`, `read_claude_command`, `write_claude_command`, `delete_claude_command` | **ALREADY** — same `AITools*` surface |
| 2 | Telemetry | `get_installation_id`, `send_telemetry_heartbeat` | SKIP (opt-in analytics to a Cloudflare Worker; owner has no such endpoint) |
| 3 | Session summary | `summarize_session`, `save_session_summary`, `get_session_summary` | PORT (§3.4) |
| 4 | Memory / CLAUDE.md | `list_memory_files`, `read_memory_file`, `write_memory_file`, `list_claude_md_files` | PORT (§6, `MemoryEditor`) |
| 1 | Repo discovery | `scan_git_repos` | PORT (feeds launcher/repo picker) |
| 3 | Generic FS | `list_directory`, `read_text_file`, `write_text_file` | ALREADY (SLTerm `view:preview` + `filestore`) |
| 2 | Git file content | `git_discard_file`, `get_git_head_content` | PORT (part of §4) |
| 3 | Scripts / shells | `list_package_scripts`, `create_script_terminal`, `create_shell_terminal` | PORT (§6 `ScriptsMenu`) |
| 1 | Search | `search_in_files` | PORT → `GlobalSearchModal` (§6) |
| 2 | Error reporting | `report_error`, `set_error_reporting_enabled` | SKIP (needs the owner's own endpoint; keep the local panic hook idea) |
| 5 | Pastes | `write_paste`, `list_pastes`, `read_paste`, `delete_paste`, `purge_pastes` | PORT (§6 `PasteAsFileDrawer`) |
| 8 | LSP | `lsp_did_open`, `lsp_did_change`, `lsp_did_close`, `lsp_request`, `lsp_status`, `lsp_install_server`, `lsp_restart_server`, `lsp_server_log` | ADAPT — SLTerm has Monaco in `view:codeeditor` but (UNVERIFIED) no LSP bridge. 1,302 LOC Rust; a real subproject, not a quick port. |

Notable non-command lifecycle logic in `main.rs` that SL-ADE needs anyway:
`on_window_event` at `main.rs:250-297` — only the window labelled `main` owns the
app lifecycle; tear-off windows are labelled `detached-*` and closing one must not
save the session or kill every PTY. On main-window close it saves configs, closes
all PTYs, then `app_handle().exit(0)` (force-closing detached windows). This is the
multi-window contract SL-ADE will need for tab tear-off.

## 11. SQLite schema (every table)

See above (adjacent to §4).

## 12. Feature timeline from src/changelog.json

**65 releases, `1.6.0` (2026-02-18) → `1.31.2` (2026-08-10)** — roughly 6 months.
Read as a *build order that a real user base validated*, which is the most useful
thing this file gives the SL-ADE plan.

| Era | Versions | What shipped |
|---|---|---|
| Foundation | 1.6.0–1.11.0 (Feb 18–25) | profiles, auto-updater, keyboard shortcuts, agents/commands/settings, File Changes panel, session history, workspace save/load, command palette, output logging, crash recovery, split pane, snippets, What's New modal |
| Agent surfaces | 1.12.0–1.17.5 (Feb 27–Mar 30) | Agent Teams panel (F4), macOS support + security hardening, Claude Config Manager (F6), session output restoration, **1.17.0 mega-release**: Agent Teams Mission Control, Session Timeline & Resume Hub, Loop Mode, worktree-aware spawning, model & effort switcher, Teleport & Remote Control, Smart Terminal Insights, CLAUDE.md & Memory Editor; then worktrees, terminal status bar, DnD terminal mgmt |
| Design system | 1.18.0–1.19.4 (Apr 5–18) | elevation design system, app status bar, collapsible sidebar, inline diff viewer, toasts, IntelliJ 2026.1 UI refresh, telemetry, GPU terminal rendering, PTY throughput |
| Git depth | 1.20.0–1.22.6 (Apr 20–May 21) | drag-drop files into terminal, git panel, branch switcher, per-file stage/unstage/commit, stash/pop/apply, nested repos, file explorer, inline Monaco tabs, diff view, discard per file, **package.json scripts runner**, global search (Ctrl+Shift+F), one-click pull, plain shell mode, **Paste as File (1.21.0)**, Settings panel, **changelists (1.22.0)**, live working indicator, stash-and-pull, **Sessions panel (1.22.4)**, **Push Commits popup (1.22.6)** |
| Sessions & polish | 1.23.0–1.28.1 (Jun 2–Jul 20) | **per-session cost & token metrics (1.23.0, opt-in from 1.23.1)**, palette frecency + status dots, grid keyboard nav, WCAG AA + reduce-motion, **tab tear-off into new windows (1.26.0)**, scrollback survives tab switches, **Prompt Editor + titlebar session widget (1.27.0)**, per-terminal conversation on restore (1.27.1), progress stripe, tab flashes green on finish |
| Preview & Search Everywhere | 1.29.0–1.31.2 (Jul 23–Aug 10) | live preview panel + preview allow-list, F5-no-longer-nukes-terminals, **Search Everywhere with source chips**, welcome hub, **pinned tabs + show-hidden-tabs + tab height (1.31.0)**, consolidated left tool rail, update pill redesign |

Two archaeology findings worth flagging:

- **"Teleport & Remote Control" (1.17.0) no longer exists** — zero matches in `src/`
  or `src-tauri/src/`. Announced then removed. Do not plan around it.
- **"Loop Mode" (1.17.0) survives only as an output scrape**: `App.tsx:460`
  `text.match(/loop\s+(\d+[smh])\s+(.+)/i)` → `setLoopMode(id, {interval, prompt})`
  (`terminalStore.ts:194`, `:622`). It infers a loop from what Claude *printed*; there
  is no scheduler. **SKIP** — SL-ADE should not copy a heuristic this fragile.
- Also in that output listener (`App.tsx:472-480`): passive dev-server URL detection,
  re-routed from a script child to its parent tab. Nice pattern, cheap to port.

## 13. Port-order recommendation

Ordered by (value × certainty) ÷ cost. Every item is frontend-first because the hard
rule forces all Rust logic to be re-authored in Go — so the TSX is the asset and the
Rust is the spec.

| # | Item | Why first | Cost |
|---|---|---|---|
| 1 | **Agent-state detection** (§2): `terminalState.ts`, `terminalActivity.ts`, `notificationGate.ts`, `StateDot.tsx`, rewritten poller | ~185 LOC, **zero backend**, and it is the one feature that makes an ADE feel alive. Needs only `send_notification` from the shell. | XS |
| 2 | **Frameless titlebar** (§7) | Unblocks the whole shell: SLTerm runs `decorations(false)` today so there is literally no titlebar. Template + ~8 lines of CSS. | XS |
| 3 | **Tauri shell gaps**: dialogs, tray, global shortcuts, single-instance, app menu, `open_external_url` | Blocks ProfileModal, folder pickers, web-block "open in browser". Pure shell work, allowed by the hard rule. | S |
| 4 | **Updater + UpdatePill + WhatsNewModal** (§8) | SL-ADE ships prereleases with no updater; this is how users ever get v0.21. Fix the semver compare for prerelease tags. | S |
| 5 | **`pkg/claudesession`** (§3): `.claude/projects` discovery, `encode_cwd`, JSONL preview, `--resume=<id>` / `--continue` ladder, session_history table | The core ADE differentiator. Port the *tests*: the space→`-` rule and the exclude-set rule are non-obvious landmines. | M |
| 6 | **CommandPalette + keymap table** (§6.0-6.1) | Highest UX-per-LOC after #1; the keymap table is also the foundation for SLTerm's unbuilt configurable keybindings. | M |
| 7 | **Windows exec hardening** (§9) in Go: exe-vs-shim rule, `CREATE_NO_WINDOW`, arg metacharacter rejection, `BLOCKED_ENV_VARS` | Non-negotiable for Windows-primary. Cheap, and each item is a real CVE-class bug avoided. | S |
| 8 | **`pkg/vcs`** (§4): changelists + sticky rules + 34 git RPCs, `ChangelistSection`, `pullWithStashConfirm`, PushModal, WorktreeModal, `view:vcs` block | Biggest area (~4,600 LOC combined) but already scoped in the prior SLTerm plan. Reuse Monaco's diff editor instead of `diffParser.ts`. | L |
| 9 | **OTLP cost/token receiver in Go** + `SessionMetricsPanel` (§3.3) | Real cost data, already verified against claude v2.1.159. Depends on #5 for terminal↔session identity. | M |
| 10 | **PromptEditorDrawer + `captureClaudeInput`** (§6.7) + **PasteAsFileDrawer** (§6.5) | The two "TUI ergonomics" features. Frontend-heavy, `pastes.rs` is a small Go port. | M |
| 11 | **Tab pinning / drag / tear-off / overflow** (§6.12) + multi-window contract (`main.rs:250-297`) | Directly closes two unbuilt SLTerm items; the libs are pure functions with existing tests. | M |
| 12 | **SetupWizard, HintsPanel→quicktips, Snippets, MemoryEditor→aitools, GlobalSearch, ScriptsMenu, Toasts/DnD** | Breadth pass; each is small and independently shippable. | M |
| — | LSP bridge, telemetry/error endpoint, Loop Mode, Teleport | Defer / skip (§6.13, §10, §12) | — |

## 14. Unresolved questions

1. **Does SLTerm's Go exec layer set `CREATE_NO_WINDOW` (0x08000000)?** UNVERIFIED.
   If not, every git/npm call flashes a console on Windows — a visible quality bug
   for the primary platform.
2. **Does SLTerm already tee PTY output to a per-block log?** `pkg/blockstore` /
   block logs look like the equivalent of `session_history.log_path`, but this was
   not verified. It decides whether §3.4 (SessionHistory, `summarize_session`) is a
   port or a wiring job.
3. **Which ConPTY library does SLTerm's Go backend use**, and does it already handle
   error 232 / resize-after-exit / reader-blocks-after-drop (§9.4)? UNVERIFIED.
4. **Is there any LSP bridge in SLTerm's `view:codeeditor`?** UNVERIFIED. Determines
   whether the 1,302-LOC Rust LSP layer is a phase or a non-goal.
5. **Where do profiles live in SL-ADE** — the `profiles` table, or SLTerm's existing
   `waveconfig`? Affects ProfileModal, NewTerminalModal, and the model/effort
   switcher (`NewTerminalModal.tsx:57-58`, `--effort` is injected at `:283`).
6. **Overlap policy for `AITools*`**: SLTerm's `AIToolsGetInventory/ReadItem/
   WriteItem/DeleteItem` already covers `~/.claude/agents` and `~/.claude/commands`.
   Confirm ClaudeConfigModal collapses into `view:aitools` rather than shipping a
   second editor for the same files.
7. **`--effort` flag validity**: claude-terminal injects `--effort low|medium|high`.
   Not verified against the current Claude Code CLI — if it was dropped, porting the
   switcher ships a broken control.
8. **Telemetry stance**: §10 marks `report_error` / `send_telemetry_heartbeat` SKIP
   because they need an owner-run endpoint. Confirm SL-ADE wants no crash reporting
   at all, or wants a local-file fallback.
9. **The `WAITING_PATTERNS` list is English-only and TUI-cosmetic** (§2.7). Accepted
   risk, or does the plan want a second signal (e.g. OTLP metric silence, or the
   `terminal-finished` event) as a cross-check?
