// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package vcs provides SLTerm's ADE Git, Diff, Changelist, and Isolated Agent Worktree backend.
//
// Design principles:
//   - Always invokes `git` directly via exec.Command (no shell) with HideWindow on Windows.
//   - Always passes `--` before user-controlled file paths and validates branch/path inputs
//     against traversal (`..`), NUL bytes, and leading-dash option injection.
//   - Writes commit messages to a `0600` temp file removed immediately via defer.
//   - Supports Orca-style isolated Git Worktrees so parallel Claude/Codex/Gemini agents never
//     collide on the same checkout.
package vcs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const defaultGitTimeout = 15 * time.Second

// FileChange represents one file from `git status --porcelain=v1 -z`.
type FileChange struct {
	Path        string `json:"path"`
	OrigPath    string `json:"origPath,omitempty"`
	IndexStatus string `json:"indexStatus"`
	WorkStatus  string `json:"workStatus"`
	Staged      bool   `json:"staged"`
	Unstaged    bool   `json:"unstaged"`
	Untracked   bool   `json:"untracked"`
	Conflicted  bool   `json:"conflicted"`
	Changelist  string `json:"changelist"`
}

// StatusReport is the complete Git status snapshot for a repository or worktree.
type StatusReport struct {
	RepoRoot     string       `json:"repoRoot"`
	Branch       string       `json:"branch"`
	HeadShort    string       `json:"headShort"`
	Ahead        int          `json:"ahead"`
	Behind       int          `json:"behind"`
	IsWorktree   bool         `json:"isWorktree"`
	Changes      []FileChange `json:"changes"`
	Changelists  []string     `json:"changelists"`
	StagedCount  int          `json:"stagedCount"`
	UnstagedCount int         `json:"unstagedCount"`
}

// WorktreeInfo represents one entry from `git worktree list --porcelain`.
type WorktreeInfo struct {
	Path          string   `json:"path"`
	Head          string   `json:"head"`
	Branch        string   `json:"branch"`
	IsMain        bool     `json:"isMain"`
	Detached      bool     `json:"detached"`
	Bare          bool     `json:"bare"`
	Locked        bool     `json:"locked"`
	DirtyCount    int      `json:"dirtyCount"`
	HydratedFiles []string `json:"hydratedFiles,omitempty"`
}

var safeBranchRe = regexp.MustCompile(`^[A-Za-z0-9._/@-]+$`)

// ValidateRelativePath rejects empty paths, NUL bytes, absolute escapes, leading dashes, and `..`.
func ValidateRelativePath(rel string) (string, error) {
	if rel == "" {
		return "", errors.New("path must not be empty")
	}
	if strings.ContainsRune(rel, '\x00') {
		return "", errors.New("path must not contain NUL byte")
	}
	if strings.HasPrefix(rel, "-") {
		return "", fmt.Errorf("path %q must not start with '-'", rel)
	}
	if filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "\\") {
		return "", fmt.Errorf("path %q must be relative to repo root", rel)
	}
	// Normalize slashes and check every segment for `..`.
	norm := strings.ReplaceAll(rel, "\\", "/")
	for _, seg := range strings.Split(norm, "/") {
		if seg == ".." {
			return "", fmt.Errorf("path traversal rejected in %q", rel)
		}
	}
	cleaned := filepath.ToSlash(filepath.Clean(norm))
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("invalid relative path %q", rel)
	}
	return cleaned, nil
}

// ValidateBranchName ensures a branch name is safe against git flag & shell metacharacter injection.
func ValidateBranchName(branch string) (string, error) {
	b := strings.TrimSpace(branch)
	if b == "" {
		return "", errors.New("branch name must not be empty")
	}
	if strings.HasPrefix(b, "-") || strings.Contains(b, "..") || strings.Contains(b, "@{") || strings.HasSuffix(b, ".lock") || strings.HasSuffix(b, "/") {
		return "", fmt.Errorf("invalid branch name %q", branch)
	}
	if !safeBranchRe.MatchString(b) {
		return "", fmt.Errorf("branch name %q contains disallowed characters", branch)
	}
	return b, nil
}

// ResolveRepoRoot resolves the canonical repository top-level directory for `dir`.
func ResolveRepoRoot(ctx context.Context, dir string) (string, error) {
	if strings.TrimSpace(dir) == "" {
		return "", errors.New("working directory is required")
	}
	if strings.ContainsRune(dir, '\x00') {
		return "", errors.New("invalid NUL byte in directory path")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	out, err := runGit(ctx, abs, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("not a git repository (%s): %w", abs, err)
	}
	return filepath.Clean(strings.TrimSpace(out)), nil
}

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), defaultGitTimeout)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	hideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return stdout.String(), fmt.Errorf("git %s failed: %s", strings.Join(args, " "), msg)
	}
	return stdout.String(), nil
}

// GetStatus returns branch, ahead/behind, worktree flag, and porcelain v1 changes relative to repo root.
func GetStatus(ctx context.Context, dir string) (*StatusReport, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return nil, err
	}
	branch, err := runGit(ctx, root, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		branch = "HEAD"
	}
	headShort, _ := runGit(ctx, root, "rev-parse", "--short", "HEAD")

	// Detect linked worktree via git-dir != git-common-dir.
	gitDir, _ := runGit(ctx, root, "rev-parse", "--git-dir")
	commonDir, _ := runGit(ctx, root, "rev-parse", "--git-common-dir")
	isWorktree := false
	if strings.TrimSpace(gitDir) != "" && strings.TrimSpace(commonDir) != "" {
		absGD := strings.TrimSpace(gitDir)
		if !filepath.IsAbs(absGD) {
			absGD = filepath.Join(root, absGD)
		}
		absCD := strings.TrimSpace(commonDir)
		if !filepath.IsAbs(absCD) {
			absCD = filepath.Join(root, absCD)
		}
		isWorktree = filepath.Clean(absGD) != filepath.Clean(absCD)
	}

	ahead, behind := 0, 0
	if ab, err := runGit(ctx, root, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"); err == nil {
		fields := strings.Fields(ab)
		if len(fields) == 2 {
			ahead, _ = strconv.Atoi(fields[0])
			behind, _ = strconv.Atoi(fields[1])
		}
	}

	raw, err := runGit(ctx, root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	clMap, clNames := loadRepoChangelists(root)
	changes := parsePorcelainZ(raw, clMap)

	stagedCount, unstagedCount := 0, 0
	for _, c := range changes {
		if c.Staged {
			stagedCount++
		}
		if c.Unstaged || c.Untracked {
			unstagedCount++
		}
	}

	return &StatusReport{
		RepoRoot:      root,
		Branch:        strings.TrimSpace(branch),
		HeadShort:     strings.TrimSpace(headShort),
		Ahead:         ahead,
		Behind:        behind,
		IsWorktree:    isWorktree,
		Changes:       changes,
		Changelists:   clNames,
		StagedCount:   stagedCount,
		UnstagedCount: unstagedCount,
	}, nil
}

func parsePorcelainZ(raw string, clMap map[string]string) []FileChange {
	out := make([]FileChange, 0)
	tokens := strings.Split(raw, "\x00")
	for i := 0; i < len(tokens); i++ {
		rec := tokens[i]
		if len(rec) < 4 {
			continue
		}
		x := rec[0:1]
		y := rec[1:2]
		path := filepath.ToSlash(rec[3:])
		origPath := ""
		if (x == "R" || x == "C" || y == "R" || y == "C") && i+1 < len(tokens) {
			i++
			origPath = filepath.ToSlash(tokens[i])
		}
		untracked := x == "?" && y == "?"
		conflicted := x == "U" || y == "U" || (x == "A" && y == "A") || (x == "D" && y == "D")
		staged := !untracked && x != " " && x != "?"
		unstaged := !untracked && y != " " && y != "?"
		cl := DefaultChangelist
		if assigned, ok := clMap[path]; ok && assigned != "" {
			cl = assigned
		}
		out = append(out, FileChange{
			Path:        path,
			OrigPath:    origPath,
			IndexStatus: x,
			WorkStatus:  y,
			Staged:      staged,
			Unstaged:    unstaged,
			Untracked:   untracked,
			Conflicted:  conflicted,
			Changelist:  cl,
		})
	}
	return out
}

// GetDiff returns unified diff output for a single file (or entire repo if relPath is empty).
func GetDiff(ctx context.Context, dir, relPath string, staged bool) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	args := []string{"diff", "--no-color"}
	if staged {
		args = append(args, "--cached")
	}
	if strings.TrimSpace(relPath) != "" {
		clean, err := ValidateRelativePath(relPath)
		if err != nil {
			return "", err
		}
		args = append(args, "--", clean)
	}
	return runGit(ctx, root, args...)
}

// StageFiles stages the specified repo-relative paths (or all changes if paths is empty).
func StageFiles(ctx context.Context, dir string, paths []string) error {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return err
	}
	if len(paths) == 0 {
		_, err = runGit(ctx, root, "add", "-A")
		return err
	}
	args := []string{"add", "--"}
	for _, p := range paths {
		clean, err := ValidateRelativePath(p)
		if err != nil {
			return err
		}
		args = append(args, clean)
	}
	_, err = runGit(ctx, root, args...)
	return err
}

// UnstageFiles unstages the specified repo-relative paths (or all staged files if empty).
func UnstageFiles(ctx context.Context, dir string, paths []string) error {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return err
	}
	if len(paths) == 0 {
		_, err = runGit(ctx, root, "reset", "HEAD")
		return err
	}
	args := []string{"reset", "HEAD", "--"}
	for _, p := range paths {
		clean, err := ValidateRelativePath(p)
		if err != nil {
			return err
		}
		args = append(args, clean)
	}
	_, err = runGit(ctx, root, args...)
	return err
}

// DiscardFile restores an unstaged tracked file from HEAD/index.
func DiscardFile(ctx context.Context, dir, relPath string) error {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return err
	}
	clean, err := ValidateRelativePath(relPath)
	if err != nil {
		return err
	}
	_, err = runGit(ctx, root, "checkout", "--", clean)
	return err
}

// Commit commits staged changes using a 0600 temp file removed immediately after git returns.
func Commit(ctx context.Context, dir, message string) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		return "", errors.New("commit message must not be empty")
	}
	tmp, err := os.CreateTemp("", "slterm-commit-*.txt")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	_ = os.Chmod(tmpPath, 0600)
	if _, err := tmp.WriteString(msg + "\n"); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	return runGit(ctx, root, "commit", "-F", tmpPath)
}

// Push pushes the current branch to its configured remote.
func Push(ctx context.Context, dir string) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	return runGit(ctx, root, "push")
}

// Pull fetches and merges from upstream.
func Pull(ctx context.Context, dir string) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	return runGit(ctx, root, "pull")
}

// ListWorktrees parses `git worktree list --porcelain`.
func ListWorktrees(ctx context.Context, dir string) ([]WorktreeInfo, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return nil, err
	}
	raw, err := runGit(ctx, root, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	out := make([]WorktreeInfo, 0)
	var cur *WorktreeInfo
	flush := func() {
		if cur != nil && cur.Path != "" {
			if len(out) == 0 {
				cur.IsMain = true
			}
			out = append(out, *cur)
		}
		cur = nil
	}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			flush()
			continue
		}
		switch {
		case strings.HasPrefix(line, "worktree "):
			flush()
			cur = &WorktreeInfo{Path: filepath.Clean(strings.TrimPrefix(line, "worktree "))}
		case cur == nil:
			continue
		case strings.HasPrefix(line, "HEAD "):
			cur.Head = strings.TrimPrefix(line, "HEAD ")
		case strings.HasPrefix(line, "branch "):
			cur.Branch = strings.TrimPrefix(strings.TrimPrefix(line, "branch "), "refs/heads/")
		case line == "detached":
			cur.Detached = true
		case line == "bare":
			cur.Bare = true
		case strings.HasPrefix(line, "locked"):
			cur.Locked = true
		}
	}
	flush()
	for i := range out {
		if out[i].Bare || out[i].Path == "" {
			continue
		}
		if stOut, err := runGit(ctx, out[i].Path, "status", "--porcelain"); err == nil {
			cnt := 0
			for _, ln := range strings.Split(stOut, "\n") {
				if strings.TrimSpace(ln) != "" {
					cnt++
				}
			}
			out[i].DirtyCount = cnt
		}
	}
	return out, nil
}

const maxHydrateFileBytes = 2 * 1024 * 1024 // 2 MiB safety cap per copied config file

var defaultHydrateCandidates = []string{
	".env",
	".env.local",
	".env.development",
	".mcp.json",
	"CLAUDE.md",
	"AGENTS.md",
}

// hydrateWorktreeFiles safely copies untracked local environment & AI context files
// (`.env`, `.env.local`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, plus any safe relative paths
// listed in `.worktreeinclude`) from the main repo root into a newly created agent worktree.
// Strictly rejects path traversal (`..`), absolute paths, symlinks, and files > 2 MiB.
func hydrateWorktreeFiles(root, dest string) []string {
	candidates := make([]string, 0, len(defaultHydrateCandidates)+8)
	seen := make(map[string]struct{})
	addCand := func(rel string) {
		clean, err := ValidateRelativePath(strings.TrimSpace(rel))
		if err != nil {
			return
		}
		if _, exists := seen[clean]; exists {
			return
		}
		seen[clean] = struct{}{}
		candidates = append(candidates, clean)
	}
	for _, c := range defaultHydrateCandidates {
		addCand(c)
	}
	if raw, err := os.ReadFile(filepath.Join(root, ".worktreeinclude")); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			addCand(line)
		}
	}

	hydrated := make([]string, 0)
	for _, rel := range candidates {
		src := filepath.Join(root, filepath.FromSlash(rel))
		dst := filepath.Join(dest, filepath.FromSlash(rel))
		// Do not overwrite files already tracked/present in the new worktree.
		if _, err := os.Lstat(dst); err == nil {
			continue
		}
		info, err := os.Lstat(src)
		if err != nil || !info.Mode().IsRegular() || info.Size() > maxHydrateFileBytes {
			continue
		}
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			continue
		}
		perm := info.Mode().Perm()
		if perm == 0 {
			perm = 0600
		}
		if err := os.WriteFile(dst, data, perm); err != nil {
			continue
		}
		hydrated = append(hydrated, rel)
	}
	return hydrated
}

// CreateWorktree provisions an isolated Orca-style agent worktree on a new branch and
// auto-hydrates local env/AI config files (`.env`, `.mcp.json`, `CLAUDE.md`, `.worktreeinclude`).
// If targetPath is empty, it creates a sibling directory `<repo>-wt-<slug>`.
func CreateWorktree(ctx context.Context, dir, branchName, targetPath string) (*WorktreeInfo, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return nil, err
	}
	branch, err := ValidateBranchName(branchName)
	if err != nil {
		return nil, err
	}
	dest := strings.TrimSpace(targetPath)
	if dest == "" {
		slug := strings.NewReplacer("/", "-", " ", "-", "_", "-").Replace(branch)
		dest = filepath.Join(filepath.Dir(root), fmt.Sprintf("%s-wt-%s", filepath.Base(root), slug))
	} else {
		if strings.ContainsRune(dest, '\x00') {
			return nil, errors.New("invalid NUL byte in target path")
		}
		dest, err = filepath.Abs(dest)
		if err != nil {
			return nil, err
		}
	}
	if _, err := runGit(ctx, root, "worktree", "add", "-b", branch, "--", dest); err != nil {
		return nil, err
	}
	hydrated := hydrateWorktreeFiles(root, dest)
	headShort, _ := runGit(ctx, dest, "rev-parse", "--short", "HEAD")
	return &WorktreeInfo{
		Path:          filepath.Clean(dest),
		Head:          strings.TrimSpace(headShort),
		Branch:        branch,
		IsMain:        false,
		HydratedFiles: hydrated,
	}, nil
}

// MergeWorktree merges a finished agent branch back into the main checkout and optionally removes
// the linked worktree. Refuses to merge if the main checkout has uncommitted changes.
func MergeWorktree(ctx context.Context, dir, branchName, worktreePath string, removeAfter bool) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	branch, err := ValidateBranchName(branchName)
	if err != nil {
		return "", err
	}
	wts, err := ListWorktrees(ctx, root)
	if err != nil {
		return "", err
	}
	mainPath := root
	for _, wt := range wts {
		if wt.IsMain {
			mainPath = wt.Path
			break
		}
	}
	st, err := runGit(ctx, mainPath, "status", "--porcelain")
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(st) != "" {
		return "", errors.New("main worktree has uncommitted changes; commit or stash before merging")
	}
	out, err := runGit(ctx, mainPath, "merge", "--no-edit", branch)
	if err != nil {
		return out, err
	}
	if removeAfter && strings.TrimSpace(worktreePath) != "" {
		if rmErr := RemoveWorktree(ctx, mainPath, worktreePath, false); rmErr != nil {
			return out, fmt.Errorf("merged %s, but worktree removal failed: %w", branch, rmErr)
		}
	}
	return out, nil
}

// DraftCommitMessage inspects staged files and diff stats to produce a fast, deterministic
// Conventional Commit message draft locally with zero API calls or token cost.
func DraftCommitMessage(ctx context.Context, dir string) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	ns, err := runGit(ctx, root, "diff", "--cached", "--name-status")
	if err != nil {
		return "", err
	}
	lines := make([]string, 0)
	for _, ln := range strings.Split(ns, "\n") {
		if t := strings.TrimSpace(ln); t != "" {
			lines = append(lines, t)
		}
	}
	if len(lines) == 0 {
		return "", errors.New("no staged files to draft commit message from")
	}

	added, modified, deleted := 0, 0, 0
	allDocs, allTests, allConfig := true, true, true
	scopes := make(map[string]struct{})
	var firstFile string
	for _, ln := range lines {
		parts := strings.Fields(ln)
		if len(parts) < 2 {
			continue
		}
		st := parts[0]
		p := filepath.ToSlash(parts[len(parts)-1])
		if firstFile == "" {
			firstFile = filepath.Base(p)
		}
		switch {
		case strings.HasPrefix(st, "A"):
			added++
		case strings.HasPrefix(st, "D"):
			deleted++
		default:
			modified++
		}
		low := strings.ToLower(p)
		if !strings.HasSuffix(low, ".md") && !strings.HasPrefix(low, "docs/") {
			allDocs = false
		}
		if !strings.Contains(low, "_test.") && !strings.Contains(low, ".test.") && !strings.Contains(low, "/tests/") {
			allTests = false
		}
		if !strings.HasSuffix(low, ".json") && !strings.HasSuffix(low, ".yml") && !strings.HasSuffix(low, ".yaml") && !strings.HasSuffix(low, ".toml") {
			allConfig = false
		}
		segs := strings.Split(p, "/")
		if len(segs) >= 2 {
			sc := segs[0]
			if (sc == "pkg" || sc == "cmd" || sc == "src" || sc == "frontend") && len(segs) >= 3 {
				sc = segs[1]
			}
			scopes[sc] = struct{}{}
		}
	}

	kind := "feat"
	switch {
	case allDocs:
		kind = "docs"
	case allTests:
		kind = "test"
	case allConfig:
		kind = "chore"
	case added == 0 && deleted > 0 && modified == 0:
		kind = "refactor"
	case added == 0 && modified > 0:
		kind = "fix"
	}

	scopeList := make([]string, 0, len(scopes))
	for s := range scopes {
		scopeList = append(scopeList, s)
	}
	// Deterministic ordering
	for i := 0; i < len(scopeList); i++ {
		for j := i + 1; j < len(scopeList); j++ {
			if scopeList[j] < scopeList[i] {
				scopeList[i], scopeList[j] = scopeList[j], scopeList[i]
			}
		}
	}
	scopePart := ""
	if len(scopeList) > 0 {
		if len(scopeList) > 2 {
			scopeList = scopeList[:2]
		}
		scopePart = "(" + strings.Join(scopeList, ",") + ")"
	}

	summary := fmt.Sprintf("update %d files", len(lines))
	if len(lines) == 1 && firstFile != "" {
		verb := "update"
		if added == 1 {
			verb = "add"
		} else if deleted == 1 {
			verb = "remove"
		}
		summary = fmt.Sprintf("%s %s", verb, firstFile)
	} else if added > 0 && modified == 0 && deleted == 0 {
		summary = fmt.Sprintf("add %d files", added)
	}

	statOut, _ := runGit(ctx, root, "diff", "--cached", "--shortstat")
	stat := strings.TrimSpace(statOut)
	if stat != "" {
		return fmt.Sprintf("%s%s: %s\n\n%s", kind, scopePart, summary, stat), nil
	}
	return fmt.Sprintf("%s%s: %s", kind, scopePart, summary), nil
}

// CommitEntry represents one commit in `git log`.
type CommitEntry struct {
	Hash       string `json:"hash"`
	ShortHash  string `json:"shortHash"`
	Author     string `json:"author"`
	RelDate    string `json:"relDate"`
	Subject    string `json:"subject"`
	Decoration string `json:"decoration,omitempty"`
}

// GetLog returns the most recent `limit` commits for a repository.
func GetLog(ctx context.Context, dir string, limit int) ([]CommitEntry, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	// Use ASCII Unit Separator (0x1f) between fields and Record Separator (0x1e) between commits.
	out, err := runGit(ctx, root, "log", fmt.Sprintf("-n%d", limit), "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1f%D%x1e")
	if err != nil {
		return nil, err
	}
	entries := make([]CommitEntry, 0, limit)
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		parts := strings.Split(rec, "\x1f")
		if len(parts) < 5 {
			continue
		}
		dec := ""
		if len(parts) >= 6 {
			dec = strings.TrimSpace(parts[5])
		}
		entries = append(entries, CommitEntry{
			Hash:       parts[0],
			ShortHash:  parts[1],
			Author:     parts[2],
			RelDate:    parts[3],
			Subject:    parts[4],
			Decoration: dec,
		})
	}
	return entries, nil
}

// GetFileLog returns recent commits touching a single validated repo-relative file path.
func GetFileLog(ctx context.Context, dir, relPath string, limit int) ([]CommitEntry, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return nil, err
	}
	clean, err := ValidateRelativePath(relPath)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	out, err := runGit(ctx, root, "log", fmt.Sprintf("-n%d", limit), "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1f%D%x1e", "--", clean)
	if err != nil {
		return nil, err
	}
	entries := make([]CommitEntry, 0, limit)
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		parts := strings.Split(rec, "\x1f")
		if len(parts) < 5 {
			continue
		}
		dec := ""
		if len(parts) >= 6 {
			dec = strings.TrimSpace(parts[5])
		}
		entries = append(entries, CommitEntry{
			Hash:       parts[0],
			ShortHash:  parts[1],
			Author:     parts[2],
			RelDate:    parts[3],
			Subject:    parts[4],
			Decoration: dec,
		})
	}
	return entries, nil
}

var safeHashRe = regexp.MustCompile(`^[0-9a-fA-F]{4,64}$`)

// ShowCommit returns the color-free `--stat` + patch summary for a validated commit hash.
func ShowCommit(ctx context.Context, dir, hash string) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	h := strings.TrimSpace(hash)
	if !safeHashRe.MatchString(h) {
		return "", fmt.Errorf("invalid commit hash %q", hash)
	}
	return runGit(ctx, root, "show", "--stat", "--no-color", h)
}

// RemoveWorktree removes a linked worktree (refuses to remove the main checkout).
func RemoveWorktree(ctx context.Context, dir, worktreePath string, force bool) error {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return err
	}
	if strings.TrimSpace(worktreePath) == "" || strings.ContainsRune(worktreePath, '\x00') {
		return errors.New("invalid worktree path")
	}
	absTarget, err := filepath.Abs(worktreePath)
	if err != nil {
		return err
	}
	absTarget = filepath.Clean(absTarget)
	wts, err := ListWorktrees(ctx, root)
	if err != nil {
		return err
	}
	for _, wt := range wts {
		if filepath.Clean(wt.Path) == absTarget && wt.IsMain {
			return errors.New("refusing to remove the main repository worktree")
		}
	}
	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, "--", absTarget)
	_, err = runGit(ctx, root, args...)
	return err
}

// BranchInfo represents a local Git branch from `git for-each-ref`.
type BranchInfo struct {
	Name      string `json:"name"`
	Current   bool   `json:"current"`
	ShortHash string `json:"shortHash"`
	Subject   string `json:"subject"`
}

// ListBranches lists local branches sorted by most recent commit.
func ListBranches(ctx context.Context, dir string) ([]BranchInfo, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return nil, err
	}
	out, err := runGit(ctx, root, "for-each-ref", "--sort=-committerdate", "--format=%(HEAD)%09%(refname:short)%09%(objectname:short)%09%(subject)", "refs/heads")
	if err != nil {
		return nil, err
	}
	res := make([]BranchInfo, 0)
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimRight(ln, "\r")
		if strings.TrimSpace(ln) == "" {
			continue
		}
		parts := strings.SplitN(ln, "\t", 4)
		if len(parts) < 3 {
			continue
		}
		subj := ""
		if len(parts) >= 4 {
			subj = parts[3]
		}
		res = append(res, BranchInfo{
			Name:      parts[1],
			Current:   strings.TrimSpace(parts[0]) == "*",
			ShortHash: parts[2],
			Subject:   subj,
		})
	}
	return res, nil
}

// CheckoutBranch switches to an existing branch (or creates a new branch when create=true).
func CheckoutBranch(ctx context.Context, dir, branch string, create bool) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	b, err := ValidateBranchName(branch)
	if err != nil {
		return "", err
	}
	if create {
		return runGit(ctx, root, "checkout", "-b", b)
	}
	return runGit(ctx, root, "checkout", b)
}

// StashEntry represents one entry from `git stash list`.
type StashEntry struct {
	Ref     string `json:"ref"`
	RelDate string `json:"relDate"`
	Message string `json:"message"`
}

var safeStashRefRe = regexp.MustCompile(`^stash@\{\d+\}$`)

// ListStashes returns the repository's stash stack.
func ListStashes(ctx context.Context, dir string) ([]StashEntry, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return nil, err
	}
	out, err := runGit(ctx, root, "stash", "list", "--pretty=format:%gd%x1f%ar%x1f%gs")
	if err != nil {
		return nil, err
	}
	res := make([]StashEntry, 0)
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimRight(ln, "\r")
		if strings.TrimSpace(ln) == "" {
			continue
		}
		parts := strings.Split(ln, "\x1f")
		if len(parts) < 3 {
			continue
		}
		res = append(res, StashEntry{
			Ref:     parts[0],
			RelDate: parts[1],
			Message: parts[2],
		})
	}
	return res, nil
}

// StashPush saves uncommitted working-tree changes onto the stash stack.
func StashPush(ctx context.Context, dir, message string, includeUntracked bool) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	args := []string{"stash", "push"}
	if includeUntracked {
		args = append(args, "-u")
	}
	if msg := strings.TrimSpace(message); msg != "" {
		if strings.ContainsRune(msg, '\x00') {
			return "", errors.New("stash message contains NUL byte")
		}
		args = append(args, "-m", msg)
	}
	return runGit(ctx, root, args...)
}

// StashPop restores and removes a validated stash ref (or the latest stash if ref is empty).
func StashPop(ctx context.Context, dir, ref string) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	r := strings.TrimSpace(ref)
	if r == "" {
		return runGit(ctx, root, "stash", "pop")
	}
	if !safeStashRefRe.MatchString(r) {
		return "", fmt.Errorf("invalid stash ref %q", ref)
	}
	return runGit(ctx, root, "stash", "pop", r)
}

// PruneWorktrees cleans up stale worktree administrative files for deleted worktree directories.
func PruneWorktrees(ctx context.Context, dir string) (string, error) {
	root, err := ResolveRepoRoot(ctx, dir)
	if err != nil {
		return "", err
	}
	return runGit(ctx, root, "worktree", "prune", "-v")
}
