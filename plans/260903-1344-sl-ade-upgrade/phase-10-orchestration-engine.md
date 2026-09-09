---
phase: 10
title: "Phase 10: Orchestration engine"
status: todo
priority: P1
effort: "4-6w"
dependencies: [8]
---

# Phase 10: Orchestration engine

## Overview / blockers

User-approved orchestration **after foundations**: deterministic durable Run → Task DAG → Attempt execution, explicit approvals, restart recovery, owned cancellation and visible integration conflicts. No persistent daemon, automatic merge/push, unlimited fan-out or completion-by-claim. Read [architecture contract](./architecture-contract.md). Blocker phase 8 transitively includes 1–7 and validates lifecycle/performance. Owner: orchestration maintainer; exclusive shared RPC/migration/CLI/board integration ownership. Phase 9 must wait for this phase to avoid module/import churn.

## Requirements

- **Run**: objective, project/repository, coordinator identity, concurrency policy, state and inbox/event cursor. Run stores plan, never secretly schedules work merely because created.
- **Task**: immutable spec revision, dependencies, expected files/scope, provider/profile/worktree strategy, verification requirements, approval gates and terminal outcome. DAG rejects cycles/self/missing dependencies transactionally. Ready only when dependencies satisfy policy and gates resolved.
- **Attempt**: immutable try of one task with launch ID/generation, provider/session, owned worktree, base ref/SHA, process ownership, requested/effective settings, timestamps/heartbeat, result claim, verification and integration result. Retry creates new attempt; never overwrites history or implicitly inherits changed placement.
- States are finite and explicit: task pending/blocked/ready/awaiting-approval/running/claimed/verified/failed/cancelled/integration-conflict/integrated. Attempt starting/running/needs-you/claimed/stopping/stopped/failed/interrupted. State transitions compare expected revision and active attempt.
- Run state is derived from persisted task/attempt truth, never a free-form coordinator claim: `draft` before
  activation; `active` while at least one nonterminal task can progress; `blocked` when unfinished tasks exist
  but none is ready/running and at least one unresolved dependency/gate/conflict blocks progress; `verifying`
  while no attempt runs and claimed tasks have checks in flight; `completed` only when every required task is
  verified or explicitly waived through an audited user gate; `failed` only by explicit run-fail/cancel policy
  or unrecoverable required-task failure; `cancelled` after all owned active attempts reach terminal or
  termination-unconfirmed outcomes. A task dependency is satisfied only by predecessor `verified` or an
  explicit persisted waiver—not by `claimed`, process exit, cancelled, failed or integrated-without-policy.
- Manual start by default. Shipping defaults are 2 concurrent attempts per Run and 4 across the app, enforced atomically, with hard max 8. Phase-10 measurements may lower those defaults; raising them or the hard cap requires a new explicit decision. No automatic fan-out beyond a confirmed queue action.
- Manual gate before starting repo setup commands or risky mode; user approval before integration/commit/push. Provider permission prompts stay visible per agent. Orchestrator cannot synthesize approval from terminal text, OSC or worker message.
- Agent `worker_done`/process exit is a claim. Verification runs declared commands/checks with captured exit/artifacts/log references; only passing policy marks verified. No verification configured → `claimed/unverified`, never complete-green.
- Dependencies persisted and scheduler deterministic after restart. Running attempts become interrupted after ownership reconciliation; never blindly replay. Explicit resume/retry/adopt/close. No app daemon or warm detached coordinator.
- Cancel/quit stops only exact app-owned process/worktree handles with graceful deadline → process-group/job escalation → reconciliation. Remote uncertain remains stopping/termination-unconfirmed. Quit confirmation cancel leaves all work alive. Worktrees/files retained unless explicit cleanup.
- Integration checks base divergence and complete committed+uncommitted diff. Conflict is user-facing with choices open worktree/review/retry/rebase manually/abandon. Never automatic merge, rebase, reset, commit or push.
- Local CLI named `wsh` is reused **only for managed-shell orchestration**: its subcommands call the running,
  authenticated backend and operate on runs/tasks/attempts that SL-ADE created or explicitly adopted. It
  does not become a general headless coordinator, scan/control arbitrary Claude/Codex processes, mutate
  external `~/.claude/tasks`, or start a runtime when the app is absent. Clear error when app/backend absent.
  JSON is stable/versioned and human output readable. No new platform/server/daemon.

## Architecture / data flow

User creates Run/tasks/gates via UI or `wsh` → Go validates DAG/revisions and persists in one transaction → scheduler computes ready set deterministically by `(priority, created_at, task_id)` → manual start/resume command reserves slot + creates Attempt → phase-6 worktree/setup service → phase-4 provider adapter/owned launch → phase-5 session identity and phase-4 state observations → append-only orchestration events/snapshots → board/CLI.

Agent completion message includes run/task/attempt/launch-generation and nonce. Backend validates active attempt, stores **claim**, ends active execution only if process/adapter confirms. Verification request snapshots exact SHA and dirty-state revision then executes approved checks as app-owned bounded processes. Result records commands (secrets redacted), exit codes, artifact references and tree state. If tree changes during verification, result stale and cannot promote.

### Run/task dependency truth table

| Predecessor / gate state | Dependent task | Run implication |
|---|---|---|
| `verified` | dependency satisfied; other gates may make ready | may remain active/verifying |
| explicit audited waiver | dependency satisfied with waiver badge/evidence | completion may include waived task |
| `claimed` or checks running | blocked; never dispatch | run active/verifying |
| `failed` required task | blocked pending retry/waive/fail-run decision | run blocked, not automatically failed |
| `cancelled` / `interrupted` / termination-unconfirmed | blocked pending explicit recovery | run blocked/cancelling |
| integration conflict | blocked until user resolves/waives integration policy | run blocked |
| unresolved approval/decision gate | awaiting-approval; never dispatch | run blocked if no other progress |
| all required tasks verified/waived and no owned attempt active | terminal | run completed |

Task readiness recomputes transactionally from this table after every persisted transition. A run with zero
tasks remains `draft`; deleting/waiving requirements cannot silently convert an active run to completed without
an audited confirmation. `integrated` is orthogonal evidence unless the run policy explicitly requires it.

Integration preview compares captured base/start SHA, current target and attempt tree. It does not merge. Explicit integration action may open trusted terminal or later invoke a separately confirmed phase-6 operation; automatic mutation is out. Concurrent tasks expected to touch same files receive preflight warning, not false isolation guarantee.

Event log uses monotonic per-run sequence and idempotency key; projections update transactionally. UI/CLI reconnect from sequence, then snapshot if gap. Scheduler wakeups derive from committed state and lease ownership, never frontend timers. Single backend process is authority; no separate coordinator DB/daemon. Existing wstore migration runner `pkg/wstore/wstore_dbsetup.go:28-36` and wshrpc interface `pkg/wshrpc/wshrpctypes.go:24-31` are owning seams.

CLI request path reuses `cmd/wsh/main-wsh.go:15`, generated `wshclient` and existing authenticated router. Proposed verbs: `wsh orchestrate run create/show/list/cancel`, `task add/list/show/gate/ready`, `attempt start/show/log/cancel/retry`, `check/events`. Exact Cobra placement/command conventions must be reverified in `cmd/wsh/cmd/` before implementation; names are proposed contracts, not existing symbols. JSON includes schemaVersion, IDs, revisions, typed status/error and recovery action.

## File inventory

Existing modify:
- `pkg/wshrpc/wshrpctypes.go:24-31`, generated clients/types (`Taskfile.yml:228`), new server implementation.
- `pkg/wstore/wstore_dbsetup.go:28-36`, next migration pair(s); phase-4 agent, phase-5 session and phase-6 worktree/VCS services.
- `cmd/wsh/main-wsh.go:15` only if root wiring requires it; actual subcommands under existing `cmd/wsh/cmd/` convention.
- Phase-7 board/palette/review surfaces and `frontend/app/block/block.tsx:54-55` view registration; settings/defaults.
- `pkg/blockcontroller/blockcontroller.go:317-326`, `pkg/waveserver/waveserver.go:85-103` ownership shutdown path, only through shared phase-1 lifecycle service; do not create orchestration-specific process killer.
New proposed:
- `pkg/orchestration/{model,store,dag,scheduler,attempt,verification,integration,recovery,events}.go` + focused tests; combine files if implementation stays small.
- `pkg/wshrpc/wshserver/wshserver_orchestration.go`; `cmd/wsh/cmd/wshcmd-orchestrate.go`; `frontend/app/view/orchestration/{run-board,task-detail,attempt-log,approval-gate}.tsx` with `.ts` models where no JSX.
- Next sequential `db/migrations-wstore/*_orchestration.{up,down}.sql` reserved only at implementation.
Read-only design input: official Orca orchestration doc linked in architecture contract. Adopt identity/attempt/inbox/gates, not experimental daemon/federation breadth. External `~/.claude/tasks` remains read-only and never canonical.

## Steps

1. Write state-machine, DAG/cycle, optimistic-revision and idempotency property tests. Define cancellation/quit truth table and terminal/verification/integration outcomes before schema.
2. Add additive SQL schema/event projection with migration/backup/restart/failure tests. Store immutable spec/attempt revisions and normalized IDs; no JSON blob as sole query authority for dependencies/status.
3. Implement transactional Run/Task/gate APIs, the dependency/run-state truth table and deterministic ready
   computation. Dependency editing of active tasks either rejected or creates new spec revision after cancel;
   a zero-task run stays draft and completion requires verified/waived required tasks.
4. Implement slot reservation and manual Attempt start using existing worktree setup + adapter launch. Ensure no task double-dispatch across two UI windows/CLI race. Record launch/effective receipt before running.
5. Correlate heartbeats/state/questions/claims with active attempt/generation. Permission/question becomes visible gate or agent attention; no implicit approval. Late previous-attempt messages retained as audit events, never current status.
6. Implement verification policies and stale-tree fencing. Default template can suggest project checks but user confirms commands; no arbitrary repo command executes under read trust. Completion remains claimed until policy passes.
7. Implement owned cancellation/quit/restart reconciliation. Graceful input/signal, bounded wait, job/process-group escalation, exact handle reconciliation; Windows local, WSL and SSH cases. Preserve worktree/history. Add fault injection for app crash between each transition.
8. Implement integration preview/conflict state and explicit handoff. No merge/push. Phase-6 VCS actions retain their confirmations; orchestration only references receipts.
9. Add managed-shell-only CLI and stable JSON error contracts, wait/event cursor with bounded timeout and
   ack/idempotency. Reject non-SL-ADE process/task IDs, external Claude task mutation, app-not-running and
   stale revision with actionable errors; never auto-start backend/daemon.
10. Build run/task/attempt UI over phase-7 secondary board: dependency graph/list, approvals, verification evidence, concurrency limits, click to exact terminal/worktree. Keep project sidebar/work area default.
11. Performance/security soak at 2/4/8 launches and restart/quit scenarios. Ship the validated 2/run and 4/app defaults with hard max 8 when they meet the architecture budget; measurements may lower defaults. If they fail, report the lower measured values. Never raise defaults or max 8 without a new user decision, and never allow unbounded launch.

## Test scenario matrix

| Level | Cases | Expected |
|---|---|---|
| Unit/property | cycle/self/missing dependency, randomized DAG, revision races | invalid atomic reject; one deterministic ready set |
| Unit/table | predecessor claimed/verified/failed/cancelled/waived; zero-task; gate/conflict; all verified | dependent and Run state exactly match truth table |
| Unit | duplicate start/claim/heartbeat/ack, late old attempt, retry | one active attempt, full immutable history |
| Integration DB | crash before/after event/projection/slot reservation | restart consistent; no duplicate dispatch |
| Integration process | graceful stop ignored, child/grandchild, unrelated same-name process | owned tree escalated/reaped; unrelated survives |
| Integration WSL/SSH | disconnect during cancel, remote kill unconfirmed | truthful uncertain state + recovery, no false stopped |
| Integration VCS | task commits + dirty files, target advances, overlap/conflict, tree changes during checks | complete preview; conflict/stale verification blocks integration |
| Integration verification | claim pass/fail/no checks/timeout/cancel | verified only on policy success; evidence retained |
| CLI contract | UI+CLI simultaneous start, external/non-managed IDs, external Claude task path, event cursor gap, app absent, stale revision | same backend truth; managed-only rejection; typed JSON/recovery |
| E2E | two dependent Claude/Codex tasks → gate → checks → review | dependency respected; explicit gates; no automatic merge/push |
| E2E quit/restart | cancel quit dialog, confirm quit mid-run, reopen | cancel keeps work; confirm stops owned work; interrupted not replayed |

Implementation commands: focused orchestration property/integration tests, process-tree platform tests, VCS/session adapter tests, CLI golden JSON tests, focused frontend tests, generation/typecheck, full Go/frontend suites. Windows hardware required for Job Object/ConPTY tree validation; don't infer from Linux process groups.

## Success criteria

- [ ] Durable Run/Task/Attempt records survive restart; dependencies/gates deterministically control readiness.
- [ ] Run/task states match the documented truth table: claims never satisfy dependencies, required failures
      block for explicit recovery, and completed requires every required task verified or audited-waived.
- [ ] Two windows/CLI cannot double-start a task; configured run/app limits hold atomically.
- [ ] Completion claim never equals verification; task only verified with fresh passing evidence.
- [ ] Retry has a new immutable attempt; old events cannot change current status.
- [ ] Cancel/confirmed Quit reaps owned process tree with bounded escalation; unrelated process survives; uncertain remote status stays visible.
- [ ] Restart marks unresolved work interrupted and offers explicit resume/retry; no automatic replay.
- [ ] Complete agent changes and target divergence are reviewed; conflict blocks integration with user-facing recovery.
- [ ] No automatic merge/rebase/commit/push occurs in any test path.
- [ ] `wsh` and UI expose the same state/error/evidence model; CLI rejects non-managed processes/external
      Claude tasks and app absence without starting a backend or daemon.
- [ ] 2/run and 4/app concurrency defaults are enforced atomically with hard max 8; 2/4/8-agent measurements are recorded, and a measured failure can only lower defaults without a new decision.

## Risk / compatibility / rollback

| Risk (likelihood × impact) | Mitigation / stop response |
|---|---|
| Duplicate/incorrect scheduling: medium × critical | SQL reservation/revisions/idempotency + crash-point tests; disable scheduler/start endpoint on invariant breach |
| Process escape/orphans: high × critical | phase-1 owned tree, platform-specific groups/jobs, reconciliation; block Windows release without hardware proof |
| Agent claim trusted as done: high × high | claimed/verified split and stale-tree check; no green completion without evidence |
| Integration data loss: medium × critical | preview only by default, phase-6 explicit ops, no auto reset/merge/push |
| Feature complexity harms simple UX: medium × high | manual default, bounded limits, secondary board, one Go authority; telemetry-free local usability measurements |

Schema/RPC additive; no changes to external Claude task files. Feature flag may disable orchestration UI/new starts without stopping ordinary agents. Rollback first rejects new starts, lets user cancel/retain active owned attempts, preserves run/event/worktree/history read-only, then hides projections. Never delete worktrees/branches or downgrade DB automatically. Deep rebrand phase 9 follows and must include all new orchestration imports/env/prose.
