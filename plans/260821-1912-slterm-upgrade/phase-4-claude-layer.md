# Phase 4 — Claude Code feature layer (Go)

**Est.** 4-6 weeks · **Runtime-independent** · **Depends on:** Phase 1

## Goal

Land the Claude Code workstation capabilities the user asked for, as **Go packages + SLTerm blocks**,
so none of it has to be redone during the runtime swap.

## Important: three of these are net-new, not ports

Verified against source — claude-terminal has **no** skills UI, **no** MCP management, and **no**
workflow engine. What is genuinely liftable is small pure logic, and it is cheaper to write in Go
next to the existing `pkg/wstore` SQLite layer than to re-host a second backend language.

The panel's 10-16 week runtime estimates **do not include this phase**. Budget it separately.

## Work

### 4.1 `pkg/claudesession`

Port as pure logic (no Tauri deps in the originals, so this is a direct translation):

- `encode_cwd` — replace `\`, `/`, `:`, space with `-` (empirically derived, from `claude_session.rs`)
- snapshot/diff of `~/.claude/projects/<encoded>/*.jsonl` around spawn
- **both dedup guards**: only bind if the block had recent user input, and the session is not already
  claimed by another live block. Without these, same-cwd blocks converge on one conversation — a real
  data-corruption bug they hit.
- `planRestoreModes` from `src/lib/restorePlan.ts`, ported verbatim — dependency-free pure logic that
  prevents two blocks hijacking the same Claude conversation.

Session id lives in block meta; `--resume`/`--continue` injected on controller restart.

**Note the flag form**: `--resume=<id>`, not `--resume <id>`. Claude's `--resume` is an *optional*
argument, so Commander.js parses the space form as "open picker" plus a stray positional.

### 4.2 Claude widgets — zero new code

Add Claude entries to `widgets.json` using the existing `cmd` / `cmd:args` / `cmd:cwd` meta
(`pkg/waveobj/metaconsts.go:41,52,57`), managed through the existing
`frontend/app/view/waveconfig/widgets-editor.tsx`.

**This is claude-terminal's Profiles feature delivered as configuration.** No new subsystem.

### 4.3 `pkg/claudeconfig`

CRUD over Claude's on-disk config:

| Target | Layout note |
|---|---|
| `~/.claude/skills/<name>/SKILL.md` | **directory-per-item**, not flat files — a naive clone of `list_claude_agents` (which does `read_dir` + `is_file`) will not enumerate these |
| `~/.claude/agents/*.md` | flat |
| `~/.claude/commands/*.md` | flat |
| `~/.claude.json` → `mcpServers` | plus project-scoped `.mcp.json` |

Parse YAML frontmatter (`name`, `description`) from `SKILL.md` for display. Model **user vs project
scope explicitly** — claude-terminal's modal only handles global `~/.claude` and has no notion of
project scope.

Validation: single-path-segment check on names. claude-terminal's `validate_filename()` blocks `..`
and separators, which is right for flat files but insufficient for addressing a skill *directory*.

### 4.4 `view:claudeconfig` block

Tabbed **Skills / MCP / Agents / Commands** list+editor, modeled on claude-terminal's
`ClaudeConfigModal` `FileListTab` two-pane pattern. Built on the existing `FileList`/`FileRead`/
`FileWrite` RPCs (`wshserver.go:346-374`) and SLTerm's `waveconfig` view conventions.

### 4.5 `pkg/agentteams`

fsnotify-driven read model (follow the `pkg/wconfig/filewatcher.go` pattern) over:

- `~/.claude/teams/*/config.json` — team roster
- `~/.claude/tasks/<team>/*.json` — task board, plus `.highwatermark` for count

Keep the camelCase JSON keys (`agentId`, `leadAgentId`, `activeForm`, `blockedBy`) — they come from
Claude Code, not from us. Path-traversal check on `team_name` before any path join (it flows from the
UI; without validation it is an arbitrary-file-read vector).

Parse leniently, but **surface a visible degraded state** rather than claude-terminal's silent
`catch {}` / `continue` — their panel shows nothing at all if the format drifts.

fsnotify instead of their 3s poll: instant updates, no periodic disk reads.

### 4.6 `view:agentteams` block

Leader/teammate tree + task board (status, owner, `activeForm`, blocked) with jump-to-block by
normalized `cmd:cwd`. Widget + keybinding.

**Read-only, matching upstream.** There is no create/edit/kill-team capability to port; adding one is
separate work.

### 4.7 Embedded OTLP endpoint — per-block cost/token HUD

Host an OTLP/JSON endpoint on the existing `pkg/web` listener. Inject at shell spawn in
`pkg/blockcontroller`:

```
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=<local>
OTEL_METRIC_EXPORT_INTERVAL=3000
OTEL_METRICS_INCLUDE_SESSION_ID=true
OTEL_RESOURCE_ATTRIBUTES=terminal.id=<block id>
```

**DELTA temporality summation** is the non-obvious detail — metrics arrive as deltas and must be
accumulated, not read as gauges. Re-emit as a metrics event to the UI.

Optional: session budget cap with a notification when exceeded.

## Validation

- Skills with nested resource dirs enumerate correctly (the flat-file bug does not reproduce).
- MCP servers listed from both `~/.claude.json` and a project `.mcp.json`, scopes distinguished.
- Two blocks in the same cwd never bind to the same Claude session (test the claim guard directly).
- Restart restores blocks and reattaches conversations; `planRestoreModes` unit-tested.
- Agent teams panel updates within ~1s of a task file change; malformed JSON shows a degraded state,
  not silence.
- Cost HUD matches `claude`'s own reported cost for a session.

## Risk

**Everything here depends on undocumented private on-disk contracts**: the `~/.claude/projects`
layout, the empirical cwd encoding, `~/.claude/teams`, `~/.claude/tasks`, `.highwatermark`, the
skills directory layout, the `mcpServers` shape. Any Claude Code update can silently break resume or
blank the teams panel.

Mitigation: isolate every assumption in these three packages, parse leniently, version-detect where
possible, and always surface a visible degraded state. Never let a format drift look like "no data".
