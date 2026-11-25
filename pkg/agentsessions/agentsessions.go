// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package agentsessions implements SLTerm's ADE Multi-Agent Hub backend:
//   - Cross-agent session discovery & fuzzy search (Claude Code + OpenAI Codex JSONL transcripts)
//   - Stella-style session state heuristics ("active", "waiting_approval", "idle")
//   - Safe session restore planning (EncodeCwd + PlanRestoreModes dedup guard so two blocks in
//     the same CWD never hijack the same `--resume=<id>` conversation)
//   - Windows-first universal CLI agent detector (Claude, Codex, Gemini, OpenCode, Cursor,
//     Copilot, Aider, PowerShell 7, Git Bash, WSL)
//   - Orca-style "Notes That Do Things" executable prompt/command workflow recipes.
package agentsessions

import (
	"bufio"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// SessionSummary describes a discoverable past or live AI coding session.
type SessionSummary struct {
	ID            string `json:"id"`
	Agent         string `json:"agent"` // "claude" | "codex"
	Cwd           string `json:"cwd"`
	Title         string `json:"title"`
	Status        string `json:"status"` // "active" | "waiting_approval" | "idle"
	MessageCount  int    `json:"messageCount"`
	UpdatedAtMs   int64  `json:"updatedAtMs"`
	FilePath      string `json:"filePath"`
	ResumeCommand string `json:"resumeCommand"`
}

// SessionIndex is the result of scanning & filtering multi-agent transcripts.
type SessionIndex struct {
	Sessions []SessionSummary `json:"sessions"`
	Warnings []string         `json:"warnings,omitempty"`
}

// DetectedAgent describes an AI coding CLI or shell available on the user's machine.
type DetectedAgent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"` // "ai" | "shell"
	Command     string `json:"command"`
	Installed   bool   `json:"installed"`
	BinaryPath  string `json:"binaryPath,omitempty"`
	Description string `json:"description"`
}

// PromptNote is an Orca-style executable prompt or command workflow ("Notes That Do Things").
type PromptNote struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Agent       string   `json:"agent"` // "any" | "claude" | "codex" | "shell"
	Body        string   `json:"body"`
	Tags        []string `json:"tags,omitempty"`
	UpdatedAtMs int64    `json:"updatedAtMs"`
}

// RestoreBlockRequest is one terminal block requesting session restore on startup.
type RestoreBlockRequest struct {
	BlockID   string `json:"blockId"`
	Cwd       string `json:"cwd"`
	SessionID string `json:"sessionId,omitempty"`
}

// RestoreBlockPlan is the collision-free restore decision for a block.
type RestoreBlockPlan struct {
	BlockID   string   `json:"blockId"`
	Mode      string   `json:"mode"` // "resume" | "continue" | "fresh"
	SessionID string   `json:"sessionId,omitempty"`
	Args      []string `json:"args,omitempty"`
}

// EncodeCwd encodes a working directory the same way Claude Code keys `~/.claude/projects/<encoded>`.
func EncodeCwd(cwd string) string {
	r := strings.NewReplacer("\\", "-", "/", "-", ":", "-", " ", "-")
	return r.Replace(strings.TrimSpace(cwd))
}

// PlanRestoreModes assigns `--resume=<id>` / `--continue` without letting two blocks in the
// same CWD claim the same Claude conversation.
func PlanRestoreModes(blocks []RestoreBlockRequest) []RestoreBlockPlan {
	claimedSessions := make(map[string]bool)
	claimedContinueCwd := make(map[string]bool)
	plans := make([]RestoreBlockPlan, 0, len(blocks))
	for _, b := range blocks {
		sid := strings.TrimSpace(b.SessionID)
		cwdKey := strings.ToLower(EncodeCwd(b.Cwd))
		if sid != "" && !claimedSessions[sid] {
			claimedSessions[sid] = true
			plans = append(plans, RestoreBlockPlan{
				BlockID:   b.BlockID,
				Mode:      "resume",
				SessionID: sid,
				// Use `--resume=<id>` (equals form) because Commander.js treats space-separated
				// optional args as an interactive picker + stray positional.
				Args: []string{"--resume=" + sid},
			})
			continue
		}
		if cwdKey != "" && !claimedContinueCwd[cwdKey] {
			claimedContinueCwd[cwdKey] = true
			plans = append(plans, RestoreBlockPlan{
				BlockID: b.BlockID,
				Mode:    "continue",
				Args:    []string{"--continue"},
			})
			continue
		}
		plans = append(plans, RestoreBlockPlan{
			BlockID: b.BlockID,
			Mode:    "fresh",
		})
	}
	return plans
}

func homeDir() string {
	if custom := strings.TrimSpace(os.Getenv("SLTERM_AGENT_HOME")); custom != "" {
		return custom
	}
	h, _ := os.UserHomeDir()
	return h
}

// ListSessions discovers Claude Code and OpenAI Codex sessions and filters by fuzzy query & agent.
func ListSessions(query, agentFilter string, limit int) (*SessionIndex, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	home := homeDir()
	sessions := make([]SessionSummary, 0)
	warnings := make([]string, 0)
	wantAgent := strings.ToLower(strings.TrimSpace(agentFilter))

	if wantAgent == "" || wantAgent == "all" || wantAgent == "claude" {
		cs, w := scanClaudeSessions(filepath.Join(home, ".claude", "projects"))
		sessions = append(sessions, cs...)
		warnings = append(warnings, w...)
	}
	if wantAgent == "" || wantAgent == "all" || wantAgent == "codex" {
		xs, w := scanCodexSessions(filepath.Join(home, ".codex", "sessions"))
		sessions = append(sessions, xs...)
		warnings = append(warnings, w...)
	}

	q := strings.ToLower(strings.TrimSpace(query))
	filtered := make([]SessionSummary, 0, len(sessions))
	for _, s := range sessions {
		if q != "" {
			hay := strings.ToLower(s.Title + " " + s.Cwd + " " + s.ID + " " + s.Agent)
			matched := true
			for _, tok := range strings.Fields(q) {
				if !strings.Contains(hay, tok) {
					matched = false
					break
				}
			}
			if !matched {
				continue
			}
		}
		filtered = append(filtered, s)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].UpdatedAtMs > filtered[j].UpdatedAtMs
	})
	if len(filtered) > limit {
		filtered = filtered[:limit]
	}
	return &SessionIndex{Sessions: filtered, Warnings: warnings}, nil
}

func scanClaudeSessions(projectsDir string) ([]SessionSummary, []string) {
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil, nil
	}
	var out []SessionSummary
	var warnings []string
	nowMs := time.Now().UnixMilli()
	for _, proj := range entries {
		if !proj.IsDir() {
			continue
		}
		pdir := filepath.Join(projectsDir, proj.Name())
		files, err := os.ReadDir(pdir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			full := filepath.Join(pdir, f.Name())
			info, err := f.Info()
			if err != nil {
				continue
			}
			sid := strings.TrimSuffix(f.Name(), ".jsonl")
			cwd, title, count, waiting, parseErr := inspectJsonlTranscript(full)
			if parseErr != nil {
				warnings = append(warnings, fmt.Sprintf("claude %s: %v", sid, parseErr))
				continue
			}
			if cwd == "" {
				cwd = proj.Name()
			}
			if title == "" {
				title = "Claude session " + shortID(sid)
			}
			updated := info.ModTime().UnixMilli()
			status := classifyStatus(updated, nowMs, waiting)
			out = append(out, SessionSummary{
				ID:            sid,
				Agent:         "claude",
				Cwd:           cwd,
				Title:         title,
				Status:        status,
				MessageCount:  count,
				UpdatedAtMs:   updated,
				FilePath:      full,
				ResumeCommand: "claude --resume=" + sid,
			})
		}
	}
	return out, warnings
}

func scanCodexSessions(sessionsDir string) ([]SessionSummary, []string) {
	if _, err := os.Stat(sessionsDir); err != nil {
		return nil, nil
	}
	var out []SessionSummary
	var warnings []string
	nowMs := time.Now().UnixMilli()
	_ = filepath.WalkDir(sessionsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		sid := strings.TrimSuffix(d.Name(), ".jsonl")
		cwd, title, count, waiting, parseErr := inspectJsonlTranscript(path)
		if parseErr != nil {
			warnings = append(warnings, fmt.Sprintf("codex %s: %v", sid, parseErr))
			return nil
		}
		if title == "" {
			title = "Codex session " + shortID(sid)
		}
		updated := info.ModTime().UnixMilli()
		status := classifyStatus(updated, nowMs, waiting)
		out = append(out, SessionSummary{
			ID:            sid,
			Agent:         "codex",
			Cwd:           cwd,
			Title:         title,
			Status:        status,
			MessageCount:  count,
			UpdatedAtMs:   updated,
			FilePath:      path,
			ResumeCommand: "codex resume " + sid,
		})
		return nil
	})
	return out, warnings
}

func classifyStatus(updatedMs, nowMs int64, waiting bool) string {
	age := nowMs - updatedMs
	if waiting && age < 15*60*1000 {
		return "waiting_approval"
	}
	if age >= 0 && age < 2*60*1000 {
		return "active"
	}
	return "idle"
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

// inspectJsonlTranscript reads bounded lines from a Claude or Codex JSONL transcript.
func inspectJsonlTranscript(path string) (cwd, title string, msgCount int, waiting bool, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", 0, false, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	linesRead := 0
	var lastRole string
	for sc.Scan() && linesRead < 200 {
		linesRead++
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var obj map[string]any
		if json.Unmarshal([]byte(line), &obj) != nil {
			continue
		}
		msgCount++
		if cwd == "" {
			if c, ok := obj["cwd"].(string); ok && c != "" {
				cwd = c
			} else if payload, ok := obj["payload"].(map[string]any); ok {
				if c, ok := payload["cwd"].(string); ok && c != "" {
					cwd = c
				}
			}
		}
		role, _ := obj["type"].(string)
		if r2, ok := obj["role"].(string); ok && r2 != "" {
			role = r2
		}
		if role != "" {
			lastRole = strings.ToLower(role)
		}
		if title == "" && (lastRole == "user" || lastRole == "human") {
			title = extractTextSnippet(obj)
		}
		if strings.Contains(strings.ToLower(line), "permission") || strings.Contains(strings.ToLower(line), "approval_request") {
			waiting = true
		} else if lastRole == "user" {
			waiting = false
		}
	}
	return cwd, title, msgCount, waiting, nil
}

func extractTextSnippet(obj map[string]any) string {
	candidates := []any{obj["content"], obj["text"], obj["prompt"]}
	if msg, ok := obj["message"].(map[string]any); ok {
		candidates = append(candidates, msg["content"], msg["text"])
	}
	for _, c := range candidates {
		switch v := c.(type) {
		case string:
			t := cleanSnippet(v)
			if t != "" {
				return t
			}
		case []any:
			for _, elem := range v {
				if m, ok := elem.(map[string]any); ok {
					if s, ok := m["text"].(string); ok {
						t := cleanSnippet(s)
						if t != "" {
							return t
						}
					}
				}
			}
		}
	}
	return ""
}

func cleanSnippet(s string) string {
	s = strings.Join(strings.Fields(strings.TrimSpace(s)), " ")
	if len(s) > 110 {
		return s[:107] + "..."
	}
	return s
}

// DetectInstalledAgents probes PATH + common Windows/Unix install locations for CLI agents & shells.
func DetectInstalledAgents() []DetectedAgent {
	specs := []struct {
		id, name, cat, bin, cmd, desc string
	}{
		{"claude", "Claude Code", "ai", "claude", "claude", "Anthropic Claude Code CLI agent"},
		{"codex", "OpenAI Codex", "ai", "codex", "codex", "OpenAI Codex coding agent CLI"},
		{"gemini", "Gemini CLI", "ai", "gemini", "gemini", "Google Gemini CLI agent"},
		{"opencode", "OpenCode", "ai", "opencode", "opencode", "Open-source terminal coding agent"},
		{"cursor", "Cursor CLI", "ai", "cursor-agent", "cursor-agent", "Cursor terminal coding agent"},
		{"copilot", "GitHub Copilot", "ai", "gh", "gh copilot", "GitHub CLI + Copilot assistant"},
		{"aider", "Aider", "ai", "aider", "aider", "Git-native AI pair programmer"},
		{"pwsh", "PowerShell 7", "shell", "pwsh", "pwsh", "Modern Windows-first PowerShell 7"},
		{"wsl", "WSL", "shell", "wsl", "wsl", "Windows Subsystem for Linux"},
		{"bash", "Git Bash / Bash", "shell", "bash", "bash", "POSIX shell / Git Bash on Windows"},
	}

	extraDirs := extraSearchDirs()
	out := make([]DetectedAgent, 0, len(specs))
	for _, s := range specs {
		p := locateBinary(s.bin, extraDirs)
		out = append(out, DetectedAgent{
			ID:          s.id,
			Name:        s.name,
			Category:    s.cat,
			Command:     s.cmd,
			Installed:   p != "",
			BinaryPath:  p,
			Description: s.desc,
		})
	}
	return out
}

func extraSearchDirs() []string {
	var dirs []string
	home := homeDir()
	if home != "" {
		dirs = append(dirs,
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".cargo", "bin"),
		)
	}
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			dirs = append(dirs, filepath.Join(appData, "npm"))
		}
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			dirs = append(dirs, filepath.Join(local, "Programs"))
		}
	}
	return dirs
}

func locateBinary(name string, extraDirs []string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	exts := []string{""}
	if runtime.GOOS == "windows" {
		exts = []string{".exe", ".cmd", ".bat"}
	}
	for _, d := range extraDirs {
		for _, ext := range exts {
			cand := filepath.Join(d, name+ext)
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				return cand
			}
		}
	}
	return ""
}

// --- Executable Prompt Notes ("Notes That Do Things") ---

var notesMu sync.Mutex

func notesPath() string {
	if custom := strings.TrimSpace(os.Getenv("SLTERM_CONFIG_HOME")); custom != "" {
		return filepath.Join(custom, "prompt-notes.json")
	}
	return filepath.Join(homeDir(), ".slterm", "config", "prompt-notes.json")
}

func defaultNotes() []PromptNote {
	now := time.Now().UnixMilli()
	return []PromptNote{
		{
			ID:          "review-diff",
			Title:       "Review Current Git Diff",
			Agent:       "any",
			Body:        "Inspect `git diff` in this repo, flag bugs, security issues, or missing edge-case tests, and propose minimal fixes.",
			Tags:        []string{"review", "git"},
			UpdatedAtMs: now,
		},
		{
			ID:          "fix-tests",
			Title:       "Run & Fix Failing Tests",
			Agent:       "any",
			Body:        "Run the project test suite, diagnose every failing test from root cause, patch the code cleanly, and re-run until green.",
			Tags:        []string{"qa", "tests"},
			UpdatedAtMs: now,
		},
		{
			ID:          "conventional-commit",
			Title:       "Summarize & Conventional Commit",
			Agent:       "any",
			Body:        "Review staged changes with `git diff --cached` and draft a concise Conventional Commit message explaining why.",
			Tags:        []string{"git", "ship"},
			UpdatedAtMs: now,
		},
		{
			ID:          "windows-perf-audit",
			Title:       "Windows RAM & Startup Audit",
			Agent:       "claude",
			Body:        "Audit this workspace for Windows path compatibility, hidden console spawns (CREATE_NO_WINDOW), and idle memory/CPU overhead.",
			Tags:        []string{"windows", "perf"},
			UpdatedAtMs: now,
		},
	}
}

func ListNotes() ([]PromptNote, error) {
	notesMu.Lock()
	defer notesMu.Unlock()
	raw, err := os.ReadFile(notesPath())
	if err != nil {
		if os.IsNotExist(err) {
			return defaultNotes(), nil
		}
		return nil, err
	}
	var notes []PromptNote
	if err := json.Unmarshal(raw, &notes); err != nil {
		return defaultNotes(), nil
	}
	if len(notes) == 0 {
		return defaultNotes(), nil
	}
	return notes, nil
}

func SaveNote(note PromptNote) (*PromptNote, error) {
	title := strings.TrimSpace(note.Title)
	body := strings.TrimSpace(note.Body)
	if title == "" || body == "" {
		return nil, errors.New("note title and body are required")
	}
	notesMu.Lock()
	defer notesMu.Unlock()

	var notes []PromptNote
	if raw, err := os.ReadFile(notesPath()); err == nil {
		_ = json.Unmarshal(raw, &notes)
	} else if os.IsNotExist(err) {
		notes = defaultNotes()
	}

	if strings.TrimSpace(note.ID) == "" {
		note.ID = fmt.Sprintf("note-%d", time.Now().UnixMilli())
	}
	if strings.TrimSpace(note.Agent) == "" {
		note.Agent = "any"
	}
	note.Title = title
	note.Body = body
	note.UpdatedAtMs = time.Now().UnixMilli()

	updated := false
	for i := range notes {
		if notes[i].ID == note.ID {
			notes[i] = note
			updated = true
			break
		}
	}
	if !updated {
		notes = append([]PromptNote{note}, notes...)
	}
	if err := persistNotesLocked(notes); err != nil {
		return nil, err
	}
	return &note, nil
}

func DeleteNote(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("note id is required")
	}
	notesMu.Lock()
	defer notesMu.Unlock()
	var notes []PromptNote
	if raw, err := os.ReadFile(notesPath()); err == nil {
		_ = json.Unmarshal(raw, &notes)
	} else {
		notes = defaultNotes()
	}
	filtered := make([]PromptNote, 0, len(notes))
	for _, n := range notes {
		if n.ID != id {
			filtered = append(filtered, n)
		}
	}
	return persistNotesLocked(filtered)
}

func persistNotesLocked(notes []PromptNote) error {
	p := notesPath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(notes, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0600)
}

func newUUIDv4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ForkSession safely clones an existing Claude Code or Codex JSONL session transcript under a
// new UUID so a developer can branch an AI conversation mid-task without mutating the original.
func ForkSession(agent, sessionID string) (*SessionSummary, error) {
	sid := strings.TrimSpace(sessionID)
	if sid == "" || strings.ContainsAny(sid, `/\..`) || strings.ContainsRune(sid, '\x00') {
		return nil, errors.New("invalid session id")
	}
	wantAgent := strings.ToLower(strings.TrimSpace(agent))
	idx, err := ListSessions("", wantAgent, 200)
	if err != nil {
		return nil, err
	}
	var src *SessionSummary
	for i := range idx.Sessions {
		if idx.Sessions[i].ID == sid && (wantAgent == "" || idx.Sessions[i].Agent == wantAgent) {
			cp := idx.Sessions[i]
			src = &cp
			break
		}
	}
	if src == nil || src.FilePath == "" {
		return nil, fmt.Errorf("session %q not found", sid)
	}
	// Confine strictly to homeDir()/.claude or homeDir()/.codex
	allowedRoot := filepath.Clean(homeDir())
	cleanSrc := filepath.Clean(src.FilePath)
	if !strings.HasPrefix(strings.ToLower(cleanSrc), strings.ToLower(allowedRoot)) {
		return nil, errors.New("refusing to fork session outside agent home directory")
	}
	raw, err := os.ReadFile(cleanSrc)
	if err != nil {
		return nil, err
	}
	newID := newUUIDv4()
	dst := filepath.Join(filepath.Dir(cleanSrc), newID+".jsonl")
	if err := os.WriteFile(dst, raw, 0600); err != nil {
		return nil, err
	}
	resumeCmd := "claude --resume=" + newID
	if src.Agent == "codex" {
		resumeCmd = "codex resume " + newID
	}
	return &SessionSummary{
		ID:            newID,
		Agent:         src.Agent,
		Cwd:           src.Cwd,
		Title:         "[Fork] " + src.Title,
		Status:        "idle",
		MessageCount:  src.MessageCount,
		UpdatedAtMs:   time.Now().UnixMilli(),
		FilePath:      dst,
		ResumeCommand: resumeCmd,
	}, nil
}
