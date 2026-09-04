---
title: "SLTerm → SL-ADE: Tauri-only ADE upgrade"
description: "Finish the Tauri shell on Windows, ship it signed and self-updating as SL-ADE, delete Electron, then build the agent-state, session and change-review layers that make it an ADE."
status: pending
priority: P1
effort: 20-29w
branch: main
tags: [feature, infra, frontend, backend, windows, rebrand, ade]
blockedBy: []
blocks: []
created: 2026-09-03
---

# SLTerm → SL-ADE: Tauri-only ADE upgrade

## Overview

One runtime, one platform priority, one product identity. SLTerm's Tauri shell already ships
(`tauri-v0.20.0`, **the Latest release**) at 24.1 MB Windows / 24.6 MB deb against Electron's 123.1 /
97.6 — but it has never been launched on Windows, has **no titlebar at all**, no app menu, no updater
and no signature. This plan closes that gap first, promotes the Tauri line to the only line, and then
spends the freed maintenance budget on the ADE capabilities SLTerm lacks: agent state, session
resume, and change review.

Positioning, from the landscape research: the local-orchestrator ADE segment is led by **Orca**
(stablyai/orca, 60.6k★, MIT, Electron, **172 MB** on Windows). SL-ADE's defensible wedge is already
built — **~7× smaller**, Windows-first, and the only product in the category with a personality
layer (the pet). The gap to close is the table stakes, not the differentiators.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | The Tauri shell is fully usable on Windows: titlebar, menu, dialogs, single-instance, keys | P1 |
| 2 | It ships as **SL-ADE**, signed where possible, with a working auto-update channel | P1 |
| 3 | Electron is deleted; one runtime, one tag scheme, a measured size/RAM win | P1 |
| 4 | An agent's state (working / needs-you / done / idle) is visible without clicking into it | P1 |
| 5 | Claude/Codex sessions resume, with history and real token+cost numbers | P1 |
| 6 | Agent changes are reviewable in-app: status, diff, changelists, commit, push, worktrees | P1 |
| 7 | ADE workspace UX: command palette, worktree-bound workspaces, agent board, tear-off | P2 |
| 8 | SLTerm's own differentiators (pet, keybindings, IME correctness) stop being half-wired | P2 |
| 9 | The rebrand finishes down to env vars, module path and repo name | P3 |

## Phases

| # | Phase | Est. | Depends on | Status |
|---|-------|------|-----------|--------|
| 1 | [Windows shell parity](./phase-01-windows-shell-parity.md) | 3-4w | — | Pending |
| 2 | [Identity, signing, updater](./phase-02-identity-signing-updater.md) | 2-3w | 1 | Pending |
| 3 | [Retire Electron and shrink](./phase-03-retire-electron-and-shrink.md) | 2-3w | 1, 2 | Pending |
| 4 | [Agent state and notifications](./phase-04-agent-state-and-notifications.md) | 1-2w | 1 | Pending |
| 5 | [Session layer](./phase-05-session-layer.md) | 3-4w | 4 | Pending |
| 6 | [Change review layer](./phase-06-change-review-layer.md) | 3-4w | 1 | Pending |
| 7 | [ADE workspace UX](./phase-07-ade-workspace-ux.md) | 3-4w | 1, 4, 5, 6 | Pending |
| 8 | [Differentiators and polish](./phase-08-differentiators-and-polish.md) | 2-3w | 1, 4 | Pending |
| 9 | [Deep rebrand](./phase-09-deep-rebrand.md) | 1-2w | 2, 3 (rungs 1-3) · 2-8 (module path + repo rename) | Pending |

**Order is serial.** The 20-29w total is the sum of the phase estimates for one maintainer, so there is no
parallelism to spend. Two constraints make that more than a scheduling preference: phase 3 exists because
maintaining two shells taxes every frontend change, so landing new frontend surfaces before 3.3 pays that
tax twice; and phase 9's module-path rewrite plus repo rename must run with no other branch open. If work
does run ahead of phase 3, keep it to Go-only slices (`pkg/`, `wshrpc`).

## Cross-Plan Dependencies

| Relationship | Plan | Note |
|-------------|------|------|
| Supersedes | `260821-1912-slterm-upgrade` | Its phases 0-3 and 7 are **done**; its unbuilt phases 4 (Claude layer), 5 (VCS), 6 (pet/keybindings/polish) are absorbed here as phases 4-6 and 8. That plan stays as the historical record of the Electron→Tauri migration and its measurements. |

## Constraints (user-decided — do not re-litigate)

- **No Electron.** The Tauri + Go build is the product.
- **Rust owns zero business logic.** Windows, menus, tray, dialogs, shortcuts, updater only. Logic
  lands in Go under `pkg/` or in the React frontend.
- **Windows is the priority platform**, then macOS, then Linux.
- **Rebrand to SL-ADE**, gradually. Collision note recorded in phase 2; the name is the owner's call.
  Frozen identity includes the **repository name**, because the updater endpoint embeds it.
- **Keep the pet.** It is the only personality layer in the category.
- Web-block loss (iframe, no `<webview>`) is accepted.
- Never sell inference, build cloud VMs, or ship a mobile relay (see phase 7 anti-scope).

## Success Criteria

- [ ] A Windows user can install, move, maximise and close the window, use the app menu, and update in place
- [ ] `emain/` and every Electron dependency are gone; `v*` tags build exactly one runtime
- [ ] Windows installer ≤ 21 MB (from the measured 24.1 MB) and idle RAM measured against a **captured**
      Electron baseline, published in the README
- [ ] Every agent block shows a state glyph; a `waiting` transition raises an OS notification once
- [ ] A past Claude session resumes from the UI, with token and cost figures on screen
- [ ] `git status` → stage → commit → push, and reviewing a diff, never require leaving the app
- [ ] One command palette reaches commands, files, sessions and worktrees
- [ ] Pet XP advances from real shell activity and survives a restart
- [ ] No plan phase leaves a UI affordance that silently does nothing

## Research

`/home/stackops/saly/plans/reports/` — `researcher-260903-1211-{ade-landscape,tauri-windows-shell,rebrand-sl-ade}.md`,
`scout-260903-1211-{claude-terminal-inventory,slterm-seams,ade-capability-gap}.md`. Copies in `./reports/`.

## Red Team Review

Four hostile reviewers (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope &
Complexity Critic), each carrying a verification role and required to cite `file:line`. 21 findings, all
passed the evidence filter, all accepted and applied. The ones that changed the plan's substance:

| # | Finding | Applied to |
|---|---------|-----------|
| 1 | **The Monaco worker cut is already done and shipped** — `monaco-env.ts:17-52` is the custom entry, the built bundle has exactly two workers, mermaid is already lazy-imported. Every "44 MB / 26.5 MB / 13 MB ts.worker" figure was stale (real: 26 MB staged, 6.9 MB monaco chunk). | phase 3 rewritten: verify the two-worker set survives the build migration, re-target the shrink at the 6.9 MB chunk, size gate becomes ≤ 21 MB not ≤ 30 MB |
| 2 | **The confinement set cannot come from `cmd:cwd`** — meta is writable via `wsh setmeta` from inside any block, so one line in a hostile build script widens the git layer's trust boundary to `/`. | phase 6: allowlist of user-opened repo roots, server-side, never from meta; `EvalSymlinks`; a test that `setmeta` cannot widen it |
| 3 | **git executes code from the repo it is pointed at** (`core.fsmonitor`, `textconv`, `filter.clean`) — `os/exec` does nothing about that. | phase 6: one hardened `gitexec.go` wrapper; the fixture test now asserts a sentinel file was *not* created |
| 4 | **Tear-off via a JS-created webview + `js_init_script` would hand the auth key to an attacker-controlled page**, and `ws.go:65` accepts any Origin, so that key is RCE. | phase 7: one narrow Rust `host_tear_off_tab` with a fixed app URL; no `create-webview-window` grant; `Origin` validation added |
| 5 | **A tag-pinned updater endpoint can announce exactly one release.** | phase 2: endpoint frozen as `/releases/latest/…`, Electron releases marked prerelease, CI asserts the string never changes, and 2.10 proves **two** hops |
| 6 | **The rename has no channel to reach the installed base** — two products end up sharing `~/.slterm` and the symptom is a raw lock error. | phase 2: `NSIS_HOOK_PREINSTALL` uninstalls the old install; lock contention gets a named message |
| 7 | **macOS would ship with no window controls and Linux with buttons in a 6 px gap** — the 139 px reservation is gated on `isWindows()` and there is no `isLinux()`. | phase 1: per-OS window construction, macOS keeps native traffic lights, `isLinux()` added, QA rows per platform |
| 8 | **`window:nativetitlebar` defaults to `true` with zero consumers** — honouring it as written makes the new titlebar dead code by default. | phase 1: default flipped, Rust reads `<config>/settings.json`, px reservations gated on the same value |
| 9 | **The sidecar kill sits behind an unverified event and a newly interactive close path.** | phase 1 adds `shutdown_backend()` + an update-in-progress bypass; phase 2 calls it before `install()` and tests unattended |
| 10 | **`block:jobstatus` never fires for the agent widgets** (they are `controller: cmd`) and the buffer-based classifier cannot see blocks outside the warm-tab cap (default 2). | phase 4: controller runtime status as the `stopped` source; explicit signals as the cold-block path; the boundary stated in requirements |
| 11 | **The `host` wshrpc route dies with `emain/`** — its only registrant is `initElectronWshrpc`, and the terminal bell and `wsh notify` both use it. | phase 3: a Tauri `initHostWshrpc` lands *before* the deletion; phase 4 hangs notify off it |
| 12 | **`encode_cwd` also maps `.` to `-`** (verified against a real `~/.claude/projects` listing), and a UUID-named *directory* lives there. | phase 5: resolve by the `cwd` recorded inside the JSONL, encoder as a fast path, `*.jsonl`-only snapshot |
| 13 | **Session records would get a start and never an end** — the cited hook sites are start-path gates, not transitions. | phase 5: emit stop from `shellcontroller.go:608` / `Controller.Stop`, with a kill-the-child test |
| 14 | **The Electron RAM baseline was never captured** and phase 3 deletes the ability to capture it. | phase 1 gains step 1.11 (capture from the published `v0.20.0`); phase 3's gate requires the file |
| 15 | **Phase 9's module rewrite and repo rename cannot run at 2-3** — they conflict with every open branch, and the repo name is baked into the updater endpoint. | phase 9 frontmatter now `[2..8]`, rung 4 marked last-in-plan, 9.7 gated on the endpoint |
| 16 | **The "phases 4-6 in parallel" note contradicted phase 3's own rationale** and bought no schedule. | plan.md: order is serial; pre-phase-3 work limited to Go-only slices |

Also applied: worktree paths given an explicit `vcs:worktreeroots` policy instead of an implicit
confinement exemption (phase 6); `-z` porcelain plus one PTY/UI sanitiser so a filename containing CR, LF
or ESC cannot inject into an agent's prompt (phases 6 and 7); phase 6 re-declared `dependencies: [1]`
because it relies on phase 1's exec helper; and the hand-launched-agent boundary (`claude` typed into a
plain shell block) decided explicitly in phase 4 rather than left between phases.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md` + all nine `phase-*.md`
- Decision deltas checked: 16
- Reconciled stale references: 9 (size figures, Monaco entry, `js_init_script`, dependency table rows 6
  and 9, the parallelism note, the `≤ 30 MB` gate, `block:jobstatus` citation, `encode_cwd` rule)
- Unresolved contradictions: **0**

<!-- slug: sl-ade-upgrade -->
