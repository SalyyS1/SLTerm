// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package projectdetect implements SLTerm's lightweight ADE Project Doctor:
// inspects any local repository directory to detect tech stacks, extract runnable
// dev/test/build commands (package.json, Cargo.toml, go.mod, Makefile, pyproject.toml),
// check ADE readiness (.worktreeinclude, CLAUDE.md, AGENTS.md, .mcp.json), and
// generate a safe starter `.worktreeinclude` in 1 click.
package projectdetect

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ProjectCommand describes one runnable dev/test/build command discovered in a project.
type ProjectCommand struct {
	Label   string `json:"label"`
	Command string `json:"command"`
	Source  string `json:"source"` // package.json | go.mod | Cargo.toml | Makefile | pyproject.toml
}

// ProjectReport summarizes detected stacks, runnable scripts, and ADE readiness files.
type ProjectReport struct {
	Dir                string           `json:"dir"`
	Name               string           `json:"name"`
	Stacks             []string         `json:"stacks"`
	Commands           []ProjectCommand `json:"commands"`
	HasGit             bool             `json:"hasGit"`
	HasClaudeMD        bool             `json:"hasClaudeMd"`
	HasAgentsMD        bool             `json:"hasAgentsMd"`
	HasMcpJSON         bool             `json:"hasMcpJson"`
	HasWorktreeInclude bool             `json:"hasWorktreeInclude"`
	HasDotEnv          bool             `json:"hasDotEnv"`
	EnvExampleCount    int              `json:"envExampleCount"`
	MissingEnvKeys     []string         `json:"missingEnvKeys,omitempty"`
}

func parseEnvKeysOnly(path string) map[string]bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	keys := make(map[string]bool)
	for _, ln := range strings.Split(string(raw), "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "#") {
			continue
		}
		ln = strings.TrimPrefix(ln, "export ")
		idx := strings.IndexByte(ln, '=')
		if idx <= 0 {
			continue
		}
		k := strings.TrimSpace(ln[:idx])
		if k != "" {
			keys[k] = true
		}
	}
	return keys
}

func checkEnvDrift(abs string) (int, []string) {
	var exKeys map[string]bool
	for _, name := range []string{".env.example", ".env.sample", ".env.template"} {
		if m := parseEnvKeysOnly(filepath.Join(abs, name)); len(m) > 0 {
			exKeys = m
			break
		}
	}
	if len(exKeys) == 0 {
		return 0, nil
	}
	present := make(map[string]bool)
	for _, name := range []string{".env", ".env.local", ".env.development"} {
		for k := range parseEnvKeysOnly(filepath.Join(abs, name)) {
			present[k] = true
		}
	}
	missing := make([]string, 0)
	for k := range exKeys {
		if !present[k] {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	return len(exKeys), missing
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// Inspect scans `dir` non-recursively (instant, <2ms) and returns a ProjectReport.
func Inspect(dir string) (*ProjectReport, error) {
	clean := strings.TrimSpace(dir)
	if clean == "" {
		return nil, errors.New("project directory is required")
	}
	if strings.ContainsRune(clean, '\x00') {
		return nil, errors.New("invalid NUL byte in directory path")
	}
	abs, err := filepath.Abs(clean)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		return nil, errors.New("directory does not exist")
	}

	rep := &ProjectReport{
		Dir:                abs,
		Name:               filepath.Base(abs),
		Stacks:             make([]string, 0, 6),
		Commands:           make([]ProjectCommand, 0, 12),
		HasGit:             fileExists(filepath.Join(abs, ".git")),
		HasClaudeMD:        fileExists(filepath.Join(abs, "CLAUDE.md")),
		HasAgentsMD:        fileExists(filepath.Join(abs, "AGENTS.md")),
		HasMcpJSON:         fileExists(filepath.Join(abs, ".mcp.json")),
		HasWorktreeInclude: fileExists(filepath.Join(abs, ".worktreeinclude")),
		HasDotEnv:          fileExists(filepath.Join(abs, ".env")) || fileExists(filepath.Join(abs, ".env.local")),
	}

	// Node / JS / TS / Vite / Next
	if raw, err := os.ReadFile(filepath.Join(abs, "package.json")); err == nil {
		rep.Stacks = append(rep.Stacks, "Node.js")
		var pkg struct {
			Scripts         map[string]string `json:"scripts"`
			Dependencies    map[string]string `json:"dependencies"`
			DevDependencies map[string]string `json:"devDependencies"`
		}
		if json.Unmarshal(raw, &pkg) == nil {
			if _, ok := pkg.Dependencies["next"]; ok {
				rep.Stacks = append(rep.Stacks, "Next.js")
			}
			if _, ok := pkg.DevDependencies["vite"]; ok {
				rep.Stacks = append(rep.Stacks, "Vite")
			}
			keys := make([]string, 0, len(pkg.Scripts))
			for k := range pkg.Scripts {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				if len(rep.Commands) >= 12 {
					break
				}
				rep.Commands = append(rep.Commands, ProjectCommand{
					Label:   "npm:" + k,
					Command: "npm run " + k,
					Source:  "package.json",
				})
			}
		}
	}

	// Go
	if fileExists(filepath.Join(abs, "go.mod")) {
		rep.Stacks = append(rep.Stacks, "Go")
		rep.Commands = append(rep.Commands,
			ProjectCommand{Label: "go test", Command: "go test -race ./...", Source: "go.mod"},
			ProjectCommand{Label: "go build", Command: "go build ./...", Source: "go.mod"},
		)
	}

	// Rust / Tauri
	if fileExists(filepath.Join(abs, "Cargo.toml")) || fileExists(filepath.Join(abs, "src-tauri", "Cargo.toml")) {
		rep.Stacks = append(rep.Stacks, "Rust")
		if fileExists(filepath.Join(abs, "src-tauri", "tauri.conf.json")) {
			rep.Stacks = append(rep.Stacks, "Tauri 2")
		}
		cargoPrefix := "cargo"
		if !fileExists(filepath.Join(abs, "Cargo.toml")) {
			cargoPrefix = "cargo --manifest-path src-tauri/Cargo.toml"
		}
		rep.Commands = append(rep.Commands,
			ProjectCommand{Label: "cargo test", Command: cargoPrefix + " test", Source: "Cargo.toml"},
			ProjectCommand{Label: "cargo build", Command: cargoPrefix + " build", Source: "Cargo.toml"},
		)
	}

	// Python
	if fileExists(filepath.Join(abs, "pyproject.toml")) || fileExists(filepath.Join(abs, "requirements.txt")) {
		rep.Stacks = append(rep.Stacks, "Python")
		rep.Commands = append(rep.Commands,
			ProjectCommand{Label: "pytest", Command: "pytest", Source: "pyproject.toml"},
		)
	}

	// Java / Gradle / Minecraft
	if fileExists(filepath.Join(abs, "build.gradle")) || fileExists(filepath.Join(abs, "build.gradle.kts")) {
		rep.Stacks = append(rep.Stacks, "Gradle/Java")
		rep.Commands = append(rep.Commands,
			ProjectCommand{Label: "gradle build", Command: "./gradlew build", Source: "build.gradle"},
		)
	}

	// Docker
	if fileExists(filepath.Join(abs, "Dockerfile")) || fileExists(filepath.Join(abs, "docker-compose.yml")) || fileExists(filepath.Join(abs, "compose.yml")) {
		rep.Stacks = append(rep.Stacks, "Docker")
	}

	rep.EnvExampleCount, rep.MissingEnvKeys = checkEnvDrift(abs)

	return rep, nil
}

const defaultWorktreeIncludeBody = `# SLTerm Auto-Hydrated Agent Worktree Include List
# Relative files listed here are safely copied into new isolated agent worktrees.
.env
.env.local
.mcp.json
CLAUDE.md
AGENTS.md
`

// EnsureWorktreeInclude writes a starter `.worktreeinclude` file in `dir` if missing.
func EnsureWorktreeInclude(dir string) (string, bool, error) {
	abs, err := filepath.Abs(strings.TrimSpace(dir))
	if err != nil {
		return "", false, err
	}
	target := filepath.Join(abs, ".worktreeinclude")
	if fileExists(target) {
		return target, false, nil
	}
	if err := os.WriteFile(target, []byte(defaultWorktreeIncludeBody), 0644); err != nil {
		return "", false, err
	}
	return target, true, nil
}

// AllowedContextFiles restricts inline editing strictly to non-secret AI/ADE config files.
var allowedContextFiles = map[string]string{
	"CLAUDE.md":        "# Project Instructions for Claude Code\n\n- Build/test commands:\n- Architecture rules:\n",
	"AGENTS.md":        "# Project Instructions for AI Coding Agents\n\n- Conventions:\n- Verification steps:\n",
	".worktreeinclude": defaultWorktreeIncludeBody,
	".gitignore":       ".env\n.env.local\nnode_modules/\ndist/\n",
}

const maxContextFileBytes = 256 * 1024 // 256 KiB safety cap

// ReadContextFile reads an allowlisted project ADE context file (never secrets like .env).
func ReadContextFile(dir, name string) (string, bool, error) {
	if _, ok := allowedContextFiles[name]; !ok {
		return "", false, errors.New("file is not in the allowlisted ADE context set")
	}
	abs, err := filepath.Abs(strings.TrimSpace(dir))
	if err != nil {
		return "", false, err
	}
	p := filepath.Join(abs, name)
	info, err := os.Lstat(p)
	if os.IsNotExist(err) {
		return allowedContextFiles[name], false, nil
	}
	if err != nil {
		return "", false, err
	}
	if !info.Mode().IsRegular() {
		return "", false, errors.New("refusing to read non-regular file or symlink")
	}
	if info.Size() > maxContextFileBytes {
		return "", false, errors.New("context file exceeds 256 KiB limit")
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return "", false, err
	}
	return string(raw), true, nil
}

// WriteContextFile writes an allowlisted project ADE context file safely (refuses symlinks & traversal).
func WriteContextFile(dir, name, content string) (string, error) {
	if _, ok := allowedContextFiles[name]; !ok {
		return "", errors.New("file is not in the allowlisted ADE context set")
	}
	if len(content) > maxContextFileBytes {
		return "", errors.New("content exceeds 256 KiB limit")
	}
	abs, err := filepath.Abs(strings.TrimSpace(dir))
	if err != nil {
		return "", err
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		return "", errors.New("project directory does not exist")
	}
	p := filepath.Join(abs, name)
	if info, err := os.Lstat(p); err == nil && !info.Mode().IsRegular() {
		return "", errors.New("refusing to overwrite non-regular file or symlink")
	}
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		return "", err
	}
	return p, nil
}
