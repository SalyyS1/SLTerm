---
phase: 7
title: "Phase 7: ADE workspace UX"
status: todo
priority: P2
effort: "5-7w"
dependencies: [6]
---

# Phase 7: ADE workspace UX

## Overview / blockers

Assemble a simple workbench, not a dashboard-first platform: project sidebar, terminal/editor work area, contextual review. Integrate Claude/Codex onboarding/configuration, palette/search and prompt ergonomics with the existing blocks. Retain board, worktree binding, tear-off, pins and hunk review scope. Orchestration is approved in phase 10 after this foundation, not deferred outside the plan.

Read [architecture contract](./architecture-contract.md). Blockers: phases 1–6 complete; canonical provider/session/worktree services ready. Owner: workspace maintainer; sole owner of shared shell/workspace/registry/config/RPC files. Estimate includes named supporting UX rather than hiding it in polish.

## Requirements

- Project sidebar shows worktrees and agent attention, expandable file explorer and session navigation. Work area reuses terminals, Monaco editor and file/web previews; review drawer opens contextually. Board secondary but available without experimental flag, by palette/keybinding.
- Workspace binding stores stable host/repo/worktree context; cwd defaults apply only to **new** blocks. Never silently retarget running agents when user changes workspace binding. Existing unbound workspace remains valid.
- Palette reaches commands, files, blocks, sessions, worktrees and snippets; project file-content and session-history search has limits, cancellation, ignore rules and explicit truncation. Reuse existing Go fuzzy matcher; avoid second command registry/launcher.
- Claude/Codex onboarding independently detects executable/version/auth readiness/capabilities, shows explicit install/login/update steps and launch profiles. No automatic package installation or secret harvesting.
- Extend existing AI-tools for provider-specific settings, memory, skills, subagents/commands, hooks and MCP where supported. Scope badges distinguish global/project/subdir/account/host. Config writes preserve unknown keys/comments where format allows, external edits and user hooks.
- Prompt composer, snippets and paste-as-file allow preview/edit/reuse before sending. Clipboard files are private, bounded, self-ignored only with consent; no automatic capture of sensitive clipboard. Review comments are drafts bound to session/generation/revision, never blindly written into unknown TUI or followed by auto-Enter.
- Package-script runner opens an owned sibling terminal; preview reuses web block with trusted URL policy. Project scripts require execution trust and lifecycle cleanup, not automatic startup.
- Board shows both providers, source/freshness, workspace, session age, measured/unknown usage, review state and click-to-focus. External Claude teams remain read-only observations, not orchestration tasks. PR/MR filters may show unknown/offline; use existing authenticated CLI only with explicit consent, not an invented account service.
- Tear-off and reattach preserve stable tab identity/layout, one active render owner per tab, and backend event subscriptions. Closing detached window doesn't quit/kill agents; app Quit confirms for all owned work. Pins and pane ratios persist.
- Hunk stage/reject checks reviewed content revision. Reject/discard destructive, explicit confirmation; conflicts preserve work. No source attribution by guess when multiple agents share cwd.

## Architecture and data flow

Backend project/worktree/session snapshot → sidebar + work area selection → command registry action → existing RPC services. Workspace meta is context only, not repository authorization. Workspace creation/storage already exists (`pkg/wcore/workspace.go:51,201,242`); avoid replacing persisted layout model.

Command registry already implemented (`frontend/app/store/commands.ts:49,61,71,87`), registered from `keymodel.ts:665`; menu invokes `runCommand` at `appmenu.ts:230-231`. Keep these signatures; palette is a consumer. File suggestions use existing `pkg/suggestion`; search adds bounded query APIs rather than scraping terminal screens.

Config read → provider/scope model → diff editor → schema validation + content hash compare-and-swap → atomic save/backup → explicit restart/reload requirement. Existing AI-tools read/write path `pkg/aitools/aitools_config.go:83,114,148,163,180`; MCP reader `:47`; extend, do not fork another config editor. Codex AGENTS/config scopes are adapter-specific, not Claude aliases.

Tear-off: narrow native command accepts existing tab ID, obtains app-approved window data and constructs fixed app-local URL with private init script; no arbitrary URL or renderer webview-create capability. Current init script `src-tauri/src/lib.rs:258,365`, close handler `:433-443` and exit `:459-468` require per-window versus app lifecycle separation. Global close-confirmed state `:44` cannot authorize all future windows accidentally. Backend owns transfer transaction/version; target subscribes then acknowledges, source unmounts; failure returns tab to original owner.

WS hardening must respect browser reality: `frontend/util/wsutil.ts:19-23` cannot set custom headers in browser WebSocket; do not propose header-only auth. Enforce origin allowlist and per-window authenticated short-lived connection ticket via an authenticated HTTP/bootstrap path (new design), redact URL tickets and expire/replay-protect them. Existing `pkg/web/ws.go:65` allows every origin; `pkg/web/web.go:517` has shell origin table. Origin protects browser cross-origin abuse, not same-user native attackers. Preserve CLI/socket authentication separately; no assumption Origin is a credential.

Review draft → escaped file/range + user text → preview → explicit selected target/mode validation → copy or acknowledged structured submit. TUI insertion permitted only explicit paste into confirmed prompt-ready target, without Enter; otherwise copy-only. Sanitized display never substitutes for raw Git identity.

## File inventory

Existing modify:
- `pkg/wcore/workspace.go:51,201,242`, `pkg/waveobj/wtype.go` workspace model; prefer additive meta and backend trust IDs, not duplicate project database.
- `frontend/app/store/commands.ts:49`, `keymodel.ts:665`, `appmenu.ts:230`; existing launcher and workspace/tab/layout surfaces; `frontend/app/block/block.tsx:54-55` registry.
- `pkg/aitools/aitools_config.go:47,83,163`, existing `frontend/app/view/aitools/aitools.tsx`, `pkg/agentteams/agentteams.go:103,161`, `frontend/app/view/agentteams/agentteams.tsx`.
- `src-tauri/src/lib.rs:258,433,459`, `src-tauri/capabilities/default.json`, `frontend/util/{tauri-host,wsutil,endpoints}.ts`, `pkg/web/{ws,web}.go:65` / `:517`.
- Existing `frontend/app/view/preview/`, `frontend/app/view/codeeditor/diffviewer.tsx:39`, phase-6 VCS files, provider/session files from phases 4–5; RPC/schema/defaults/generated artifacts in architecture contract.
New proposed:
- `frontend/app/workspace/project-sidebar.tsx`, `frontend/app/palette/palette.tsx` and source modules; `frontend/app/modals/agent-setup.tsx`; provider profile/config components inside existing AI-tools view.
- `frontend/app/view/vcs/review.tsx`, `frontend/app/prompt/{composer,snippets,paste-as-file}.tsx`; new Go bounded `pkg/projectsearch/` and prompt storage helpers only if existing storage cannot serve them.
- `src-tauri/src/tearoff.rs`, `frontend/app/tab/tearoff/{tear-off,drop-routing}.ts`; targeted tests for window ownership/auth.
- New SQL migrations only for durable records not already expressible in workspace/meta/session stores; reserve sequence serially.
Read-only references: `/home/stackops/saly/claude-terminal/src/components/{SetupWizard,CommandPalette,MemoryEditor,PromptEditorDrawer,PasteAsFileDrawer,SnippetsModal,ScriptsMenu}.tsx`; source paths verified from local inventory, exact component symbols [UNVERIFIED] until implementation. Use UX behavior, not monolith copying.

## Steps

1. Prove multi-client backend behavior with two clients and duplicate/reconnected subscribers; define tab ownership transfer and per-window focus/notification rules before tear-off UI. If premise fails, fix backend within this scope, do not silently drop tear-off.
2. Add worktree workspace binding and sidebar context with new-block cwd defaults, persistent pane ratios and keyboard navigation. Don't mutate active cwd/session on switch.
3. Build onboarding/profile UI on phase-4 capabilities; both providers independently usable. Surface auth/install failures and provider update re-probe.
4. Expand AI-tools config/memory/MCP with scope picker, validation, diff/CAS save, managed hook protections and provider-specific supported concepts. Test external editor race.
5. Palette over existing registry/suggestion services; consolidate widget launcher as visual catalog, not competing search. Add bounded project/session search and file explorer/editor context.
6. Composer/snippets/paste-as-file and scripts/preview: explicit trust, private retention, no auto-Enter, missing prompt readiness → copy fallback. Cleanup script process with its owner.
7. Build secondary board from managed-launch snapshots; external teams in distinct observed section. Link stable IDs, not ambiguous cwd matching. Show unknown attribution/PR/usage instead of fabricated state.
8. Implement secure tear-off/auth tickets and reattach transaction, window-specific close state/capabilities, DPI-correct pointer dragging and file-drop coexistence. No general renderer webview creation grant.
9. Add pins and hunk review/comments with stale-hash protection. Diff baseline includes commits as defined in phase 6.
10. Accessibility/i18n/empty-error states and measurements: sidebar collapses at narrow widths, reduced motion, no pet/control overlap. Keep one obvious launch and review entry point.

## Test matrix

| Level | Cases | Expected |
|---|---|---|
| Unit | palette rank/source cancellation; unknown command; scope merge/CAS | correct action, bounded results, no config clobber |
| Unit | draft contains CR/LF/ESC filename; wrong session/generation | safe preview and refusal, no automatic submit |
| Integration | two clients transfer/reconnect/window crash | one tab owner, recoverable original layout, no duplicate launch |
| Integration | ticket expiry/replay, untrusted Origin/child URL, CLI socket | browser denied appropriately; CLI unaffected |
| Integration | external config edits, MCP unknown fields, missing one CLI | conflict shown; unsupported provider fields not fabricated |
| E2E | project→both providers→search→review→comment draft→commit | discoverable workbench; no unknown TUI injection |
| E2E | tear-off/reattach/close, 100–200% DPI, native file drop | same tab identity; detached close not global quit |
| E2E | 25 tabs/10 active streams, IME, keyboard-only, Vietnamese, reduced motion | bounded resources, input/review usable, no hidden actions |

Implementation gates: focused workspace/config/auth tests, real SQLite migration tests, generation + typecheck, full Go/frontend suites and native multi-window tests. Hardware results are recorded separately, not assumed from compilation.

## Success criteria

- [ ] Default project sidebar/work area/contextual review is usable without opening a board.
- [ ] Both providers onboard, configure at correct scope, launch and resume through shared adapters.
- [ ] Palette and bounded project/session search reach actual objects; no second command registry.
- [ ] Composer/snippets/pastes/scripts/preview obey trust and owned-process lifecycle.
- [ ] Existing unbound layouts remain intact; workspace switches don't retarget running agents.
- [ ] Board supports managed Claude/Codex with truthful unknowns and separate external teams.
- [ ] Tear-off/reattach/pins survive restart; detached close doesn't quit; app Quit includes all owned work.
- [ ] Stale hunk mutation refused; review comment always drafted and explicitly sent/copied.
- [ ] Auth credentials absent in external frames; browser handshake rejects replay/untrusted origin.

## Risks / compatibility / rollback

Medium × high: shared-window state/auth → transaction/short-lived tickets, label-scoped native commands and attack tests; block tear-off release until proven. Medium × high: config overwrite → CAS/backup/atomic writes; stop save on conflict. High × high: TUI automation mistakes → draft-first, exact target/generation, no auto-Enter and copy fallback. Medium × medium: crowded UI → contextual review, secondary board, reuse existing chrome; measure attention/task completion before adding panels.

Workspace fields additive; old widgets/AI-tools routes remain compatible and redirect into consolidated surfaces. Rollback disables new navigation/window creation, reattaches tabs, keeps durable layouts/drafts and provider config backups. Never delete user provider config to roll back UI. No autonomous scheduler here; next phase 8 polishes foundations, phase 10 adds approved orchestration.
