---
phase: 6
title: "Phase 6: Change review layer"
status: todo
priority: P1
effort: "4-6w"
dependencies: [5]
---

# Phase 6: Change review layer

## Overview / blockers

Close agent work → review → explicit commit/push with a Go Git layer, sticky changelists, worktree lifecycle, and Monaco diff. Preserve original named scope: stage/unstage/discard/commit, branch create/checkout, remote preview/push/pull/stash, graph/blame, worktree create/remove/open-agent. Serial dependency phase 5 includes foundations 1–4; launch/session identity now exists to attribute work. Read [architecture contract](./architecture-contract.md). Owner: VCS maintainer, sole owner of shared RPC/migrations/view registration/config in this phase.

## Requirements

- Explicit repository-open action grants scoped read access; separate trust confirmation authorizes writes/setup hooks. Neither block cwd/meta nor agent messages expand authorization. Trusted repository is **not a sandbox**.
- Canonical repository/worktree identity on execution host; server enforces containment before reads and mutations, including symlink/Windows case/UNC/junction/nonexistent target-parent cases. Paths in Git output retain raw identity separately from escaped display.
- Passive reads do not execute repo-controlled fsmonitor/textconv/external diff/hooks; trusted writes retain intentionally approved hooks/filters/signing/auth helpers. Use direct Git executable, safe argv and deadlines, not shell strings.
- Stage, unstage, partially staged checkbox; group operations reflect actual index, not local optimistic state. Sticky per-worktree changelists with synthetic undeletable Default; name trim/80-char/reserved/unique rules; assignment UPSERT, deletion cascade.
- Whole-file diff and staged/unstaged toggle; binary/new/deleted/rename/type-change/submodule summaries. 100KB rendered diff cap with visible larger-file explanation; raw retrieval bounded separately.
- Worktree create accepts explicit start ref and resolves immutable starting SHA. Async setup has pending/creating/setup-running/ready/failed/cancelled states, logs and explicit retry. No agent dispatch until ready.
- Review includes starting SHA→current HEAD plus staged/unstaged/untracked changes; `git diff HEAD` alone misses committed agent work. Attribution is best-effort based on owned worktree/attempt, not proof one author made every edit.
- No automatic environment/secret sharing. Setup commands are user-trusted executable code, displayed with cwd/env names and confirmation. Dedicated app-owned worktree root, no whole-parent default authorization.

## Architecture / data flow

User-opened repo → server trusted-root record → hardened read commands → parsed NUL-delimited identities/snapshot → VCS tree/Monaco. Mutation request includes repo ID, expected status/revision, operation and explicit confirmation → per-repo lock → canonical-path recheck + typed Git argv → exit/output receipt → fresh snapshot. Error stderr is escaped/bounded; credential values never logged.

One `pkg/vcs/gitexec.go` dispatcher has **read** and **trusted-write** profiles. Read profile neutralizes fsmonitor/external diff/textconv/pagers and environment config injection, disables optional locks/prompts, and uses only reviewed read commands. Do not promise `git add` is passive: filters execute during writes. Write profile requires execution trust, retains approved helper/hooks/filter behavior and bounded auth interaction; never stores credentials. Use explicit trust UI rather than silently disabling user signing/hooks to make tests pass. Tests prove passive reads create no sentinel; trusted write tests prove intentional hooks/auth still work. Raw leading-dash paths use `--` / literal pathspec handling; Git refs validated with Git's ref rules rather than invented invalid fixtures.

Worktree job → resolve starting ref/SHA → allocate under canonical configured root → create branch/worktree → persist identity/ownership → optional consented setup process → readiness. Existing worktree import checks Git's actual list and ownership. Remove verifies listed non-primary owned worktree, no running associated process and dirty/untracked state; forced remove separate confirmation. Interrupted setup is recoverable, never silently deleted. Cleanup does not remove branches/worktrees just because app exits.

Pull with stash is a multi-step workflow, **not an atomic transaction**. Save exact stash object ID and pre-operation refs; failure/conflict retains stash and recovery instructions. No automatic reset/pop retry or blind stash drop. Force push is only `--force-with-lease` after preview/confirmation and fresh lease.

## Files

Existing sources:
- `frontend/app/view/codeeditor/diffviewer.tsx:39` existing diff renderer; new consumer rather than second renderer.
- `pkg/util/procutil/procutil.go:38,55`, `procutil_windows.go:18` safe hidden process helper; `.ps1` is not a batch shim.
- `pkg/wshrpc/wshrpctypes.go:31`, `Taskfile.yml:228`, generated client/type files in architecture contract.
- `pkg/wstore/wstore_dbsetup.go:28-36`, next available `db/migrations-wstore/` pairs for repo grants/changelists/worktree lifecycle.
- `frontend/app/block/block.tsx:54-55` lazy registry pattern, existing widget/config schema files, phase-4 adapter launches and phase-5 session records.
New proposed:
- `pkg/vcs/{repo,trust,gitexec,status,stage,commit,remote,pull,stash,branch,worktree,setup,diff,changelists,display}.go` and focused tests. Split only as actual code size merits; no empty scaffolding packages.
- `pkg/wshrpc/wshserver/wshserver_vcs.go`; `frontend/app/view/vcs/{vcs.tsx,vcs-model.ts,changelist-tree.tsx,push-modal.tsx,worktree-modal.tsx}`.
Read-only reference: `/home/stackops/saly/claude-terminal/src-tauri/src/changelists.rs:2,16,326`, local `FileChangesPanel.tsx`, `ChangelistSection.tsx`, `PushModal.tsx`, `WorktreeModal.tsx` (UI references; reverify exact function lines before porting). Adapt tests/contract, not monolithic Rust logic.

## Steps

1. Write hostile-repo/path/read-vs-write trust tests and register canonical grants via explicit UI-owned action. Existing wsh generic meta cannot grant VCS rights; worker RPC permissions are narrower than UI grants. Same-user arbitrary code remains outside sandbox claim.
2. Implement typed command wrapper profiles, output/time caps, cancellation and operation receipts. Inventory command-specific execution side effects before allowing a command as passive.
3. Parse status `-z`, rename pairs and raw identity without lossy Unicode/control stripping; distinct display escaping. Handle unavailable Git, unborn HEAD, detached HEAD and nested repos explicitly.
4. Add staging/discard/commit/branch actions with index refresh and stale-revision rejection; private commit message tempfile (0600 Unix, user-only ACL Windows), deleted afterwards.
5. Add remote preview/push/pull/stash; progress and recoverable conflict states; helpers/signing remain user-owned, timeout doesn't imply atomic rollback.
6. Persist sticky changelists with reference behavioral tests adapted to Go and real SQLite; reconcile rename/deleted paths without mutating unrelated entries.
7. Build Monaco whole-file diff, limits and type states. Add graph/blame as bounded, paginated passive reads. No new full Git client/rebase engine.
8. Implement worktree create/setup/retry/cancel/remove and starting SHA receipts, then launch Claude/Codex through phase-4 adapter after readiness. Worktree setup process shares owned-process registry.
9. Build composable VCS surface and trust/consent UI; all mutations awaited and statuses refreshed. Add source-range review for committed + current edits and integration receipts consumed by phase 10.

## Test matrix

| Level | Cases | Result |
|---|---|---|
| Unit | porcelain rename/NUL/leading dash/non-UTF8/control chars; valid ref with metacharacters | exact raw path preserved, safe display/argv |
| Unit | symlink escape/junction/case/UNC/nonexistent parent; forged block cwd | no grant expansion or outside write |
| Integration real temp repos | fsmonitor/textconv/external diff sentinels on status/diff/blame | no repo code execution for passive reads |
| Integration trusted repos | commit hook/signing/helper/filter enabled with consent | expected behavior works, bounded failure visible |
| Integration | partial stage, sticky list, deleted list, rename, two worktrees | index truth and isolated assignment persist |
| Integration | worktree async setup fail/retry, duplicate request, starting ref moves, committed+dirty edits | idempotent create; captured SHA stable; complete review |
| Integration | dirty pull/stash-pop conflict/push lease rejection/disk full | no work/stash loss; actionable recovery |
| E2E Windows then macOS/Linux | status→review→stage→commit→push, worktree→both providers | normal workflow stays in app, unrelated files/processes untouched |

Commands at implementation: `go test ./pkg/vcs` with real Git fixtures; focused frontend suites; migration tests; `task generate`, typecheck, full Go/frontend tests. Remote/credential helper smoke needs controlled test account, never production secrets in fixtures.

## Success criteria

- [ ] Passive reads execute no sentinel; trusted commit/push retains approved hooks/auth and reports failure honestly.
- [ ] Raw path and escaped display identities remain distinct end-to-end; control characters cannot inject PTY input.
- [ ] All Git mutations require authorization, expected revision and confirmation where destructive.
- [ ] Changelist rules, partial staging, graph/blame and bounded Monaco diff work on supported OSes.
- [ ] Worktrees record start SHA/ref, setup lifecycle, ownership and cleanup outcome; no auto env/secret copying.
- [ ] Agent commits plus unstaged/staged/untracked edits are all visible in review.
- [ ] Pull/conflict failure preserves exact stash/worktree state and gives manual resolution guidance.
- [ ] Claude and Codex launch only after chosen worktree is ready; removal refuses active work.

## Risk / compatibility / rollback

High × high: data loss from stale index/remove/pull → per-repo lock, expected revision, explicit confirmation, retained stash refs and destructive-operation tests. Medium × high: repository-controlled executable hooks → passive/trusted-write profiles, explicit trust; do not call worktree a sandbox. Medium × high: auth stalls → approved bounded helper flow, visible terminal-assisted recovery. Medium × medium: status cost → one coalesced refresh per root, focus/file-change refresh, pagination; never poll per block.

Additive new tables/optional VCS view preserve existing workspaces. Rollback disables VCS mutations/setup first, stops only owned setup jobs, preserves worktrees/branches/stashes/changelists and opens them in terminal; never auto-delete to undo a failed phase. SQL downgrade is backup-based with user consent. Phase 7 adds contextual review UX/hunks; phase 10 reuses this worktree/readiness/integration service.
