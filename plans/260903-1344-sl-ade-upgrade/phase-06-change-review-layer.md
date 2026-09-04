---
phase: 6
title: "Phase 6: Change review layer"
status: todo
priority: P1
effort: "3-4w"
dependencies: [1]
---

# Phase 6: Change review layer

## Overview

Close the loop an ADE exists to close: an agent edits files, and you review, group, stage, commit and
push those edits without leaving the app. SLTerm has **none** of this today — no `pkg/vcs`, no git RPC,
no VCS view, and its Monaco diff component has zero consumers. This phase builds the Go git layer, the
path-confinement trust model, IntelliJ-style changelists, and the `view:vcs` block that presents them.

Independent of phases 2-3 — nothing here touches the shell — but **gated on phase 1's hardened exec
helper**, because spawning git without it is how the injection class gets reintroduced.

## Key Insights

- **The diff renderer already exists and is dead code.** `frontend/app/view/codeeditor/diffviewer.tsx`
  wraps Monaco's diff editor with an inline toggle and the `editor:inlinediff` setting, and grep finds no
  consumer anywhere. Nothing produces `original`/`modified` because there is no git blob reader.
  `pkg/filebackup` is save-time backup, never wired to a diff.
- **`os/exec` closes argv injection but not the bigger hole: git runs code from the repo it is pointed
  at.** `core.fsmonitor`, `diff.<name>.textconv` with a `.gitattributes` mapping, `filter.<name>.clean`
  and `core.hooksPath` are all read from a repository's own config, and git spawns them itself — argv
  quoting is irrelevant. A first automatic `git status` on a hostile clone is enough. Every invocation
  must therefore go through one wrapper that passes
  `-c core.fsmonitor= -c core.hooksPath=<empty> -c core.pager=cat -c core.askPass= -c credential.helper= -c diff.external= -c protocol.ext.allow=never --no-optional-locks`,
  sets `GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=`, and uses
  `--no-textconv` on diff and blame. Two rules from the reference still apply on top: **spawn `git.exe`
  directly** (never through `cmd /C`, which reopens the metacharacter hole on Windows) and set
  `CREATE_NO_WINDOW` so no console flashes.
- **The confinement set must not be derived from `cmd:cwd`.** A block's cwd is a meta key
  (`durableshellcontroller.go:234`), meta is writable over RPC with no allowlist
  (`pkg/wshrpc/wshserver/wshserver.go:148-156` `SetMetaCommand` → `wstore.UpdateObjectMeta`), and the CLI
  to write it ships inside every block (`cmd/wsh/cmd/wshcmd-setmeta.go:20`). One line in a hostile repo's
  build script — `wsh setmeta -b this cmd:cwd=/` — would widen the trust set to the whole filesystem.
  Derive the set from repo roots the **user** explicitly opened in a `view:vcs` block, recorded
  server-side and never updated from meta.
- **Confinement must resolve symlinks.** `filepath.Clean`/`Abs` plus a `..` reject cannot detect a
  symlink pointing out of the tree; use `filepath.EvalSymlinks` on the resolved path.
- **Worktree paths are the one legitimate exception to confinement**, and it has to be written down
  rather than discovered: a new worktree is by definition outside every existing block cwd (the
  conventional layout is a sibling `../repo.worktrees/feature-x`) and does not exist yet, so resolution of
  the leaf fails outright. Without an explicit policy the implementer will exempt the worktree RPCs, which
  turns `git worktree add` into an arbitrary-location directory write and `remove --force` into a delete.
- **`git status --porcelain` paths are relative to the repo root, not the block's cwd**, and porcelain v1
  C-quotes unusual names. Use `--porcelain=v1 -z` (and `-z` on `diff --name-status`) so paths arrive as
  opaque byte strings, then never treat a path as displayable text without sanitising it: git permits any
  byte except NUL and `/` in a component, including CR, LF and ESC.
- **Commit through `git commit -F <tempfile>` with 0600 perms.** The reference writes a world-readable
  temp file; that is a defect not to inherit.
- **Changelists are a small, complete spec** worth porting rule-for-rule from
  `claude-terminal/src-tauri/src/changelists.rs` (330 LOC, ~185 of it tests):
  - `Default` is **synthetic** — any file with no row belongs to it; it is never created, never
    persisted, never deletable, and is prepended to every list.
  - Names: non-empty after trim, ≤ 80 chars, `"Default"` reserved case-insensitively,
    `UNIQUE(repo_path, name)` so the same name may exist in two repos.
  - Assignment is an UPSERT on `(repo_path, file_path)` — a file moves, never duplicates. Assigning
    `null` deletes the row, i.e. back to Default.
  - Deleting a changelist cascades its file rows.
  - **Worktrees isolate for free** because `repo_path` is the worktree path.
  - Mappings survive commits because nothing deletes rows on commit. That is the whole of "sticky".
- **The checkbox semantics are the contract, not decoration:** checked = staged, unchecked = unstaged,
  indeterminate = partially staged. Group checkboxes act on the group. Files named after Windows
  reserved devices (`nul`, `con`, …) cannot be indexed by git — disable their checkbox and skip them in
  group toggles. That guard comes free by copying, and matters on the priority platform.
- **`pullWithStashConfirm` is the right division of labour**: call pull with `autoStash: false`; if the
  error says the working tree is dirty, ask the user, then retry with `autoStash: true`. The backend owns
  stash/pull/pop atomicity; the frontend owns consent only.
- **Cap the diff.** The reference stops at 100 KB and flags binary / new / deleted separately.
- **Worktrees are the ADE's isolation primitive.** Every serious product in the category isolates an
  agent per worktree or per branch, and "open an agent terminal in this worktree" is the single action
  that turns worktree management into a workflow. Detect a worktree by comparing `git-dir` with
  `git-common-dir`.
- **Two cheap wins the category leader lacks:** git graph (18 reaction-votes on its tracker) and blame
  (13). Both are read-only and land naturally once the git layer exists.
- **Where the code goes:** new RPC families append to `WshRpcInterface`
  (`pkg/wshrpc/wshrpctypes.go`, interface closes at `:215`), following the pet / ai tools / agent teams
  grouping. `pkg/service`'s `ServiceMap` is the older mechanism and only needed for bootstrap-time
  synchronous calls.

## Requirements

**Functional**

- For a block in a git repo: see changed files grouped as Changes / named changelists / Unversioned,
  stage and unstage per file and per group, commit, push, pull, stash, discard.
- View a file's diff, staged or unstaged, inline or side-by-side.
- Create, rename, delete changelists and move files between them; assignments survive commits.
- List, create and remove worktrees, and open an agent block directly in one.
- Nothing outside the user-opened repo-root allowlist can be read or written through these RPCs, and the
  allowlist cannot be widened by anything running inside a PTY.
- Worktree create/remove operate under an explicit, separately-validated root policy, not an exemption.
- A hostile repository's own config cannot cause git to execute anything.

**Non-functional**

- All git work in Go; no Rust, no shell interpolation.
- A repository whose branch and file names contain shell metacharacters is handled safely, and a
  repository carrying a poisoned `core.fsmonitor` / `textconv` / `filter.clean` config executes nothing —
  both proven by a fixture test that asserts a sentinel file was never created.
- No git-derived path reaches a terminal, a card preview or a prompt without control characters stripped.
- Diffs above 100 KB are refused with a clear message rather than rendered.
- Path confinement is unit-tested at its boundaries, not only through the UI.

## Architecture

```
pkg/vcs/
  repo.go         root resolution (rev-parse --show-toplevel), worktree detection
  status.go       porcelain parse → {root, entries[]}, staged/unstaged/partial per file
  stage.go        stage / unstage / discard
  commit.go       commit -F tempfile(0600), last-commit info
  remote.go       upstream, ahead/behind, push preview, push (normal | set-upstream | force-with-lease)
  pull.go         pull with explicit autoStash, atomic stash→pull→pop
  stash.go        list / push / apply / pop / drop
  branch.go       list / create / checkout
  worktree.go     list / create / remove
  diff.go         file diff (staged|unstaged) with a size cap and binary/new/deleted flags
  changelists.go  the ported spec + its tests
  trust.go        repo-root allowlist + EvalSymlinks confinement, shared with pkg/claudesession
  gitexec.go      the single hardened invocation wrapper (see Key Insights) — every call goes through it
  sanitize.go     path/text sanitiser for anything git-derived that reaches a UI or a PTY
frontend/app/view/vcs/
  vcs.tsx, vcs-model.ts        block view
  changelist-tree.tsx          tri-state checkbox tree
  push-modal.tsx, worktree-modal.tsx
frontend/app/view/codeeditor/diffviewer.tsx   finally given a consumer
```

Trust model, shared with phase 5: canonicalise with `filepath.Clean`/`Abs` **and `EvalSymlinks`**, reject
`..` traversal, absolute escapes and NUL bytes, then require containment within the **repo-root
allowlist** — roots the user explicitly opened in a `view:vcs` block, recorded server-side by block OID and
never derived from or updated by block meta. Enforced before **every** mutation, in one place.

Worktree exception, stated explicitly so phase 7's "must pass phase 6's confinement check" resolves to
something real: a `vcs:worktreeroots` setting defaulting to `<repo-root>/.worktrees` plus the repository's
parent directory. For **create**, resolve symlinks on the *parent*, require the leaf to be nonexistent or
empty, and require the resolved parent to sit inside a configured root. For **remove**, accept only paths
that appear verbatim in this repository's `git worktree list --porcelain` output, and never pass `--force`
without separate confirmation.

Diff rendering reuses Monaco through the existing `diffviewer.tsx` rather than porting the reference's
hand-rolled hunk parser — SLTerm already ships the editor, so the parser would be duplicate machinery.
Per-hunk accept/reject is a phase 7 concern; this phase delivers whole-file staging.

## Related Code Files

- Create: `pkg/vcs/*.go` + tests (including a hostile-repo fixture)
- Create: `frontend/app/view/vcs/{vcs.tsx,vcs-model.ts,changelist-tree.tsx,push-modal.tsx,worktree-modal.tsx}`
- Modify: `frontend/app/view/codeeditor/diffviewer.tsx` (wire it up; keep `editor:inlinediff`)
- Modify: `pkg/wshrpc/wshrpctypes.go` (VCS command family + structs), then `task generate`
- Modify: `pkg/wconfig/defaultconfig/widgets.json` (a `view:vcs` widget), `settings.json` (`vcs:*`:
  autostage mode, diff cap, refresh interval)
- Modify: `pkg/wstore` / migrations for the two changelist tables
- Reference (read-only): `/home/stackops/saly/claude-terminal/src-tauri/src/changelists.rs`,
  `src/components/{ChangelistSection,FileChangesPanel,InlineDiffView,PushModal,WorktreeModal}.tsx`,
  `src/utils/diffParser.ts`, `commands.rs:838-869` (the exec rule),
  `docs/superpowers/specs/2026-06-12-intellij-git-commit-panel-design.md`,
  `2026-05-21-git-push-popup-design.md`, `2026-06-11-verified-review-cockpit-design.md`

## Implementation Steps

1. **6.1 Trust model and the hardened wrapper first.** `pkg/vcs/trust.go` (repo-root allowlist,
   `EvalSymlinks`) with boundary tests: `../../etc/passwd`, an absolute path outside every root, a symlink
   pointing out, a NUL byte, a legitimate subdirectory that must be allowed, and an assertion that
   `wsh setmeta -b this cmd:cwd=/` cannot widen the set. Plus `pkg/vcs/gitexec.go`: the single wrapper with
   the hardening flags and env from Key Insights, a mandatory context timeout, and
   `CreationFlags: CREATE_NO_WINDOW` on Windows. Nothing else in this phase is safe to write before both
   exist. If phase 1's exec helper has not landed, write it here and have phase 1 adopt it — do not
   improvise with `cmd /C`.
2. **6.2 Repo + status.** Root resolution, worktree detection via `git-dir` vs `git-common-dir`, and
   `--porcelain=v1 -z` parsing that returns the root explicitly plus a per-file staged / unstaged /
   partial state. Route every path through `sanitize.go` before it reaches the UI.
3. **6.3 Mutations.** Stage, unstage, discard, commit via a 0600 tempfile, branch create/checkout. Every
   call goes through the trust check and `gitexec.go`.
4. **6.4 Remote.** Upstream resolution, ahead/behind, push preview (commits about to go out, upstream,
   mode), push with normal / set-upstream / force-with-lease. Pull with explicit `autoStash`, and the
   stash→pull→pop atomicity owned in Go.
5. **6.5 Changelists.** Two tables keyed on the normalised repo root, the synthetic `Default`, the UPSERT
   assignment, the cascade, the name rules. **Port the reference's tests verbatim** — they encode the
   whole specification, including the worktree-isolation case.
6. **6.6 Diff.** `git diff` per file with the staged/unstaged toggle, size cap, and binary/new/deleted
   flags. Feed Monaco's diff editor.
7. **6.7 Worktrees.** List / create (branch + base + path) / remove, under the explicit
   `vcs:worktreeroots` policy in Architecture — not as a confinement exemption. Then the action that opens a
   `claude` or `codex` block with its cwd set to the worktree, which is what makes this an ADE feature
   rather than a git GUI. Opening a worktree adds its root to the allowlist; nothing else does.
8. **6.8 `view:vcs`.** Header (branch, ahead/behind, refresh), the tri-state changelist tree with the
   Windows-reserved-name guard, toolbar (stage all, commit, push, pull, stash), and the diff pane. Build
   it as composable pieces; the reference's equivalent is a 1,430-line monolith and should not be copied
   as one file.
9. **6.9 Consent patterns.** `pullWithStashConfirm`; confirm on discard and on force-push; make
   `vcs:autostage` (`none` | `tracked` | `all`) an explicit setting rather than implicit behaviour.
10. **6.10 Read-only extras.** Git graph and blame, both behind the same status refresh. Cheap, and both
    are gaps in the category leader.

## Todo

- [ ] 6.1 `trust.go` (repo-root allowlist + EvalSymlinks) and `gitexec.go` (hardened wrapper) + tests
- [ ] 6.2 Repo root, worktree detection, `-z` porcelain status with the root returned, paths sanitised
- [ ] 6.3 Stage / unstage / discard / commit (0600 tempfile) / branch
- [ ] 6.4 Upstream, ahead/behind, push preview, push modes, pull with explicit autoStash
- [ ] 6.5 Changelists with the reference's tests ported verbatim
- [ ] 6.6 Diff with size cap and binary/new/deleted flags, rendered through Monaco
- [ ] 6.7 Worktree list / create / remove under `vcs:worktreeroots` + "open an agent here"
- [ ] 6.8 `view:vcs` block + widget, composed not monolithic
- [ ] 6.9 Consent patterns and the `vcs:autostage` setting
- [ ] 6.10 Git graph and blame

## Success Criteria

- [ ] A repo with a file named `a & b.txt` and a branch named `;rm -rf /` stages, commits and pushes
      correctly, proven by a test
- [ ] A fixture repo whose config sets `core.fsmonitor` / `textconv` / `filter.clean` to a payload that
      would create a sentinel file: status, diff and blame all run and the sentinel does **not** exist
- [ ] A file whose name contains CR, LF and ESC renders safely in the tree and cannot inject into a PTY
- [ ] `wsh setmeta -b this cmd:cwd=/` from inside a block does not widen what the VCS RPCs may touch
- [ ] A block whose cwd is a subdirectory shows correct paths for the whole repo
- [ ] Changelist assignments survive a commit and a worktree switch
- [ ] Path confinement rejects `../../etc/passwd`, an absolute path outside every allowlisted root, and a
      symlink pointing out of the tree
- [ ] `git worktree add` outside `vcs:worktreeroots` is refused; `remove` accepts only a path git lists
- [ ] The commit message tempfile is 0600 and is removed afterwards
- [ ] A 5 MB diff is refused with a message, not rendered
- [ ] Creating a worktree and opening a `claude` block in it takes one action
- [ ] `nul.txt` on Windows shows a disabled checkbox instead of failing a group stage
- [ ] `diffviewer.tsx` has at least one real consumer

## Risk Assessment

- **Path confinement is the one place a mistake is a security bug**, not an annoyance. Too tight blocks
  legitimate work; too loose lets a compromised webview operate on arbitrary paths. *Signal:* users hit
  "outside trusted path" on ordinary files, or a test can reach outside. *Response:* unit-test the
  boundary directly, and log every rejection with the resolved path so misconfiguration is diagnosable.
- **The exec helper's absence invites the wrong fix.** If `gitexec.go` is not in place first, the obvious
  way to hide the Windows console flash is `cmd /C start /b git …`, which reintroduces the injection hole
  in the module whose success criterion claims metacharacters are safe. *Response:* 6.1 builds the wrapper
  before any git call site exists, and the frontmatter now declares `dependencies: [1]`.
- **Credential prompts hang the RPC.** Without `GIT_TERMINAL_PROMPT=0` and an empty `GIT_ASKPASS`, a push
  to a remote needing credentials blocks forever on a pipe with no TTY. *Response:* both are set in
  `gitexec.go`, and every invocation carries a context timeout.
- **Destructive operations.** Discard, force-push and worktree removal all lose work.
  *Response:* confirmation on each, force-push restricted to `--force-with-lease`, and worktree removal
  refuses when the worktree is dirty unless explicitly confirmed.
- **Status refresh cost.** Polling `git status` per block in a large repo is expensive.
  *Signal:* CPU load with several blocks in one big repo. *Response:* one status per repo root, shared
  across blocks, refreshed on focus and on file-change events rather than a fixed timer.
- **The changelist port looks like plumbing and is actually a spec.** *Mitigation:* the tests come first;
  if a rule is unclear, the test in the reference is the answer.
- **Scope creep into a git client.** Interactive rebase, cherry-pick, submodules and conflict resolution
  are out. The goal is reviewing what an agent just did. *Response:* if a conflict arises, say so and let
  the user resolve it in the terminal.

## Security Considerations

- Spawn `git` directly, never via `cmd /C` — routing a real `.exe` through the shell is what would
  reintroduce metacharacter injection from hostile branch and path names on Windows.
- Argv quoting is **not** the main hostile-repo risk. Git executes programs named by a repository's own
  config (`core.fsmonitor`, `diff.<n>.textconv` + `.gitattributes`, `filter.<n>.clean`, `core.hooksPath`),
  which is why every invocation goes through `gitexec.go` with those settings neutralised and
  `GIT_CONFIG_NOSYSTEM` / `GIT_ATTR_NOSYSTEM` set. Add a repo-trust gate: an unfamiliar root is read-only
  until the user confirms it.
- The trust set is server-side state seeded only by an explicit user action. Never read it from block meta:
  `SetMetaCommand` has no allowlist and `wsh setmeta` ships inside every terminal.
- Git-derived paths are untrusted bytes. `-z` output plus one sanitiser (drop C0/C1 and ESC, never emit CR
  or LF, cap length) before anything reaches the UI, a prompt, or a PTY.
- Every mutation passes the trust check before touching the filesystem; the check lives in one function
  so it cannot be forgotten at a call site.
- Commit messages are written to a 0600 tempfile in a private directory and deleted after use.
- Never render a diff of a file outside the confinement set, even read-only — that is an exfiltration
  path for a compromised renderer.
- Push credentials are git's own (helpers, agents, tokens); this layer must not read, store or forward
  them.

## Next Steps

Phase 7 builds per-hunk accept/reject and routes review comments back to the agent on top of this
layer, and binds workspaces to the worktrees created here.

