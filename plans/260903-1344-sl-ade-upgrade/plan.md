---
title: "SLTerm → SL-ADE: Tauri-only Claude/Codex ADE"
description: "Execution plan for a Windows-first lightweight Tauri/Go ADE with Claude/Codex sessions, review, worktrees and user-approved orchestration."
status: pending
priority: P1
effort: 30-44w
branch: feat/sl-ade-windows-shell-parity
tags: [feature, architecture, tauri, go, react, windows, claude, codex, orchestration]
blockedBy: []
blocks: []
created: 2026-09-03
---

# SLTerm → SL-ADE: Tauri-only Claude/Codex ADE

## Outcome

Turn SLTerm into **SL-ADE**: simple project-first desktop workbench for Claude Code and Codex, retaining the terminal/editor/tiling/pet strengths while adding reliable agent lifecycle, sessions, worktrees, review and deterministic multi-agent orchestration. Tauri remains a thin OS shell, Go owns business/persisted state, React/Jotai/xterm/Monaco owns UI. Windows first; macOS/Linux follow. Electron is removed. Bring-your-own CLI subscription; no cloud/mobile/inference business.

Current source baseline verified 2026-09-09: commit `f1e24c9`, branch `feat/sl-ade-windows-shell-parity`. Phase 1 has implemented historical checkmarks but hardware baseline/QA and owned descendant shutdown remain unchecked. No hardware validation was performed during this planning update. Read [architecture and UX contract](./architecture-contract.md) before any phase.

## Decisions and invariants

- Orchestration is now **inside this plan after foundations**, reversing the prior deferral. Serial order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 9**.
- Quit: ask once; cancel leaves work alive; confirm triggers bounded graceful shutdown of exact app-owned local/WSL/SSH process trees, escalation and reconciliation. No persistent daemon. `wavesrv` exit alone is not proof all agents stopped.
- Claude and Codex are first-class but capability-specific. Codex structured app-server mode is not a passive TUI tap; unsupported features stay visibly unavailable.
- Explicit resume never auto-falls through to continue/new. Provider identity includes account home, cwd, execution host and opaque provider session ID.
- Live terminal delivery remains ordered and byte-preserving with bounded backpressure; derivation buffers never delete duplicate lines. Durable capture uses acknowledged contiguous segments: a write timeout/full disk creates a visible gap and a new segment, never a falsely complete history. Cold-tab state comes from backend/provider observations, not frontend OSC alone.
- Tokens measured when evidenced; cost estimated with pricing revision; subscription quota separate; absent means unknown. Opt-in CLI summary sends supplied content to its provider upstream and failures remain visible.
- Worktree records starting ref/SHA, setup/ownership and committed+dirty review. It isolates edits, not OS permissions/secrets. No automatic environment-secret sharing.
- Git passive reads are hardened; trusted writes may use explicitly approved hooks/signing/auth helpers. Raw path identity is separate from escaped display.
- Review/comment input is draft-first; no unknown-TUI injection or auto-Enter. No automatic merge/rebase/commit/push.
- Default UX: project sidebar + work area + contextual review; agent board secondary. One command registry/config surface. English/Vietnamese, keyboard/IME/reduced-motion/accessibility required.
- Rebrand remains the **entire final phase**: none of phase 9's env/prose/copyright/module/repository work starts
  before phases 2–8 and 10 complete and no implementation branch remains open. Do not rename `wsh`, Wave
  socket names or keyring service `SLTerm` without a separate migration decision.

## Phase index

Phase status is derived from each file's checkboxes by AgentKit; this index does not duplicate a stale status table.

1. [Windows shell parity](./phase-01-windows-shell-parity.md) — 3–4w total; foundations and hardware/process lifecycle gate.
2. [Identity, signing, updater](./phase-02-identity-signing-updater.md) — 2–3w; depends 1.
3. [Retire Electron and shrink](./phase-03-retire-electron-and-shrink.md) — 2–3w; depends 1,2.
4. [Agent state and notifications](./phase-04-agent-state-and-notifications.md) — 3–4w; depends 3; Claude/Codex adapters and backend state.
5. [Session layer](./phase-05-session-layer.md) — 4–6w; depends 4; both providers, history/usage/explicit summary.
6. [Change review layer](./phase-06-change-review-layer.md) — 4–6w; depends 5; trust, Git, worktrees and complete review.
7. [ADE workspace UX](./phase-07-ade-workspace-ux.md) — 5–7w; depends 6; project-first workbench, onboarding/config/prompt UX/tear-off.
8. [Differentiators and polish](./phase-08-differentiators-and-polish.md) — 2–3w; depends 7; pet/keybindings/theme/IME/performance.
10. [Orchestration engine](./phase-10-orchestration-engine.md) — 4–6w; depends 8; durable Run/Task/Attempt, gates, verification, cancellation.
9. [Deep rebrand](./phase-09-deep-rebrand.md) — 1–2w; depends 2–8 and 10; last, no open implementation branch.

**Effort:** 30–44 maintainer-weeks, exactly the sum of phase frontmatter estimates. Phase 1's 3–4w is
total historical phase effort, not remaining work. Its remaining engineering is owned process-tree shutdown
plus real Windows/macOS baseline/QA; remaining elapsed time depends on hardware. Signing approval/provider
drift can add external waiting time, but no unallocated contingency is included in the effort total. Original
20–29w estimate excluded first-class Codex, complete supporting UX and orchestration and is retired.

## Delivery gates

- Phase 1 cannot complete or release-gate phase 2 until unchecked hardware and process-tree acceptance is recorded. Preserve its completed checkmarks; no inference from Linux/headless build.
- Phase 3 deletion requires phase-2 update round trip and captured Electron baseline. Once Electron is removed, rollback is release-channel fix-forward plus scoped revert, not wishful dual-shell support.
- Each phase owns shared RPC types/generated clients, SQL migration sequence, config/defaults and registry during its serial window. No parallel file ownership collisions.
- Every public/provider contract records CLI/app version. Re-run source discovery at phase start; cited paths are seams, not permission to skip fresh verification.
- Before each schema change: stop writers, verified backup, migration test. Rollback disables writes and preserves newer records/worktrees; restore backup only with explicit user consent.
- Narrow tests first, then generation/typecheck/full Go/frontend suites. Provider smoke tests and Windows/macOS/Linux hardware rows are separately evidenced. Unknown/blocked is never reported as pass.
- Release performance: Windows installer target ≤21MB; capture app-only and app+agents RSS, cold/warm startup, input/tab-switch p50/p95 at 1/10/25 tabs and 1/2/4/8 agents. No >10% p95 input/tab-switch regression versus matched phase-3 baseline without explicit acceptance.

## Whole-plan acceptance

- [ ] Signed where available, updateable Tauri-only app; Electron/runtime references gone; old data/secrets/update chain preserved.
- [ ] Windows real-hardware shell, ConPTY/WSL/IME/owned-process shutdown matrix passes; macOS/Linux follow documented matrix.
- [ ] Claude and Codex independently onboard, launch, show truthful cold-tab attention state, explicitly resume and expose provider-supported usage/config.
- [ ] Project/worktree/session identity never crosses account/home/host; restart marks unfinished work interrupted, never blindly replays.
- [ ] Agent edits, commits and uncommitted files are reviewable; trusted Git writes/auth work; no passive-read code execution or path-identity corruption.
- [ ] Default project-first UX, palette/search/config/prompt tools, contextual review, secondary board, tear-off and pet remain readable and measured.
- [ ] Orchestration persists deterministic dependencies/gates/attempts, respects bounded launch limits, verifies claims, cancels owned work and never auto-merges/pushes.
- [ ] Orchestration CLI controls only SL-ADE-managed/adopted runs and the documented Run/dependency truth
      table holds: claims do not unblock successors; completed requires verified or explicitly waived tasks.
- [ ] Quit cancellation preserves work; confirmed Quit reaps exact owned process tree or records truthful remote uncertainty; unrelated processes survive.
- [ ] Deep rebrand runs last and includes phase-10 packages/generated code; legacy compatibility keepers remain intentional.

## Validation and provenance

Canonical current inputs: source at `f1e24c9`, all phase files, local `/home/stackops/saly/claude-terminal`, official Orca docs linked in [architecture contract](./architecture-contract.md). Reports under `./reports/` are historical 2026-09-03 research only and include stale line ranges/claims; fresh source wins. Two attempted new researchers failed API 402 and supplied no evidence, so this revision makes no claim of renewed independent competitive research.

AgentKit limitation recorded honestly: `ak plan add-phase` created phase 10; current `ak plan phase update` manages index notes/evidence only and rejects file-owned content/title/status. It exposes no structural dependency/table editor. Therefore dependencies live in phase frontmatter and the short index links above; no status cells were directly toggled. Final `ak plan validate` checks format, not technical correctness. Runtime task hydration is controller-owned because this delegated runtime exposes no task-management surface.

### Planning verification results

- Freshly traced core seams: Tauri bootstrap/close/sidecar, Go shutdown/controller/spawn/output/wait, safe process helper, wstore migrations, RPC generation, command registry, workspace owner, WebSocket origin/header constraint.
- Material correction: Rust waits for `wavesrv`, while Go controller stop is asynchronous before `os.Exit`; phase 1 now contains explicit unchecked descendant-shutdown acceptance.
- Reconciled: orchestration included after phase 8; phase 9 depends on 10; Claude-only session/state design replaced by provider adapters; old board anti-scope and follow-on prose removed; historical import counts marked stale; current Windows named-pipe implementation is treated as an unverified hardware path, not planned again.
- Validation does **not** assert builds/tests/hardware ran during this plan-only update.

### Red-team review — accepted findings (2026-09-09)

Formal controller adjudication accepted all seven evidence-backed findings; all are applied:

1. Effort corrected to the exact phase sum `30–44w`; no hidden contingency.
2. Phase 1 now owns executable least-privilege CSP and `host_open_native_path` confinement with TODO,
   implementation and acceptance tests; generic renderer webview creation is explicitly absent.
3. Phase 4 has capture-health/gap/degraded semantics; loss of observations cannot become false idle/done.
4. Phase 10 `wsh` surface is managed-shell-only and never a headless daemon/arbitrary-process controller.
5. Phase 10 has an explicit Run state and dependency satisfaction truth table with table-driven acceptance.
6. All of phase 9—not only module/repository rungs—is gated last after phases 2–8 and 10.
7. This adjudication summary and the post-edit whole-plan consistency sweep are recorded here.

### Whole-plan consistency sweep

- Files reread after edits: `plan.md`, `architecture-contract.md`, and all ten `phase-*.md` files.
- Decision deltas checked: 7 accepted findings plus existing orchestration order, quit/no-daemon,
  Claude/Codex capability, lossless output, explicit resume, Git trust and no-auto-merge decisions.
- Reconciled stale references: generic `create-webview-window` grant, CSP/native-path notes without executable
  tasks, exact-state behavior during capture gaps, unrestricted CLI implication, undefined Run completion,
  split/early phase-9 wording and padded effort.
- Unresolved contradictions: **0**.
- Validation boundary: plan/link/dependency/text scans and AgentKit parse/validate only; no source build,
  provider smoke or hardware validation was run.

## Validation Log

### Session 1 — 2026-09-09
**Trigger:** User selected `/ak:plan validate` after the ten-phase plan and independent red-team corrections.
**Questions asked:** 7

#### Questions & Answers

1. **[Reliability]** When Claude/Codex lacks a verified hook or structured event, prioritize exactness or always predict state?
   - Options: Fail closed | Always predict
   - **Answer:** Fail closed.
   - **Rationale:** `unknown/stale` is safer than a false needs-you/done signal.
2. **[Failure mode]** What should happen when durable history storage times out or disk is full?
   - Options: Continue with visible gap | Stop for complete audit
   - **Answer:** Continue with visible gap.
   - **Rationale:** Preserve terminal responsiveness while making incomplete history explicit and fencing replay offsets.
3. **[Scope]** Must the first orchestration CLI work from an ordinary external PowerShell/cmd?
   - Options: Managed shell only | External shell support
   - **Answer:** Managed shell only.
   - **Rationale:** Reuse existing injected JWT/socket trust instead of adding a new local credential platform.
4. **[Verification]** How does a task without checks satisfy dependencies?
   - Options: Verified or audited waiver | Low-risk claim
   - **Answer:** Verified or audited waiver.
   - **Rationale:** Agent/process claims never become completion authority.
5. **[Capacity]** What concurrency defaults ship before hardware evidence?
   - Options: 2/run and 4/app, hard max 8 | 1/run and 2/app | Choose during onboarding
   - **Answer:** 2/run and 4/app, hard max 8.
   - **Rationale:** Bounded useful parallelism; Phase 10 may lower defaults after measurements but cannot raise the hard cap without a new decision.
6. **[Retention]** What local history/log defaults ship?
   - Options: 30 days / 10 MiB per launch / 500 MiB total | 7 days / 5 MiB / 200 MiB | Provider transcript only
   - **Answer:** 30 days / 10 MiB per launch / 500 MiB total.
   - **Rationale:** Useful local continuity with visible truncation and configurable limits.
7. **[Performance]** Keep the Windows installer target at ≤21 MB?
   - Options: Keep ≤21 MB | Raise to ≤30 MB
   - **Answer:** Keep ≤21 MB.
   - **Rationale:** Size remains a product constraint; if measured full scope misses it, report and ask rather than silently cut scope or move the target.

#### Confirmed Decisions

- Provider state detection fails closed to `unknown/stale` when authoritative evidence is absent.
- Storage failure keeps the live terminal running and creates a visible, fenced history segment gap.
- Initial orchestration CLI is available only in SL-ADE-managed shells.
- Dependencies require verified predecessors or an explicit audited waiver.
- Concurrency ships at 2/run and 4/app with hard max 8; measurements may only lower defaults without a new decision.
- Retention ships at 30 days, 10 MiB per launch and 500 MiB total, configurable with visible truncation.
- Windows installer target remains ≤21 MB.

#### Impact on Phases

- Phase 4: fail-closed state and continue-with-gap capture behavior locked.
- Phase 5: retention defaults locked.
- Phase 10: managed-shell-only CLI, verified/waiver dependency rule and concurrency defaults locked.
- Phase 3/8: ≤21 MB remains a measured release target.

### Whole-plan consistency sweep

- Files reviewed: `plan.md`, `architecture-contract.md`, all ten phase files.
- Validation decisions propagated to phases 3–5, 8 and 10 where applicable.
- Stale alternatives removed or identified as non-default recovery policies.
- Unresolved contradictions: **0**.

## Unresolved decisions

None blocking implementation. Provider/version capability support and real hardware performance remain evidence gates, not product decisions. If full scope misses ≤21 MB or the 2/run, 4/app defaults miss latency/resource budgets, report measurements and request a new decision rather than silently changing scope or thresholds.

<!-- slug: sl-ade-upgrade -->
