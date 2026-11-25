// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package nltcmd provides SLTerm's Orca/Warp-inspired Offline Natural-Language Shell
// Command Assistant (bilingual English + Vietnamese) with automatic Command Firewall
// (`SLT011–SLT016`) safety scoring and Windows PowerShell + Unix equivalents.
package nltcmd

import (
	"fmt"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/SalyyS1/SLTerm/pkg/cmdguard"
)

// Suggestion represents one matched shell command recipe audited by SLTerm Command Firewall.
type Suggestion struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Category    string `json:"category"` // windows | git | docker | network | files | dev
	WindowsCmd  string `json:"windowsCmd"`
	UnixCmd     string `json:"unixCmd"`
	Recommended string `json:"recommended"` // OS-appropriate default command
	Explanation string `json:"explanation"`
	Verdict     string `json:"verdict"` // allow | warn | require_approval | block
	RiskScore   int    `json:"riskScore"`
	Score       int    `json:"score"`
}

type recipe struct {
	id       string
	title    string
	category string
	keywords []string
	winFn    func(num int) string
	unixFn   func(num int) string
	explain  string
}

var numRe = regexp.MustCompile(`\b(\d{1,5})\b`)

var recipes = []recipe{
	{
		id:       "port-find",
		title:    "Find Process Listening on Port",
		category: "network",
		keywords: []string{"port", "listen", "find", "check", "tim", "kiem", "cong", "netstat", "lsof", "ss", "pid", "dang chay"},
		winFn: func(n int) string {
			if n <= 0 {
				n = 3000
			}
			return fmt.Sprintf("Get-NetTCPConnection -LocalPort %d -State Listen | Select-Object LocalPort,OwningProcess", n)
		},
		unixFn: func(n int) string {
			if n <= 0 {
				n = 3000
			}
			return fmt.Sprintf("lsof -nP -iTCP:%d -sTCP:LISTEN", n)
		},
		explain: "Shows which PID owns a localhost dev port without stopping anything.",
	},
	{
		id:       "port-kill",
		title:    "Stop Process Using Local Port",
		category: "network",
		keywords: []string{"kill", "stop", "tat", "dung", "port", "cong", "pid", "taskkill", "fuser", "free"},
		winFn: func(n int) string {
			if n <= 0 {
				n = 3000
			}
			return fmt.Sprintf("Get-NetTCPConnection -LocalPort %d -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }", n)
		},
		unixFn: func(n int) string {
			if n <= 0 {
				n = 3000
			}
			return fmt.Sprintf("fuser -k %d/tcp", n)
		},
		explain: "Frees a stuck localhost dev server port by terminating the owning PID.",
	},
	{
		id:       "ssh-tunnel",
		title:    "Local SSH Port Forward Tunnel",
		category: "network",
		keywords: []string{"ssh", "tunnel", "forward", "port", "vps", "remote", "chuyen tiep"},
		winFn: func(n int) string {
			if n <= 0 {
				n = 8080
			}
			return fmt.Sprintf("ssh -N -L %d:127.0.0.1:%d user@host", n, n)
		},
		unixFn: func(n int) string {
			if n <= 0 {
				n = 8080
			}
			return fmt.Sprintf("ssh -N -L %d:127.0.0.1:%d user@host", n, n)
		},
		explain: "Forwards a remote service securely to 127.0.0.1 without opening public firewall ports.",
	},
	{
		id:       "git-undo-soft",
		title:    "Undo Last Git Commit (Keep Edits Staged)",
		category: "git",
		keywords: []string{"git", "undo", "revert", "commit", "hoan tac", "huy", "reset", "soft", "quay lai"},
		winFn: func(n int) string {
			if n <= 0 || n > 20 {
				n = 1
			}
			return fmt.Sprintf("git reset --soft HEAD~%d", n)
		},
		unixFn: func(n int) string {
			if n <= 0 || n > 20 {
				n = 1
			}
			return fmt.Sprintf("git reset --soft HEAD~%d", n)
		},
		explain: "Safely rewinds HEAD while keeping all your code changes staged and intact.",
	},
	{
		id:       "git-worktree",
		title:    "Create Isolated Git Worktree for AI Agent",
		category: "git",
		keywords: []string{"git", "worktree", "branch", "agent", "parallel", "nhanh", "tach"},
		winFn:    func(int) string { return "git worktree add -b feat/agent-task ../repo-wt-agent" },
		unixFn:   func(int) string { return "git worktree add -b feat/agent-task ../repo-wt-agent" },
		explain:  "Spins up an isolated checkout on a new branch so parallel Claude/Codex agents never collide.",
	},
	{
		id:       "git-log-graph",
		title:    "Compact Git Commit Graph",
		category: "git",
		keywords: []string{"git", "log", "history", "lich su", "graph", "commits", "xem"},
		winFn: func(n int) string {
			if n <= 0 || n > 100 {
				n = 20
			}
			return fmt.Sprintf("git log --oneline --graph --decorate -n %d", n)
		},
		unixFn: func(n int) string {
			if n <= 0 || n > 100 {
				n = 20
			}
			return fmt.Sprintf("git log --oneline --graph --decorate -n %d", n)
		},
		explain: "Displays a crisp ASCII branch and commit timeline.",
	},
	{
		id:       "files-large",
		title:    "Find Largest Files in Current Folder",
		category: "files",
		keywords: []string{"large", "big", "file", "size", "lon", "nang", "dung luong", "disk", "o cung", "space"},
		winFn: func(n int) string {
			if n <= 0 || n > 50 {
				n = 15
			}
			return fmt.Sprintf("Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First %d @{N='MB';E={[math]::Round($_.Length/1MB,2)}},FullName", n)
		},
		unixFn: func(n int) string {
			if n <= 0 || n > 50 {
				n = 15
			}
			return fmt.Sprintf("find . -type f -printf '%%s %%p\\n' | sort -nr | head -n %d | awk '{printf \"%%.2f MB %%s\\n\", $1/1048576, $2}'", n)
		},
		explain: "Quickly spots oversized caches, logs, or build artifacts consuming disk space.",
	},
	{
		id:       "files-grep",
		title:    "Fast Recursive Text Search in Repo",
		category: "files",
		keywords: []string{"search", "grep", "find", "text", "string", "tim chu", "tim kiem", "code", "rg"},
		winFn:    func(int) string { return `git grep -n "TODO"` },
		unixFn:   func(int) string { return `git grep -n "TODO"` },
		explain:  "Searches tracked repository files instantly while automatically skipping node_modules and .git.",
	},
	{
		id:       "docker-prune",
		title:    "Inspect & Clean Unused Docker Images/Cache",
		category: "docker",
		keywords: []string{"docker", "clean", "prune", "don", "rac", "container", "image", "space"},
		winFn:    func(int) string { return "docker system df && docker builder prune" },
		unixFn:   func(int) string { return "docker system df && docker builder prune" },
		explain:  "Shows Docker disk usage and safely prunes unused build cache layers.",
	},
	{
		id:       "wsl-restart",
		title:    "Restart WSL2 & Reclaim Windows RAM",
		category: "windows",
		keywords: []string{"wsl", "ram", "memory", "restart", "shutdown", "windows", "nang", "bo nho"},
		winFn:    func(int) string { return "wsl --shutdown" },
		unixFn:   func(int) string { return "free -h" },
		explain:  "Cleanly shuts down WSL2 VM to immediately release cached vmmem RAM back to Windows.",
	},
	{
		id:       "dev-go-race",
		title:    "Run Go Race Detector Test Suite",
		category: "dev",
		keywords: []string{"go", "golang", "test", "race", "kiem thu", "build"},
		winFn:    func(int) string { return "go test -race -count=1 ./..." },
		unixFn:   func(int) string { return "go test -race -count=1 ./..." },
		explain:  "Runs all Go unit tests with the race detector enabled and test caching bypassed.",
	},
	{
		id:       "dev-node-clean",
		title:    "Clean & Reinstall Node Dependencies",
		category: "dev",
		keywords: []string{"node", "npm", "node_modules", "reinstall", "clean", "xoa", "cai lai", "vite", "react"},
		winFn:    func(int) string { return "Remove-Item -Recurse -Force node_modules; npm ci" },
		unixFn:   func(int) string { return "rm -rf node_modules && npm ci" },
		explain:  "Performs a deterministic clean install from package-lock.json.",
	},
}

// foldVietnamese removes common Vietnamese diacritics so both accented and unaccented queries match cleanly.
func foldVietnamese(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	repl := strings.NewReplacer(
		"à", "a", "á", "a", "ả", "a", "ã", "a", "ạ", "a",
		"ă", "a", "ằ", "a", "ắ", "a", "ẳ", "a", "ẵ", "a", "ặ", "a",
		"â", "a", "ầ", "a", "ấ", "a", "ẩ", "a", "ẫ", "a", "ậ", "a",
		"đ", "d",
		"è", "e", "é", "e", "ẻ", "e", "ẽ", "e", "ẹ", "e",
		"ê", "e", "ề", "e", "ế", "e", "ể", "e", "ễ", "e", "ệ", "e",
		"ì", "i", "í", "i", "ỉ", "i", "ĩ", "i", "ị", "i",
		"ò", "o", "ó", "o", "ỏ", "o", "õ", "o", "ọ", "o",
		"ô", "o", "ồ", "o", "ố", "o", "ổ", "o", "ỗ", "o", "ộ", "o",
		"ơ", "o", "ờ", "o", "ớ", "o", "ở", "o", "ỡ", "o", "ợ", "o",
		"ù", "u", "ú", "u", "ủ", "u", "ũ", "u", "ụ", "u",
		"ư", "u", "ừ", "u", "ứ", "u", "ử", "u", "ữ", "u", "ự", "u",
		"ỳ", "y", "ý", "y", "ỷ", "y", "ỹ", "y", "ỵ", "y",
	)
	return repl.Replace(s)
}

// Suggest returns up to `limit` ranked shell command suggestions for a natural-language query
// (English or Vietnamese), automatically audited through SLTerm's Command Firewall.
func Suggest(query string, limit int) []Suggestion {
	if limit <= 0 || limit > 12 {
		limit = 5
	}
	folded := foldVietnamese(query)
	num := 0
	if m := numRe.FindStringSubmatch(folded); len(m) == 2 {
		num, _ = strconv.Atoi(m[1])
	}
	tokens := strings.Fields(folded)

	out := make([]Suggestion, 0, len(recipes))
	for _, r := range recipes {
		score := 0
		if len(tokens) == 0 {
			score = 1
		} else {
			hay := foldVietnamese(r.title + " " + r.category + " " + r.explain + " " + strings.Join(r.keywords, " "))
			for _, tok := range tokens {
				if numRe.MatchString(tok) {
					continue
				}
				if strings.Contains(hay, tok) {
					score += 2
				}
				for _, kw := range r.keywords {
					if kw == tok {
						score += 4
					}
				}
			}
			// Bonus when a query contains a port-like number (>= 1024) for network recipes.
			if num >= 1024 && r.category == "network" && score > 0 {
				score += 3
			}
		}
		if score == 0 {
			continue
		}
		winCmd := r.winFn(num)
		unixCmd := r.unixFn(num)
		rec := unixCmd
		if runtime.GOOS == "windows" {
			rec = winCmd
		}
		rep := cmdguard.AnalyzeCommand(rec, cmdguard.AnalyzeOptions{Policy: cmdguard.PolicyMode("balanced")})
		out = append(out, Suggestion{
			ID:          r.id,
			Title:       r.title,
			Category:    r.category,
			WindowsCmd:  winCmd,
			UnixCmd:     unixCmd,
			Recommended: rec,
			Explanation: r.explain,
			Verdict:     string(rep.Verdict),
			RiskScore:   rep.RiskScore,
			Score:       score,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ID < out[j].ID
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
