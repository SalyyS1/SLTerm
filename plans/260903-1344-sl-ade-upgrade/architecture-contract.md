# SL-ADE architecture and UX contract

Updated 2026-09-09. Planning contract, not implementation evidence. Source baseline: `f1e24c9`, branch `feat/sl-ade-windows-shell-parity`. Paths below relative to `/home/stackops/saly/SLTerm` unless explicitly absolute. New paths and proposed data types are designs, not claims they exist.

## Outcome and boundaries

A readable, smooth, lightweight ADE for daily Claude Code **and Codex** work: open project → choose provider/profile → work in a terminal → see attention state → review all changes → verify → explicitly commit/push. Optional orchestration follows these foundations, inside this plan, not a deferred follow-on. Bring the user's own CLI credentials/subscription; never sell inference. Windows first, then macOS/Linux. Retain the pet. Keep Tauri as thin native shell, Go as business/data owner, React/Jotai/xterm/Monaco as UI. No Electron end-state, persistent app daemon, cloud/mobile relay, or automatic merge/push.

## Source-verified seams and flow

| Entry → transform → output | Current evidence and implementation consequence |
|---|---|
| Tauri starts Go → parses endpoints → initializes trusted app window | `src-tauri/src/lib.rs:185-197,258,365`; keep credentials only in app-local windows, never external frame initialization |
| Native close → frontend confirmation → native sidecar exit | `src-tauri/src/lib.rs:433-443,459-468`; `Backend::shutdown` at `:85-91` kills/waits for **sidecar only**, not proof of descendant cleanup |
| Go shutdown → asynchronous controller stops → exit | `pkg/waveserver/waveserver.go:85-103`; waits only 500ms, not a completion barrier. Replace with bounded awaited shutdown in phase 1 |
| Controller manager → per-block controller → process launch | sole production `MakeShellController` caller `pkg/blockcontroller/blockcontroller.go:233`; allocation `pkg/blockcontroller/shellcontroller.go:72-83`; controller is block-lived and reused across launches, so attempt state must be generation-scoped |
| Command assembly → host-specific launch | sole `createCmdStrAndOpts` call `pkg/blockcontroller/shellcontroller.go:427`, definition `:732`; shell branch bypasses it. Launch sites `:442,460,466` WSL, `:475,493,499` SSH, `:522` local; definitions `pkg/shellexec/shellexec.go:156,177,295,338,584` |
| PTY reads → bounded block file → frontend render | `pkg/blockcontroller/shellcontroller.go:565-580` → `HandleAppendBlockFile` in `pkg/blockcontroller/blockcontroller.go:365-389`; output observers must not alter raw bytes |
| Process wait → terminal status | `pkg/blockcontroller/shellcontroller.go:599-617`; explicit stop `:98-124`. Additional interface stop callers `pkg/blockcontroller/blockcontroller.go:99,278,326`; shutdown caller `pkg/waveserver/waveserver.go:90`. Fence late wait/read callbacks by launch generation |
| RPC interface → generated clients → server implementation | `pkg/wshrpc/wshrpctypes.go:24-31`; generator task `Taskfile.yml:228`; outputs `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`. Extend additively; never hand-edit generated outputs |
| Commands → key handlers and menu | `frontend/app/store/commands.ts:49,71,87`; `frontend/app/store/keymodel.ts:665,672-676`; `frontend/app/store/appmenu.ts:230-231`. Registry already exists |
| Workspace creation → persisted tabs | `pkg/wcore/workspace.go:51,201,242`; durable workspace meta is presentation/default context, **not authorization** |
| Persistence | `pkg/wstore/wstore_dbsetup.go:28-36` uses existing SQL migrations; new tables use this migration owner, not a second database framework |
| Native process helper | `pkg/util/procutil/procutil.go:38,55-60`, `procutil_windows.go:18-26`; direct executable launch; `.cmd/.bat` need tested batch quoting, `.ps1` needs explicit PowerShell invocation, not blanket `cmd /C` |
| Windows transport | `pkg/wshutil/wshsocket_windows.go:29,40-63` already implements pipe fallback; prove it on Windows rather than recreate it |
| Existing extensibility | `frontend/app/block/block.tsx:54-55` lazily registers AI-tools/teams; `pkg/agentteams/agentteams.go:103,161` reads external Claude tasks, not an ADE scheduler |
| Current security/build debt | `src-tauri/tauri.conf.json:15` CSP null; `pkg/web/ws.go:65` accepts every origin; `frontend/util/wsutil.ts:19-23` browser WebSocket cannot set custom headers; `package.json:26-36` still depends on electron-vite |

## Proposed data ownership

One Go process owns persisted state. SQLite transactions own identity/transitions; an in-process event publisher exposes versioned snapshots/deltas to every renderer. No durable state authority in a React mount or Rust window.

- **Execution host:** stable local/WSL-distribution/SSH-connection identity plus canonical host-local cwd. Never reinterpret remote cwd or provider home as local paths.
- **Agent launch:** provider + mode + profile revision + account-home identifier + execution host + cwd + block ID + random launch generation. Requested/effective model and effort recorded separately; effective may be unknown.
- **Provider session:** opaque provider-validated ID scoped by provider, account home and host; unique active owner unless explicitly cloning/forking. Conversation identity is not block ID, PID, or orchestration task ID.
- **State snapshot:** launch generation, sequence, process status, agent state, source/confidence, observed timestamp, freshness. Agent `done` means a turn ended, not tests passed.
- **Worktree:** trusted repository ID, canonical root, requested starting ref, resolved starting SHA, branch, setup status, ownership, cleanup status. Review includes starting SHA→HEAD **and** index/worktree/untracked changes.
- **Run/Task/Attempt:** durable orchestration namespace, dependency graph and immutable attempt identity; implementation details in phase 10. Reuse launches, sessions, worktrees and review services rather than fork them.

## Provider capability contract

Phase 4 introduces Go adapters for Claude and Codex, not a generic plugin platform. Capabilities are explicit and version-tested: executable discovery, interactive launch, structured launch, explicit resume, session listing, hooks, usage, model/effort, cancellation, config scopes. UI disables unsupported controls with a reason.

Default interaction is the existing PTY/TUI for both providers. Claude structured execution and Codex app-server/structured execution are **separate owned launch modes** for managed runs; never describe app-server as tapping an unrelated Codex TUI. Do not auto-switch execution modes inside an existing conversation. New provider/version support requires fixture and CLI smoke tests.

Managed hooks re-read a private endpoint descriptor each invocation. Descriptor contains endpoint/auth generation, not a long-lived service promise. Per-launch token + generation + sequence validate observations; old hooks after restart are rejected. Hook scripts have bounded execution and fail visibly in diagnostics without breaking the provider. No user hook/settings clobber. OSC/text can spoof state and cannot approve actions.

## Terminal and lifecycle invariants

Live PTY delivery to the terminal stays byte-for-byte ordered; no destructive repeated-line filtering. A separate bounded derivation buffer feeds state and previews. Handle UTF-8 and ANSI/OSC sequences split across chunks. Durable history is an acknowledged sequence of contiguous segments: an append is committed only after storage acknowledgement. On timeout/full disk, mark capture degraded, close the current segment with an explicit missing-range marker, keep live terminal rendering responsive, and begin a new segment only after storage recovers. Persisted/replay offsets never advance across an unacknowledged gap, and no UI may call a gapped history complete or lossless. If policy instead pauses/stops a managed process to preserve a complete audit trail, that must be an explicit per-run setting. Historical retention eviction is separate from live delivery and separately disclosed. Replay uses offset/generation fencing and clear snapshot/live boundaries.

Quit means **confirm first, then stop app-owned work**, persist interruption/exit records, drain/flush, await bounded teardown, reap sidecar and release lock. Canceling the dialog leaves work running. Native sidecar kill is only last resort. New agent launches never use persistent detached daemons. Audit existing durable-shell/job-manager compatibility: stop app-owned local/WSL/SSH jobs by their ownership handles, preserve files/history, leave unrelated external processes alone. Remote disconnect cannot prove remote death: show termination-unconfirmed and retain recovery instructions; never report success or kill by broad process name. Restart restores layout/history; previous active work becomes interrupted and requires explicit retry/resume, never blind replay.

Multi-window: closing a detached window reattaches/restores its tab, not global quit. One backend coordinator arbitrates mutation, focus, notification dedupe and final app quit across all windows. Parent death/crash cleanup uses OS-owned process groups/jobs where supported; PID alone is never identity.

## Trust, content and provider data

Threat model: local user-owned tool can run trusted build commands and provider CLIs; repositories, terminal output, transcripts and external pages remain untrusted inputs. Worktrees separate edits, **not OS permissions or secrets**. Scoped app tokens reduce accidental cross-task authority; they cannot sandbox an arbitrary same-user process.

Repository-read authorization and execution trust are distinct persisted grants from explicit user action; block meta cannot grant either. Go resolves canonical roots; mutations revalidate parent/leaf and repository identity under a per-repository operation lock. Git path identity stays opaque bytes/encoded payload; escaped display text is separate. Harden passive reads against external diff/textconv/fsmonitor; trusted writes may use approved hooks, filters, signing and credential helpers with deadlines and visible output. Do not disable all helpers globally then promise authenticated push.

Review comments/prompts are drafts first. Bind drafts to provider/session/generation and revision. Explicit preview and send; no auto-Enter, no injecting into unknown or permission-prompt TUI state. Structured adapters may submit only through an acknowledged capability and explicit user/run approval. Clipboard fallback remains available.

Tokens are measured only when provider evidence exists; cost is a labeled estimate with pricing revision; subscription quota is separate provider-reported account data with freshness. Missing is unknown, not zero. Never count OTLP and transcript observations of the same usage twice. Summaries are opt-in: the local CLI sends supplied content to its upstream provider. Show preview/disclosure, limits, cancellation and visible failure; never automatic summary-on-exit.

## UX contract

Default: **project sidebar | work area | contextual review drawer**. Sidebar lists project/worktrees and agent attention; work area reuses tiled terminal/editor blocks. Review opens when requested, not a permanent dashboard. Board is available by command/keybinding, secondary and not experimental-hidden. No duplicate command registry, config editor, session database, terminal renderer or navigation rail.

First-run: select project → discover Claude/Codex independently → display version, account/auth readiness and supported features → explicit install/auth instructions or approved install action → select profile → launch. Missing one CLI never blocks the other or an ordinary terminal. Profiles retain typed arguments, host, cwd, provider home, requested model/effort; never persist auth tokens in profiles.

Configuration unifies existing AI-tools: provider/scope badges, settings/hooks/MCP/skills/agents/commands, Claude memory and Codex AGENTS/config equivalents where supported; preserve unknown fields and external edits. Save has diff, schema validation and compare-and-swap. Never manufacture Claude-only concepts for Codex.

File tree/editor, project and session search, prompt composer/snippets/paste-as-file, package-script sibling blocks and preview reuse existing work area. Preview URLs need trust and never receive app credentials. English/Vietnamese labels; keyboard-first focus, visible busy/error/empty/unsupported states; non-color status and reduced-motion. Pet can be hidden and never covers native controls or mandatory approvals.

## Execution, compatibility and measurement

Execution order is serial **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 9**. Shared RPC definitions/generated clients, SQL migration numbering, config schema/defaults, block registry and shell entry files are exclusively owned by the currently active phase. No parallel phases edit shared files. Independent unit-test authoring may proceed read-only against a frozen contract; no second source owner.

All additions use backward-readable schema/defaults and additive RPCs. Older profiles remain selectable; unbound workspaces remain ordinary terminal workspaces. Before migration: flush/close database and make a verified backup; never copy live SQLite files casually. Rollback disables new writes and keeps historical rows; restore a backup only with explicit consent because doing so loses newer work. Phase 2 owns installer/profile identity; phase 9 owns final namespace migration.

Phase budgets are maintainer-weeks, not promised calendar deadlines. Hardware, signing approval and provider changes can add waiting time. Retain **≤21 MB Windows installer target**; if full scope cannot meet it, publish measurement and ask before changing target or scope. Measure installer/installed bytes, app-only process-tree RSS and total RSS including agents separately, cold/warm startup, terminal input p50/p95 and tab switch p95, 1/10/25 tabs, 1/2/4/8 agents. Warm tabs and lazy Monaco help runtime cost, not automatically installer size. Proposed regression gate: no >10% p95 input/tab-switch regression against matched phase-3 baseline; tune before adding capacity. Actual measurements remain pending.

## Reference use and provenance

Historical `reports/` describe 2026-09-03, contain stale claims and are **not current authority**. Fresh source verification overrides them. No renewed competitive popularity/size claims are made.

Local claude-terminal references verified by source: classifier `src/lib/terminalState.ts:37`; resume comment/ladder `src-tauri/src/terminal.rs:132-143` (do not inherit its equals-only assertion); OTLP delta example `src-tauri/src/otel_receiver.rs:10,156`; sticky changelists `src-tauri/src/changelists.rs:2,16,326`; restore/carry-over `src/store/terminalStore.ts:536-554`. Adapt patterns/tests to Go/Jotai, not its Rust business logic or monolithic components.

Orca official references: [Claude](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/agents/claude-code.mdx), [Codex](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/agents/codex.mdx), [hooks/memory](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/agents/hooks-memory.mdx), [history](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/agents/session-history.mdx), [usage](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/agents/usage-tracking.mdx), [worktrees](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/model/worktrees.mdx), [restore](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/model/session-restore.mdx), [orchestration](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/orchestration.mdx), [checkpoints](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/worktree-checkpoints.mdx). Adopt restart-safe hook endpoint lookup, base-ref worktrees, task/attempt correlation and visible gates; reject daemon warm-reattach for our quit model. Orca checkpoints are narrative notes, not rollback snapshots. Recheck upstream versions and MIT notices before copying code.
