# Phase 5 — Project / VCS layer (Go)

**Est.** 3-4 weeks · **Runtime-independent** · **Depends on:** Phase 4 (shares the trust model)

## Goal

Give SLTerm the git and project-organization surface it currently lacks entirely. This is what makes
it a Claude Code workstation rather than a terminal.

## Context

claude-terminal has **no first-class "project" entity and no recent-projects list**. A "project" is
just a terminal's `working_directory`. Project-scoped state lives in the app's central SQLite DB
keyed by `repo_path` / `working_directory` — no per-project config file is ever written.

SLTerm's equivalent of a project is a block's `cmd:cwd` plus its workspace. Keep that model; do not
invent a Project object.

## Work

### 5.1 `pkg/vcs`

- repo-root resolution via `git rev-parse --show-toplevel`
- `git status --porcelain` parsing. **Porcelain paths are relative to the repo root, not the block's
  cwd** — return the root separately, as `get_terminal_changes` does.
- stage / unstage / commit / push / pull / stash / branch / discard
- worktree detect / list / create / remove, detection via `git-dir` vs `git-common-dir` comparison

**Injection safety is free in Go.** claude-terminal needs a Windows-direct-exec vs Unix-shell split
in `git_command()` because hostile repos can carry malicious branch and file names. Go's `os/exec`
never invokes a shell, so `exec.Command("git", args...)` is safe on all platforms. Still set
`SysProcAttr.HideWindow` on Windows to suppress console flashes.

**Commit via `git commit -F <tempfile>` with 0600 perms.** claude-terminal writes a world-readable
temp file — a defect not to inherit.

### 5.2 Changelists (IntelliJ-style)

Port `claude-terminal/src-tauri/src/changelists.rs` into Go over the existing SQLite layer. It is
pure SQL with no Tauri deps — a near-verbatim translation.

- two tables keyed on the **normalized** repo root
- implicit `Default` changelist, **never persisted**
- sticky mappings that survive commits
- worktrees isolate naturally (different roots)

Organizes uncommitted changes into named groups **without touching git's index** — a genuine
differentiator vs a plain terminal.

### 5.3 Path-confinement trust model

Enforced before **every** file or git mutation: reject `..`, absolute escapes, NUL bytes; confine to
an active block's `cmd:cwd`. Ports `validate_path_is_trusted` / `validate_file_list`.

In Go: canonicalize with `filepath.Clean`/`Abs`, then check containment against the set of active
block cwds.

This prevents a compromised webview from operating on arbitrary filesystem paths, and it is shared
with Phase 4 — build it once.

### 5.4 `view:vcs` block

Status, diff, staging, commit, changelist grouping, worktree switching. Widget + keybinding.

Pairs naturally with parallel Claude sessions: one worktree/branch per block.

## Validation

- A repo with a filename containing shell metacharacters and a branch named `;rm -rf /` is handled
  safely (test explicitly).
- Porcelain paths resolve correctly when the block cwd is a subdirectory of the repo root.
- Changelist assignments survive a commit and a worktree switch.
- Path confinement rejects `../../etc/passwd` and an absolute path outside every active cwd.
- Commit message tempfile is 0600 and removed after use.

## Risk

Low-to-moderate. This is mostly shelling out to `git` and parsing, and Go's exec model removes the
injection class that made the reference implementation delicate.

The one real hazard is the trust model: get containment wrong and it either blocks legitimate
operations (annoying) or permits escapes (a security bug). Unit-test the boundary cases directly
rather than only through the UI.
