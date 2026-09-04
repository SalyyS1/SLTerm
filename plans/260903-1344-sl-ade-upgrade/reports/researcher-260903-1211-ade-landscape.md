# ADE Landscape Research — Orca ADE + peers → SL-ADE feature ranking

Date: 2026-09-03 | Researcher: researcher subagent | Status: COMPLETE
Scope: read-only research for a plan. No source file modified.

## 0. Method & source-reliability note

`WebSearch` was hard-down for this session (`web_search: no available accounts`), and DuckDuckGo HTML served a bot challenge while Reddit refused fetching from this host. Research therefore ran on: `gh search repos` / `gh search code` for discovery, `gh api repos/...` for verifiable metadata (stars, license, created/pushed dates, open-issue counts, release asset sizes), `gh api .../contents` + `.../git/trees` to read vendors' own docs straight from their repos, and `WebFetch` for vendor marketing/pricing pages. Source weighting used: **repo API facts > vendor docs in-repo > vendor marketing page > third-party repo README**. Sentiment is drawn from GitHub issue reaction/comment counts because HN and Reddit were unreachable — a biased sample, flagged where used. Every number in this report has a retrieval path; items that do not are labelled UNVERIFIED.

## A. Orca ADE

### A.1 Disambiguation (which "Orca")

`gh search repos "orca agent"` returns several unrelated products. Enumerated:

| Candidate | What it is | Verdict |
|---|---|---|
| **stablyai/orca** — "Orca is the ADE for working with a fleet of parallel agents" (60,592★, MIT, TS, created 2026-03-17, pushed 2026-09-03) | Desktop app orchestrating many CLI coding agents in git worktrees | **THIS IS IT.** Self-describes as ADE; topics `ade, agent-ide, parallel-agents, worktrees, orchestration, yc-backed` |
| echoVic/orca-agent (503★, Rust) | "Orca is a DeepSeek-native coding agent" | No — a single CLI agent, not an environment |
| Danau5tin/Orca-Agent-RL (102★) | Qwen3-14B orchestrator RL research | No |
| Microsoft Orca / Orca-2 LLM series | Instruction-tuned models | No |
| Orca Security | Cloud security posture vendor | No |
| Orca Note (sethyuan/orcanote-agent-skills) | Note-taking app | No |

Third-party ecosystem confirms stablyai/orca is the one people mean by "Orca ADE": `stslex/orca-nix` ("Nix flake for Orca, the agentic development environment"), `nvergez/orca-viz` (orchestration DAG viewer), `shikihane/orca-osw` (agent supervisor), `mikelgmh/orca-selfhost`, `baksohyeon/mogui-ADE-orchestrator`, `vankhangfet/orca-sdlc-kit`, `howardpen9/orca-bug-repros`, `thiagocorreanet/orca-drawio`, `riccardo-algorime/orca-discord-presence`, `wilgon456/orca-agent-cleanup`.

### A.2 Identity: maker, stack, install size, pricing

| Field | Value | Source |
|---|---|---|
| Maker | Stably AI, San Francisco, YC-backed | `onorca.dev` footer "© 2026 Stably AI"; "Backed by Y Combinator" |
| Repo / site | github.com/stablyai/orca · onorca.dev (note: `orca.dev` itself fails TLS handshake) | `gh api repos/stablyai/orca` |
| License | MIT, fully open source | repo `license.spdx_id = MIT` |
| Stack | Electron + TypeScript. Monaco/VS Code editor, embedded Chromium, WebGL "Ghostty-class" terminal, SQLite orchestration DB, pnpm workspaces, `cloud/` relay service | release assets `latest.yml`/`.blockmap` = electron-builder; README; orca-viz reads SQLite via `node:sqlite` |
| Version cadence | v1.4.194 (2026-09-01), .195 (09-02), .196 (09-03) — **daily releases**, ~196 patch releases on 1.4.x | `gh api .../releases` |
| Install size | Win NSIS 172 MB · Linux AppImage 194 MB · deb 154 MB · rpm 134 MB · macOS dmg 192–197 MB | release asset sizes, v1.4.196 |
| Adoption signal | 60.6k★, 4,074 forks, 5,184 open issues; single release drew 14.2k Windows-exe downloads in ~1 day | `gh api` |
| Pricing | Free, MIT. No tiers or dollar figures published; an Enterprise page is linked but terms not shown; FAQ "Is it free?" collapsed. **Monetization = UNVERIFIED** | onorca.dev |
| BYO-subscription model | "Run any coding agent with your own subscription" — no API key or model endpoint required; Orca sells no inference | repo description |
| Windows status | First-class: `orca-windows-setup.exe`, code signing **sponsored by SignPath.io / SignPath Foundation** (OSS cert program) | README "Signed Builds" |
| Distribution | Homebrew cask `stablyai/orca/orca`, AUR `stably-orca-bin`, Nix flake (3rd-party), iOS App Store (id6766130217), Android APK, `orca serve` headless on Linux | README Install |

### A.3 Feature set & UX model

Source for this whole subsection: `stablyai/orca` docs tree `docs/site/content/docs/**` (read via `gh api contents`) + README + onorca.dev.

**Organizing unit = the git worktree.** "An agent session is one CLI agent running in one terminal in one worktree" (`docs/model/agents-sessions.mdx`). Each worktree owns its own tab layout; "switching worktrees swaps the entire pane tree — your browser tab, terminal, and diff reappear exactly as you left them" (`docs/model/tabs-panes-splits.mdx`). Worktrees can be local, on an SSH host, on an always-on Orca Server, or on a freshly provisioned cloud VM (`docs/ways-to-run.mdx`, onorca.dev).

**Panel layout.** Tabs hold exactly one thing (terminal / editor buffer / browser / diff / PR) and live in tab groups; drag a tab to a pane edge to split (right = horizontal, bottom = vertical); splits nest; **pane boundaries are pinned and persisted per worktree** so window resize never reshuffles the layout. Terminal tabs additionally split inside the tab.

**Agent-state model (the core differentiator).** State is inferred from the terminal's **OSC title sequence plus agent hooks**, giving shared glyphs on both agent tabs and worktree rows: spinner = working, amber `?` = waiting on you, emerald check/dot = done, red = blocked/failed, gray = idle, no glyph = plain shell. Consequence: Orca gets liveness for *any* CLI agent without integrating each one's API.

**Parallel-agent handling, two tiers:**
1. *Fan-out (stable)* — "Fan one prompt across five agents, each in its own isolated git worktree — compare the results and merge the winner" (README).
2. *Orchestration (experimental, Settings → Experimental, localStorage `orca.orchestration.enabled`)* — a real supervisor/worker protocol with primitives **Run** (durable namespace + coordinator inbox), **Task** (spec + dependencies + status `pending|ready|dispatched|completed|failed|blocked`), **Dispatch** (one attempt on one terminal; lifecycle authority), **Message** (`status|dispatch|worker_done|escalation|question|heartbeat`), **Decision gate** (coordinator-owned question that blocks a task). Driven from the CLI (`orca orchestration run-create / task-create / worker-start --worktree new-child --agent codex --model … --effort high / check --wait --types worker_done,escalation,question / send --type worker_done --task-id --dispatch-id`). `task_...` IDs printed in terminals are clickable and focus the assigned terminal, including across SSH/remote runtimes. State lives in a local SQLite DB with the coordinator as single writer (`nvergez/orca-viz` README).

**Task board.** *Agent Dashboard* (experimental, no default keybinding): kanban across all worktrees, columns **Needs You / Working / Done / Idle** (idle = no completion reported ~30 min, hidden by default), search over worktree/project/agent, multi-select filters for Project / Workspace status / **PR-MR status (Open, Draft, Merged, Closed, No review)**, removable filter chips. Cards show agent icon, conversation name, state glyph, last message preview, project + worktree + age, cached review state; amber tint = needs you, green = done; click focuses that agent's live terminal; **nested Codex/Claude subagents appear as expandable children**. Opens in-window or as a pop-out window, the two stay in sync.

**Diff/review flow + git depth.** Diff viewer, **annotate AI diffs** (comment on any diff line, ship comments back to the agent), commit + push + PR drafting from the diff, attribution (which agent wrote what), native GitHub / Linear / Jira browsing where a task opens a worktree. Git depth *stops* at worktrees + diff + commit/push: no git graph, no blame, no LSP-grade code intel (all open feature requests, §A.4).

**Notifications.** Working→idle transition fires an agent-finished notification; unread state on threads so you can defer. Mobile companion (iOS App Store + Android APK) pairs through a hosted relay (`cloud/apps/relay`) to notify and let you send follow-ups from a phone.

**Cost/token visibility.** Deliberately *not* dollar cost — Orca sells no inference. Instead **usage tracking**: per-account Claude/Codex usage meters with **5h / 7d rate-limit windows and reset times**, plus account hot-swap without re-login (`docs/agents/usage-tracking.mdx`, `codex-hot-swap.mdx`).

**Keyboard model.** Quick open `Cmd/Ctrl+J` across worktrees, files, agents, commands, repo context. Splits `Cmd+D` / `Cmd+Shift+D`. Tab cycling `Cmd/Ctrl+Shift+[ ]` (all types) and `Cmd+Option/Ctrl+Alt+[ ]` (same type), `Ctrl+Tab` = previous recent. Everything remappable in Settings → Shortcuts, persisted to **`~/.orca/keybindings.json`**.

**Notable extras.** Embedded Chromium + **Design Mode** (click a live UI element → its HTML, CSS and cropped screenshot go into the agent prompt) with per-worktree browser profiles; Monaco/VS Code editor with autosave everywhere and drag files/images into a prompt; Markdown/image/PDF viewers; agent **hibernation**; session history; **native chat UI** for some agents; skills + hooks + MCP; `orca` CLI that agents themselves drive (`worktree create`, `snapshot`, `click`, `fill`, computer-use, automations, worktree checkpoints); **27 named supported agents + "any CLI agent"**; `orca serve` headless mode.

**Windows status.** Fully supported and signed (SignPath Foundation OSS cert). The repo carries Windows-specific engineering references — `docs/reference/windows-edr-posture.md`, `windows-process-enumeration.md`, `windows-setup-shell.md`, `wsl-command-execution.md`, `wsl-probe-failure-semantics.md`, `wsl-runner-verification.md` — i.e. shipping an agent supervisor on Windows required dedicated work on EDR interference, process enumeration, installer shell, and WSL command execution. Directly relevant to SL-ADE's Windows-first goal.

### A.4 Praise / complaints

No Hacker News story matched `Orca Stably` on the HN Algolia API, and Reddit blocks fetching from this host, so sentiment below is derived from **GitHub issue reactions/comment counts**, which is a biased but verifiable sample. Popularity signals: 60.6k★ in <6 months (created 2026-03-17), 4,074 forks, 14.2k Windows-installer downloads on a single day-old release.

**Praised (inferred from what the product leads with + adoption):** MIT/free with BYO-subscription (no API key, no per-token bill), 27-agent breadth, worktree isolation as the safety story, daily ship cadence, GPU terminal, mobile companion, phone-based supervision.

**Complained about (top open issues, reactions `r` / comments `c`):**

| Gap | Signal | Lesson for SL-ADE |
|---|---|---|
| No multi-repo workspaces / cross-repo diffs | 45r+26r+11r, three separate issues, `size/xl` | Model workspace ⊃ *many* repos from day one |
| No LSP / codebase search; "Go to References returns empty" | 28r, 17r | Terminal+Monaco is not enough; code intel is demanded |
| No multiple windows | 16r, 10c | SLTerm already has multi-window in Electron; keep it in Tauri |
| Daemon leak: "app updates leave previous daemon generations running forever — invisible agent sessions accumulate and exhaust memory" | 12c bug | Update path must reap old backend generations |
| Windows relay failures (`os:Windows`), Windows marketplace staging dirs growing to multiple GB | 15r, 9c | Windows-first means owning these classes of bug |
| Terminal IME: duplicate CJK text, content disappearing; images can no longer be pasted into TUI | 26c, 15c, plus `docs/reference/ime-regression-checklist.md` | IME correctness is a recurring tax on custom terminals — matters for a VN/CJK author |
| Idle-detection false positives lose an injected dispatch ("slow Claude startup lets tui-idle false-positive") | 11c | OSC/heuristic state detection is fragile; needs an explicit protocol fallback |
| No git graph, no git blame | 18r, 13r | Cheap wins SLTerm's planned `pkg/vcs` can beat them on |
| No Docker/sandbox isolation for agents (agents launch with `--dangerously-skip-permissions` by default) | 15r | Real differentiator available: a trust/confinement model |
| No plugin system; no chat-based UI; no auto-resume after session limit | 27c, 11r/10c, 10c | Extensibility + non-terminal UI are unmet demand |
| Triage debt: 5,184 open issues | `gh api` | Velocity has a cost; do not copy the "ship daily, triage never" pattern |

## B. Peers

### B.1 Warp (Agentic Development Environment)

`warpdotdev/warp`: 64,773★, Rust, AGPL-3.0, created 2021-07-08, 5,168 open issues (repo functions largely as issue tracker; whether the full client source lives there is **UNVERIFIED**). Repo description is the ADE claim: *"Warp is an agentic development environment, born out of the terminal."* Notably the phrase does **not** appear on warp.dev/pricing — there the taglines are "A modern terminal for agentic coding", "Warp Agent CLI … works in any terminal", and **Warp Factories**: "Run fleets of coding agents across your SDLC". Platforms: Windows 10/11 x64 + ARM64 (`winget install Warp.Warp`), macOS 10.14+, Linux deb/rpm/tar.zst/AppImage — the broadest OS coverage of the peer set. Pricing (credits, not requests): Free $0 (no included credits) · Build $20/mo (1,500 credits) · Max $200/mo (18,000) · Business $50/user/mo (25-seat cap) · Enterprise custom (BYOLLM, self-hosted cloud agents, cross-harness agent memory in research preview). Features named: **autonomy dial** ("from approving every step to allowing full autonomy"), parallel tasks across *different models*, first-pass PR review, GitHub/Slack/Linear, Warp Drive, team usage metrics with "cost per PR and automation rate". Absent from that page: any diff viewer, blocks, task board, notifications, or agent-manager panel. **Read: Warp monetizes inference; its "ADE" is agent-fleet + terminal, not a worktree workbench.**

### B.2 Conductor (conductor.build)

macOS only ("Get Conductor running on your Mac"), v0.84.0, drives Claude Code, Codex, Cursor, OpenCode. Maker not named on site — **UNVERIFIED**. Core model is *task-centric*, not worktree-centric: **"Each task gets its own workspace, branch, files, terminal, diff, and review path."** Lifecycle is a single line: "review the diff, open a pull request, merge, and archive the workspace." Git worktrees are never mentioned (branch + separate checkout is consistent with them but unconfirmed). Docs pages: `concepts/workspaces-and-branches`, `concepts/workflow`, `concepts/parallel-agents`, `concepts/agent-modes`, `reference/diff-viewer`, `reference/checks` (per-workspace validation feeding review), `api`. Pricing: Free $0 (parallel agents, local workspaces, BYO subscription/keys) · **Pro $50/mo** · **Teams $60/user/mo** (invite-only, admin portal) · Enterprise (DPA, SAML SSO/SCIM, SLA). Cloud workspaces are paid-only: Amazon Linux 2023, 8-core/16 GB, Vercel sandboxes in us-east-1, with usage-based cloud pricing "planned". Local sessions die with the app; cloud work persists. Multiplayer, API, and a mobile app are paid/coming. **Read: the only peer charging real money for the shell itself — $50/mo for a Mac-only orchestrator is the price ceiling this category has proven.**

### B.3 Crystal

`stravu/crystal`: 3,116★, MIT, TypeScript, created 2025-06-05, **last push 2026-02-26 → ~6 months stale**, 68 open issues. Description now reads *"(Crystal is now Nimbalyst)"* with homepage `nimbalyst.com`: "Run multiple Codex and Claude Code AI sessions in parallel git worktrees. Test, compare approaches & manage AI-assisted development workflows in one desktop app." **Adoption risk: high.** Crystal was the original OSS worktree-per-session desktop app and is now a rebranded/likely-commercial successor with a dormant public repo. Useful as a design reference, not as a dependency or a competitor to fear.

### B.4 Vibe Kanban

`BloopAI/vibe-kanban`: 27,998★, Apache-2.0, Rust, created 2025-06-14, **last push 2026-04-24 → ~4 months stale**, 539 open issues, `vibekanban.com`. "Get 10X more out of Claude Code, Codex or any coding agent." The product that proved the *kanban-over-agents* metaphor (Orca's Agent Dashboard is the same idea, in-app). **Adoption risk: elevated** — 28k stars with a 4-month-quiet repo and a large open-issue backlog suggests the star count outran maintenance. Take the metaphor, not the code.

### B.5 Zed agent panel

`zed-industries/zed`: 89,698★, Rust, GPL/AGPL mix (`NOASSERTION`), pushed today. The most *architecturally* instructive peer because it bolts agents onto an editor rather than a terminal. Concurrent **threads**, each with its own agent, context window and history; Threads Sidebar grouped by project; `ctrl-tab` thread cycling; archive; cross-project Thread History; **New From Summary** (fresh thread seeded with a summary of the current one); Terminal threads. Parallel agents are first-class and **a worktree picker sits in the title bar** to isolate a thread in a new git worktree when two threads may touch the same files. Review: **multi-buffer tab** listing every change with per-hunk accept/reject, or inline per-file review via `agent.single_file_review`; plus **Restore Checkpoint** to roll the codebase back to its pre-edit state even after a mid-edit interruption. Token usage for the active thread renders next to the profile selector; long threads **auto-compact** into an expandable "Context Compacted" entry (`/compact`, `agent.auto_compact`), with a Start New Thread banner for models under 80k context. External agents attach via **ACP** (Agent Client Protocol) — and the docs warn that history restore, checkpoints and token display each depend on the individual integration. Rich documented keymap (`cmd-n` new thread, `cmd-alt-j` sidebar, `ctrl-shift-r` Review Changes, `cmd->` add selection).

### B.6 Cursor background agents

Renamed: "Cloud Agents were formerly called Background Agents" (cursor.com/docs/background-agent). They run in **Cursor-managed isolated cloud VMs** with cloned repos, installed deps, secrets, startup commands and network access; environments come from agent-led setup, a saved snapshot, or a Dockerfile referenced by `.cursor/environment.json`, with **Builds** pre-warming them. Isolation is by **git branch, not worktree** — "work on a separate branch, then push changes to your repo for handoff"; repos from GitHub, GitLab, Azure DevOps, Bitbucket Cloud. Output is a **merge-ready PR plus artifacts (screenshots, videos, logs)**; you can seize the agent's remote desktop to exercise the app, then hand control back; a shared run URL is read-only unless an admin enables team follow-ups; a **Cursor Cloud MCP** exposes transcripts, run events and setup logs. Parallelism: "run as many agents as you want in parallel" (long-running not yet available for multi-repo). Notifications: Slack only, documented. Billing: API pricing for the selected model, spend limit prompt, paid plan required. **Read: the pure-cloud pole of the category — nothing to copy for a local Windows ADE except the artifacts-as-proof idea.**

### B.7 Google Antigravity

"Google Antigravity is our agentic development platform, allowing anyone to build in the agent-first era." Four surfaces: **Antigravity 2.0** — "your command center to manage multiple local agents in parallel", with conversations grouped into **Projects**, work spanning several workspaces, and **scheduled messages** for recurring chores; **Antigravity CLI** — terminal-first, autonomous agents, direct shell execution, keyboard-driven **background subagents**; **Antigravity IDE** — ships "the agent manager, artifacts, and a deep understanding of your codebase"; **Antigravity SDK** (Python) + **Extensions**. Also browser-in-the-loop agents, **artifacts + verification tests**, and **Remote Control** (antigravity.google.com) so sessions resume from a browser. Free for individuals ("Available at no charge"); organizations via Gemini Enterprise. **Platforms: the homepage offers only "Apple Silicon" and "Intel" downloads — Windows and Linux are not mentioned there (UNVERIFIED whether Windows builds exist elsewhere).** Antigravity also appears as a supported CLI agent inside Orca, so it is both a peer and a plug-in target.

### B.8 Kiro (AWS)

A subscription spanning "Kiro IDE, Kiro CLI, Kiro on the web, Kiro Crew, ACP compatible IDEs" plus CI/CD; routing requests through third-party harnesses is disallowed (relevant: an ADE that wraps Kiro's CLI may violate its terms — **check before listing Kiro as a supported agent**). Billed in credits: Free 50/mo · Pro $20/user (1,000) · Pro+ $40 (2,000) · Pro Max $100 (5,000) · Power $200 (10,000); add-on credits $0.04 each, monthly credits do not roll over, GovCloud ~20% higher with no free tier. Distinctive features: **specs** (spec mode, spec refinement, task execution), **hooks**, **Powers** (no extra charge). Platform list absent from the pricing page. **Read: spec-driven planning as a first-class artifact is Kiro's differentiator, and it is the one thing in this list nobody else productizes.**

### B.9 OpenAI Codex "app"

There is no standalone "Codex desktop app": Codex ships **inside the ChatGPT desktop app** (`/codex/app`), listed as a peer of Codex CLI (`/codex/cli`) and the Codex IDE extension (`/codex/ide`). Configuration docs carry dedicated **Linux desktop app** and **Windows app** pages plus a **Windows sandbox** and WSL page; macOS is implied. Surfaces: left sidebar with New chat / Search / Pinned / **Projects** / Chats; a composer with an execution selector ("On my computer") plus **project and branch pickers**; **git worktrees** documented as an environment mode alongside local and cloud (`/codex/environments/git-worktrees`); Codex cloud, "Long-running work", **Codex Micro**, and **scheduled tasks that fire on Gmail / Slack / GitHub events**; a **Pull requests** sidebar entry with `/codex/code-review` and **auto-review** under sandboxing; `/codex/notifications`; browser control (Chrome, Edge, Brave, Opera, Vivaldi), computer use, voice, plugins/skills, appshots, integrated terminal, permission modes. `openai/codex` (the CLI) is 121,162★, Apache-2.0, Rust, 15,040 open issues. Plan requirements not stated on that page — **UNVERIFIED**. **Read: OpenAI is converging the chat client into an ADE; branch/worktree pickers and event-triggered scheduled tasks are the parts worth stealing.**

### B.10 Others found

All rows verified via `gh api repos/...` on 2026-09-03. Sorted by stars.

| Repo | ★ | Lang | License | Created | Last push | What it adds to the picture |
|---|---|---|---|---|---|---|
| `openchamber/openchamber` (openchamber.dev) | 9,531 | TS | MIT | 2025-09-11 | 2026-09-03 | "ADE based on OpenCode AI agent" — single-agent-vendor ADE, actively shipped, 691 open issues |
| `generalaction/emdash` (emdash.com) | 5,584 | TS | Apache-2.0 | 2025-08-28 | 2026-09-03 | "Open-Source ADE (YC W26). Run multiple coding agents in parallel. Use any provider." Orca's closest OSS rival |
| `fynnfluegge/agtx` | 1,472 | **Rust** | Apache-2.0 | 2026-02-08 | 2026-09-02 | "The blackboard for coding agents" — blackboard (shared-state) coordination metaphor instead of kanban; only 18 open issues, tight scope |
| `dcouple/Pane` (runpane.com) | 442 | TS | NOASSERTION | 2026-02-27 | 2026-09-01 | Terminal-first, agent-agnostic, **explicitly "any OS (mac, windows, linux)"**, self-hostable "Remote Pane" to drive agents from a phone, `runpane` CLI |
| `bearlyai/OpenADE` (openade.ai) | 409 | TS | none | 2026-02-04 | 2026-07-24 | "ADE for Devs Who Don't Ship Slop" — quality-gate positioning; 1.5 months quiet |
| `termio-sh/termio` (termio.sh) | 392 | **Swift** | MIT | 2026-05-23 | 2026-09-03 | "Runtime for coding agents, tmux alternative", remote Linux VPS — the tmux-replacement framing |
| `kaanozhan/Frame` | 327 | JS | — | — | 2026-09-03 | "spec-driven environment … where your planning becomes lasting, shared project context" |
| `per-simmons/damon-ade` | 96 | TS | — | — | 2026-08-22 | macOS-only "roster of persistent coding agents, each with its own repo, runtime CLI, and memory" — per-agent identity/memory model |
| `crisogray/claudius` | 91 | TS | — | — | 2026-08-06 | minimal ADE |
| `agentty-xyz/agentty` | 35 | Rust | — | — | 2026-09-03 | ADE as a pure TUI |
| `Xircth/VibeX` | 34 | Rust | — | — | 2026-09-03 | "IADE — Integrated Agent Development Environment" |

Third-party Orca ecosystem worth noting as a pattern: `nvergez/orca-viz` (15★) exists **only because Orca's orchestration UI is weaker than its orchestration data** — someone shipped an out-of-app DAG viewer against a read-only SQLite copy. If SL-ADE builds an orchestration store, expose the DAG in-app or expect the same.

### B.11 Peer comparison matrix

Legend: ✅ = documented, ➖ = partial/experimental, ❌ = not found in docs, ? = unverified.

| | Orca | Warp | Conductor | Crystal | VibeKanban | Zed | Cursor Cloud | Antigravity | Kiro | Codex/ChatGPT |
|---|---|---|---|---|---|---|---|---|---|---|
| Windows desktop | ✅ signed | ✅ +winget | ❌ mac only | ? | ? | ✅ | n/a cloud | ❌ not on site | ? | ✅ dedicated docs |
| Local-first | ✅ | ✅ | ✅ (cloud paid) | ✅ | ✅ | ✅ | ❌ | ✅ | ➖ | ➖ |
| Free / OSS shell | ✅ MIT | ➖ AGPL repo, paid credits | ❌ $50/mo Pro | ✅ MIT | ✅ Apache | ✅ | ❌ | ✅ free | ❌ credits | ❌ |
| BYO agent subscription | ✅ 27 agents | ❌ sells credits | ✅ | ✅ | ✅ | ➖ ACP | ❌ | ❌ | ❌ | ❌ |
| Worktree per agent | ✅ | ❌ | ➖ branch+workspace | ✅ | ➖ | ✅ picker | ❌ branches | ➖ workspaces | ? | ✅ documented mode |
| Kanban/board of agents | ➖ experimental | ❌ | ? | ❌ | ✅ core | ➖ sidebar | ➖ dashboard | ➖ "command center" | ❌ | ➖ sidebar |
| Supervisor→worker protocol | ✅ Run/Task/Dispatch/gate | ➖ Factories | ❌ | ❌ | ➖ | ❌ | ❌ | ➖ subagents | ➖ Crew | ➖ |
| Diff review in-app | ✅ + line comments to agent | ❌ | ✅ | ✅ | ➖ | ✅ multibuffer, per-hunk | ➖ PR | ? | ? | ✅ + auto-review |
| Checkpoint / rollback | ✅ worktree checkpoints | ❌ | ? | ? | ❌ | ✅ Restore Checkpoint | ❌ | ? | ? | ? |
| Usage/quota meter | ✅ 5h/7d per account | ✅ credits + cost/PR | ❌ | ❌ | ❌ | ✅ tokens + auto-compact | ✅ spend limit | ? | ✅ credits | ? |
| Remote / phone control | ✅ SSH + relay + iOS/Android | ➖ cloud agents | ➖ paid, "coming" | ❌ | ❌ | ❌ | ✅ web+iOS | ✅ Remote Control | ✅ web+mobile | ✅ |
| Embedded browser + element→prompt | ✅ Design Mode | ❌ | ❌ | ❌ | ❌ | ❌ | ➖ remote desktop | ✅ browser-in-loop | ? | ✅ browser control |
| Code intel (LSP) | ❌ top request | ❌ | ❌ | ❌ | ❌ | ✅ native | ✅ | ✅ | ✅ | ➖ |
| Scriptable-by-agent CLI | ✅ `orca` | ✅ agent CLI | ✅ API | ❌ | ➖ | ➖ | ✅ MCP | ✅ CLI+SDK | ✅ CLI | ✅ SDK/MCP |

## C. Synthesis

### C.1 Table stakes 2026

Present in ≥6 of the 10 products surveyed. Missing any of these and SL-ADE is not in the category:

1. **Agent-agnostic launching of N CLI agents** with BYO subscription (Orca 27, Conductor 4, Pane/agtx/emdash "any"). Nobody credible locks to one vendor except openchamber (OpenCode) and the model vendors themselves.
2. **Per-agent isolation** — git worktree (Orca, Crystal, Zed, Codex) or branch+workspace (Conductor, Cursor). Worktree is the majority answer.
3. **Live agent state without clicking in** — working / needs-you / done / idle glyphs on tabs and in a list. Orca derives it from OSC titles + hooks, which is the only vendor-neutral way.
4. **In-app diff review → commit → push → PR**, then archive/merge the workspace.
5. **Notification on working→idle transition**, plus unread/deferred state.
6. **Tabs, panes, splits with layout persisted per workspace** and survived restarts.
7. **Quick open / command palette** over worktrees, files, agents, commands.
8. **Signed installers for all three desktop OSes + auto-update.**
9. **Some usage visibility** — tokens (Zed), credits (Warp/Kiro), or provider quota windows (Orca).
10. **A CLI or MCP surface the agents themselves can drive** (Orca `orca` CLI, Cursor Cloud MCP, Antigravity SDK, Codex SDK).
11. **Session persistence/restore** across app restart, including scrollback.

### C.2 Differentiators

| Differentiator | Who has it | Still unmet / weak |
|---|---|---|
| Supervisor→worker protocol with task DAG + decision gates | Orca only (experimental) | Nobody has shipped a *stable, in-app* one — Orca's is CLI-only and behind a flag, which is why `orca-viz` exists |
| Diff-line comments routed back to the agent | Orca only | — |
| Per-hunk accept/reject + checkpoint rollback | Zed (best-in-class), Orca (worktree checkpoints) | Absent from most worktree-style ADEs |
| Remote/SSH worktrees + phone supervision | Orca, Cursor, Antigravity, Kiro | Hard: relay infra + a mobile app |
| Embedded browser, element→prompt | Orca Design Mode, Antigravity, Codex | — |
| Spec/plan as a durable first-class artifact | Kiro, Frame | Genuinely under-served |
| **Agent sandboxing / trust model** | **nobody** — Orca ships `--dangerously-skip-permissions` by default and "Docker sandboxes" is an open request (15r) | **Open field** |
| **Code intel (LSP, go-to-ref, codebase search) inside the ADE** | Zed, Cursor, Antigravity, Kiro (editor-native) | **Top Orca request (28r+17r) — the terminal-first ADEs all lack it** |
| **Multi-repo workspaces / cross-repo diffs** | nobody | **Orca's #1 request (45r+26r+11r)** |
| **Small native install** | — | Orca is 172 MB (Win) / 194 MB (AppImage) Electron. SLTerm's Tauri build is **24.1 MB nsis / 24.6 MB deb**, ~7× smaller. This is SL-ADE's sharpest, most defensible wedge and it already exists |
| **IME / CJK-correct terminal** | nobody (Orca has 26c and 15c bug threads plus an `ime-regression-checklist.md`) | Open field, and directly aligned with a Vietnamese-authored product |
| **Personality / gamification layer** | nobody | SLTerm's `pet` view + `PetAddXP` RPC is unique in the entire category |

Two structural reads:
- **The category has bifurcated.** Cloud-agent products (Cursor Cloud, Warp Factories, Codex cloud) sell inference and compute. Local orchestrators (Orca, Conductor, Crystal, emdash, Pane, agtx) sell the *shell* and let you bring your own subscription. SL-ADE belongs in the second group, where the only paid example (Conductor, $50/mo, macOS-only) is the weakest technically. Orca proved the shell can be MIT and still get 60k stars in six months.
- **Terminal-first ADEs win on agent-agnosticism and lose on code intel.** Editor-first ones (Zed, Antigravity, Kiro) win the reverse. SLTerm already ships both halves — a terminal *and* a Monaco `codeeditor` view — so it is unusually positioned to close the gap that Orca's top-voted issues describe.

### C.3 Ranked feature list for SL-ADE

Ranking rule: (a) does it unblock shipping the Tauri-only build, (b) is it table stakes, (c) cost vs. differentiation. Paths below verified on disk 2026-09-03.

**Tier 0 — release blockers (nothing else ships without these)**

| # | Feature | Tag | Evidence / notes |
|---|---|---|---|
| 1 | **Frameless titlebar + window controls** in the Tauri shell | **[port from claude-terminal]** | Window is `decorations(false)` today so there is *no* titlebar. Reference: `/home/stackops/saly/claude-terminal/src/components/TitleBar.tsx` + `src/components/titlebar/`. Stays legal under the zero-logic rule: drag region + min/max/close only |
| 2 | **Shell parity pack**: app menu (`showWorkspaceAppMenu` currently throws), native dialogs, tray, global shortcuts, single-instance lock, multi-window, renderer key interception, web-block "open in system browser" | **[new build in `src-tauri/`]** | These are *exactly* the categories the hard rule permits in Rust. Orca's "Multiple windows" is a 16r/10c open request — SLTerm already has it in Electron, so losing it in the Tauri cut would be a visible regression |
| 3 | **Windows code signing + updater** | **[new build]** | Orca solves this with a free **SignPath.io / SignPath Foundation** OSS certificate (README "Signed Builds") — a concrete, copyable path for an unfunded project. Updater UI reference: `claude-terminal/src/components/AutoUpdater.tsx`, `UpdatePill.tsx`. Also copy Orca's lesson from its own bug: *reap previous backend generations on update* or invisible agent sessions accumulate and exhaust memory (12c) |

**Tier 1 — table stakes for the ADE label**

| # | Feature | Tag | Evidence / notes |
|---|---|---|---|
| 4 | **Agent state model**: working / needs-you / done / blocked / idle, derived from terminal OSC title + agent hooks, rendered on every tab, block header, and list row | **[port from claude-terminal → re-home to Go]** | `claude-terminal/src/hooks/useSessionStateDetection.ts` + `src/components/StateDot.tsx`. This is the substrate for #5, #7, #9 and the single highest-leverage item in the report. Copy Orca's glyph vocabulary verbatim (spinner / amber `?` / emerald / red / gray / none). Guard against Orca's known failure: slow agent startup false-positives idle and loses an injected dispatch (11c) — require an explicit completion message, not just a heuristic |
| 5 | **Worktree-bound workspaces**: one workspace = one git worktree; whole tiled block tree persists per worktree and swaps on switch | **[SLTerm already has the tiling/workspace half]** + **[new build in `pkg/vcs`]** | Orca's `docs/model/tabs-panes-splits.mdx` ("switching worktrees swaps the entire pane tree") is the exact behaviour to match; SLTerm's block/tab/workspace model is already a superset of Orca's tab-group/pane tree. Worktree CRUD reference: `claude-terminal/src/components/WorktreeModal.tsx`, `src-tauri/src/commands.rs:1737` `get_worktree_info` |
| 6 | **Diff review with per-hunk accept/reject + inline comments routed back to the agent** | **[port from claude-terminal]** + **[new build for comment routing]** | `claude-terminal/src/components/InlineDiffView.tsx`, `FileChangesPanel.tsx`, `PushModal.tsx`. Per-hunk keep/reject is Zed's model (`ctrl-shift-r` → multibuffer); comment-to-agent is Orca-only today and the cheapest true differentiator on this list |
| 7 | **Agent board across worktrees** — columns Needs You / Working / Done / Idle, filters by project + PR state, click card → focus that agent's terminal, nested subagents as children | **[SLTerm already has it → extend `view:agentteams`]** | `AgentTeamsGetSnapshot` / `GetTasks` RPCs already exist; Orca's `docs/model/agents-sessions.mdx` gives the full column/filter/card spec. Do **not** ship it behind an experimental flag the way Orca did |
| 8 | **Session layer** — resume, history, timeline, metrics, cost/token HUD | **[port from claude-terminal → `pkg/claudesession`]** | `SessionsPanel.tsx`, `SessionHistory.tsx`, `SessionTimeline.tsx`, `SessionMetricsPanel.tsx`, `SessionInsights.tsx`, `src/lib/sessionMetrics.ts`; Rust-side `src-tauri/src/claude_session.rs` + `database.rs` must be **re-implemented in Go**, not ported as Rust |
| 9 | **Notifications + unread/deferred state** on working→idle | **[port from claude-terminal]** | `src/hooks/useNotification.ts`, `src/lib/notificationGate.ts`; native Windows toast belongs in the Rust shell |
| 10 | **VCS layer with IntelliJ-style changelists** and path-confinement trust model, `view:vcs` | **[port from claude-terminal → re-home to Go `pkg/vcs`]** | `src-tauri/src/changelists.rs:33–132` already implements list/create/rename/delete/assign-files against SQLite — good design, wrong language for SL-ADE. Add the two cheap wins Orca lacks: **git graph** (18r) and **blame** (13r) |
| 11 | **User-configurable keybindings + command palette** persisted to a config file | **[port from claude-terminal]** + **[new build]** | `CommandPalette.tsx`, `GlobalSearchModal.tsx`. Copy Orca's shape: remap in settings, persist to `~/.orca/keybindings.json` → `~/.slterm/keybindings.json`. Also copy its default chords (`Ctrl+Shift+[ ]` all tabs, `Ctrl+Alt+[ ]` same-type, `Ctrl+Tab` most-recent, `Ctrl+J` quick open) — matching a 60k-star app's muscle memory is free adoption |

**Tier 2 — differentiators, in cost-adjusted value order**

| # | Feature | Tag | Evidence / notes |
|---|---|---|---|
| 12 | **Agent registry**: any CLI agent, per-agent launch args, per-launch model + reasoning-effort override, restart chip on exit | **[SLTerm already has it → extend]** | `terminal / claude / codex / ai tools / agents` widgets exist; generalise to a registry. Orca's `worker-start --agent claude --model <id> --effort high` and its `launch.requested`/`launch.effective` receipt are the pattern. Cheap, and it is table stakes for the "ADE" word |
| 13 | **Supervisor→worker orchestration in Go**: Run / Task (spec + deps + status) / Dispatch / Message / **decision gate**, with the DAG rendered **in-app** and clickable task IDs that focus the assigned terminal | **[new build in `pkg/`]** + reference `claude-terminal/src/components/OrchestrationPanel.tsx` | Orca's `docs/cli/orchestration.mdx` is a complete spec, and it is still experimental with a *CLI-only* surface — that gap is literally why a third party shipped `orca-viz`. Shipping this stable and visual is the strongest available differentiation, and SLTerm's `agentteams` view is the natural host |
| 14 | **Agent trust/confinement model** — per-worktree path confinement, autonomy tiers, opt-in container isolation | **[new build in `pkg/vcs` + `pkg/`]** | Nobody in the survey has this. Orca launches every agent with `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` / `--yolo` by default and treats "the worktree is the sandbox"; "Docker Sandboxes to Run Agents" is an open request (15r). A credible answer here differentiates on *safety*, which no competitor is claiming |
| 15 | **Element→prompt design mode** on the existing `view:webview` (click a rendered element → HTML + CSS + cropped screenshot into the agent prompt) | **[new build, cheap]** | SLTerm already ships a webview view, so the incremental cost is a capture + selector bridge. Orca's Design Mode is one of its most-demoed features |
| 16 | **Multi-repo workspace + cross-repo diff** | **[new build]** | Orca's single most-requested feature (45r + 26r + 11r, all `size/xl`) and nobody in the survey ships it. Best long-shot bet, worst effort profile — schedule after Tier 1 |
| 17 | **Code intel for the terminal-first ADE** — reuse `view:codeeditor` (Monaco) + Go-side LSP bridge for go-to-def/references and codebase search | **[new build in Go]** | Orca's #2/#3 requests (28r "Go to References returns empty", 17r LSP + codebase search). `claude-terminal/src-tauri/src/lsp/` exists as a *reference implementation only* — under the zero-logic rule it must be rebuilt in Go |
| 18 | **Pet as the agent-activity companion** — bind `PetAddXP`/`PetInteract` to agent lifecycle events (task completed, review merged, gate resolved) | **[SLTerm already has it → wire up]** | `view:pet` + `PetGetState/SelectPet/Interact/AddXP/GetCatalogue/GetDialogue` RPCs already exist. Zero competitors have any personality layer. Near-zero cost, high brand value for "Salyvn" → SL-ADE, and it makes the "Needs You" state emotionally legible |
| 19 | **Small-install positioning as an explicit, measured claim** | **[SLTerm already has it → market it]** | 24.1 MB nsis / 24.6 MB deb vs Orca 172 MB / 194 MB, macOS 192–197 MB, Conductor Mac-only. Put the number in the README next to a comparison row, the way Orca puts "Open source under MIT" next to its rivals |
| 20 | **IME/CJK-correct terminal as a stated guarantee** | **[SLTerm already has it → protect it with tests]** | Orca carries `docs/reference/ime-regression-checklist.md` plus live bug threads on duplicate CJK text (26c) and broken image paste into TUIs (15c). SLTerm's existing dedup-line handling is an asset — add regression tests and say so publicly |

### C.4 Anti-recommendations (do NOT build)

- **Do not sell inference or credits.** Warp ($20–$200/mo credits) and Kiro (credit packs) are model vendors with a shell attached. Orca's 60k stars in six months came from *not* doing this — "run any coding agent with your own subscription, no API key, no model endpoint".
- **Do not build cloud VMs or a hosted sandbox fleet.** Conductor gates cloud workspaces behind $50/mo and still says usage-based pricing is "planned"; Cursor Cloud is a datacenter business. Wrong shape for a local Windows-first ADE.
- **Do not ship a mobile companion yet.** Orca's relay is a whole subsystem (`cloud/apps/relay`, `relay-fence-broker`, `relay-ops`) and its top bug reports are relay pairing failures on Windows (15r, 13c, 9r). SSH/remote worktrees deliver most of the value with none of the hosted infra.
- **Do not copy "ship daily, triage never."** 5,184 open issues at Orca. SLTerm has one maintainer.
- **Do not port claude-terminal's Rust modules as Rust.** `changelists.rs`, `claude_session.rs`, `database.rs`, `lsp/`, `otel_receiver.rs` are all business logic and violate the zero-logic rule. Treat them as specifications for Go packages.
- **Do not lead with a chat UI.** It is a real gap in Orca (11r/10c) but it competes with SLTerm's actual strength — terminals as blocks. Ship agent state, boards and diffs first.
- **Do not hide the flagship behind an experimental flag.** Orca's Agent Dashboard and orchestration are both flagged, which suppressed adoption and spawned a third-party viewer.

## D. Limitations / not covered

- **No HN or Reddit sentiment.** HN Algolia returned 0 stories for Orca/Stably; Reddit is blocked from this host. "What users praise" is therefore inferred from adoption metrics + what the vendor leads with, not from user voices. Complaints are solid (issue tracker); praise is soft.
- **No hands-on install.** Nothing was downloaded or run. Install sizes are release-asset byte counts, not on-disk footprints; UX descriptions are from docs, not from use.
- **Pricing gaps:** Orca's monetization (Enterprise page exists, terms unseen), Conductor's maker identity, Kiro's platform list, Codex plan requirements, Antigravity's per-tier limits.
- **Antigravity Windows support unresolved** — the homepage offers only Apple Silicon/Intel downloads; that is evidence about the page, not proof no Windows build exists.
- **Warp's repo/source relationship unverified** — `warpdotdev/warp` is AGPL-3.0 with 5,168 open issues and reads like an issue tracker; whether the client source is public was not confirmed.
- **Not evaluated at all:** Devin, Factory Droid, Amp, Cline/Roo, JetBrains Junie, GitHub Copilot Workspace/Agent HQ, Sourcegraph Amp, Windsurf. The survey covers the *desktop multi-agent ADE* slice the brief asked for, not the whole agent-tooling market.
- **No effort estimates.** The ranking is value-ordered with cost commentary; it is not a sized plan. Sizing belongs in the plan phase.
- **claude-terminal port surface read at directory level.** Component and Rust module *names* and a few line-level anchors were verified; the internals of each component were not read. Any "port" tag is a claim that the capability exists there, not that the code is fit to lift as-is.

## E. Unresolved questions

1. **Does Orca have a business model?** If Stably monetizes via an Enterprise tier, an MIT shell + paid team features is a template SL-ADE could reuse. If it is VC-funded land-grab with no revenue, the 60k-star bar is not reproducible and not worth chasing.
2. **Is wrapping Kiro's CLI allowed?** kiro.dev/pricing says routing requests through third-party harnesses is disallowed. Same question for Cursor CLI and Copilot CLI before advertising them as supported agents.
3. **Which agent-state signal does SL-ADE standardise on?** OSC title (Orca's approach, vendor-neutral but heuristic and demonstrably flaky) vs. per-agent hooks (accurate, N integrations) vs. **ACP** (Zed's protocol — is it worth adopting so SL-ADE gets Zed-compatible agents for free?).
4. **Multi-window in the Tauri cut: parity or drop?** SLTerm has it in Electron; Orca users rank it 16r. Reinstating it in Tauri is real work and touches the block/tab/workspace persistence model.
5. **Where does the orchestration state live?** Orca uses local SQLite with a single-writer coordinator. Does SLTerm reuse its existing Go store, or add a dedicated one? This decides whether an out-of-app DAG viewer is even possible.
6. **Is "SL-ADE" the shipping name, and when does the bundle id move?** Today `dev.salyvn.slterm` / productName SLTerm / 0.20.0. Renaming the bundle id breaks the Windows updater path and installed-app identity, so it should happen once, deliberately, before signing is set up — not gradually.
7. **Does the pet↔agent-event binding risk the product reading as unserious** to the professional audience an ADE targets, and should it therefore be default-off?
