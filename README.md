<p align="center">
  <a href="https://github.com/SalyyS1/SLTerm">
    <img alt="SLTerm Logo" src="./assets/appicon-windows.png" width="110">
  </a>
</p>

<h1 align="center">SLTerm</h1>

<p align="center">
  <strong>AI-Native Graphical Terminal Workspace on Tauri 2, Go, and xterm.js</strong>
</p>

<p align="center">
  <a href="https://github.com/SalyyS1/SLTerm/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SalyyS1/SLTerm/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/SalyyS1/SLTerm/releases"><img src="https://img.shields.io/github/v/release/SalyyS1/SLTerm?include_prereleases&style=flat-square&color=00E5CC" alt="Release"></a>
  <a href="https://salyys1.github.io/SLTerm/"><img src="https://img.shields.io/badge/Live_Sandbox-Paste--Guard_Lab-00E5CC?style=flat-square" alt="Paste-Guard Lab"></a>
  <a href="https://github.com/SalyyS1/SLTerm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SalyyS1/SLTerm?style=flat-square" alt="License"></a>
  <a href="https://github.com/SalyyS1/SLTerm/releases"><img src="https://img.shields.io/github/downloads/SalyyS1/SLTerm/total?style=flat-square&color=58C142" alt="Downloads"></a>
</p>

> **[Launch the Interactive Browser Terminal Security Lab -> `https://salyys1.github.io/SLTerm/`](https://salyys1.github.io/SLTerm/)**
> *Audit `ESC[201~` bracketed-paste breakouts, `OSC 52` clipboard hijacks, OpenSSH `ProxyCommand` injection (`SLT001`..`SLT010`), Shell & Agent Command Firewall hazards (`SLT011`..`SLT016`), terminal scrollback secret redaction, and OASIS SARIF v2.1.0 output 100% client-side in your browser.*

---

SLTerm is an open-source graphical terminal workspace engineered for multi-agent AI coding workflows, low-latency SSH operations, and low-footprint desktop execution. Forked from Wave Terminal and re-architected by Salyvn, SLTerm pairs a Go backend (`wavesrv` and `wsh`) with a native **Tauri 2 Rust shell** (`src-tauri/`) alongside Electron compatibility, plus first-class observability panels for Claude Code multi-agent teams, AI CLI skills, and Model Context Protocol (MCP) servers.

## Key Engineering Highlights

- **Dual Desktop Runtime (Tauri 2 Rust Host + Electron — Windows-First & Lightweight):** Ships a native Rust Tauri 2 host (`src-tauri/`) with `CREATE_NO_WINDOW` console-flash suppression on Windows that spawns `wavesrv` as a managed sidecar (~20 MB vs ~285 MB Electron runtime).
- **ADE Hub (`pkg/agentsessions`, `pkg/otelcost`, `view:adehub`):** Unified multi-agent command center combining Stella-style fuzzy session search & safe `--resume=<id>` restore dedup across Claude Code and Codex (with "waiting on you" approval dots), Orca-style universal Windows/Unix CLI launcher (Claude, Codex, Gemini, OpenCode, Cursor, Copilot, Aider, PowerShell 7, Git Bash, WSL) & executable **Prompt Notes** ("Notes That Do Things"), and an embedded local OTLP/JSON DELTA token & USD cost receiver (`/slterm/otlp/v1/metrics`).
- **Visual Git, Changelists & Isolated Agent Worktrees (`pkg/vcs`, `view:vcs`):** Safe `os/exec` Git status, inline colorized unified diff, 1-click stage/unstage, `0600` temp-file commit with Conventional Commit helpers, persistent named changelists, and 1-click Orca-style **Isolated Git Worktrees** with instant *Open Terminal / Claude / Codex in Worktree* launch buttons (Windows `HideWindow` hardened, zero shell injection).
- **Claude Code Multi-Agent Teams Board (`pkg/agentteams`):** Read-only real-time observability view over live Claude Code team rosters (`config.json`) and shared task boards (`blockedBy` dependencies, task owners, active execution states, and explicit schema-drift warnings).
- **AI CLI & MCP Inventory (`pkg/aitools`):** Unified inspector and editor for user-scope and project-scope Skills, Agents, Slash Commands, and MCP server definitions (`stdio` and `http` transports) across Claude Code and Codex, hardened against path-traversal (`validateName`).
- **Terminal Paste Security Guard & Output Secret Redactor (`frontend/app/view/term/paste-guard.ts`, `output-redactor.ts`):** Intercepts clipboard pastes before `xterm.js` ingestion, unconditionally stripping 7-bit (`ESC[201~`) and 8-bit C1 (`0x9B 201~`) bracketed-paste breakouts, `OSC 52` clipboard read/write hijack sequences (`ESC]52;...`), and `DCS`/`APC`/`PM`/`SOS` device control strings. Includes a deterministic VT100 line-buffer simulator (`simulateTerminalDisplay`), OASIS SARIF v2.1.0 export (`exportPasteAnalysisSarif`, rules `SLTP001`..`SLTP009`), and an ANSI-preserving scrollback/transcript redactor (`redactTerminalOutput`) that scrubs 12 credential families (OpenAI, Anthropic, GitHub, AWS IAM, Google API, HuggingFace, npm, Slack, Stripe, JWT, URL Basic Auth, Bearer headers, and PEM private keys) into deterministic correlation handles (`[REDACTED:label#digest]`).
- **OpenSSH Config & `ProxyCommand` Security Auditor (`pkg/sshaudit`, `cmd/sshaudit`):** Static security analyzer and standalone CLI (`slterm-sshaudit`) covering 10 rules (`SLT001`..`SLT010`): `ProxyCommand` / `KnownHostsCommand` shell & leading-dash option injection (`CVE-2023-51385` class), `PermitLocalCommand` / `LocalCommand` execution, `StrictHostKeyChecking no` / `UserKnownHostsFile /dev/null` MITM bypasses, wildcard `ForwardAgent` / `ForwardX11Trusted`, weak ciphers/KEX/SHA-1 `ssh-rsa`, `SendEnv` credential leaks, `0.0.0.0` tunnel binds, `Match exec` pre-auth token injection, `/tmp` `ControlPath` sockets, and inline secret or Trojan Source BiDi smuggling with OASIS SARIF v2.1.0 export (`--sarif`).
- **Shell Command & AI Agent Execution Risk Firewall (`pkg/cmdguard`, `cmd/cmdguard`, `frontend/app/view/term/command-guard.ts`):** Lexical and AST-aware shell firewall and standalone CLI (`slterm-cmdguard`) covering 6 rules (`SLT011`..`SLT016`): recursive root/home/block-device destruction and unguarded `$VAR/*` wipes (`SLT011`), `curl`/`wget` and Base64 decode pipes to interpreters plus PowerShell `-EncodedCommand` (`SLT012`), `/dev/tcp`, `nc -e`, `socat`, and scripting socket reverse shells (`SLT013`), SSH/AWS/kube/`.env` credential and cloud IMDS (`169.254.169.254`) exfiltration (`SLT014`), SUID, `sudoers`/`authorized_keys`/`LD_PRELOAD` persistence, and `--privileged` container host escapes (`SLT015`), and unprotected `git push --force`, `git reset --hard`, and `--no-verify` hook bypasses (`SLT016`). Unwraps `sudo`, `env`, `timeout`, `sh -c`, `eval`, `$(...)`, `<(...)`, and Base64 payloads with configurable `strict` / `balanced` / `permissive` policy verdicts and OASIS SARIF v2.1.0 export.
- **XChaCha20-Poly1305 Envelope Secret Store (`pkg/secretstore`):** Seals stored SSH and API credentials with 24-byte random-nonce authenticated encryption (`SLTERM-SECRETS-1:`), decoupling secret storage from Electron `safeStorage` so credentials migrate cleanly to the Tauri 2 runtime.
- **Zero-Ghost Terminal Layout & Replay Pipeline:** Pre-layout spawn gating (`term-spawn-gate.ts`) blocks premature `2x1` PTY starts prior to CSS box layout; carried terminal parking (`term-carry-over.ts`), loopback offset reconciliation (`term-replay.ts`), and batched frame/input writers (`term-batched-writer.ts`) keep high-throughput output smooth.
- **Workspace Blocks & Remote SSH:** Drag-and-drop tiled terminals, Monaco code editors, Markdown/CSV/PDF/media previews, web blocks, `wsh` workspace CLI control, and one-click SSH + remote filesystem sessions.
- **Bilingual Interface (English & Vietnamese):** Instant runtime language switching in `Settings -> Language` without restarting PTY sessions.

## Architecture

```mermaid
flowchart LR
    UI["React 19 + xterm.js + Monaco"] <-->|"WebSocket / WSH RPC"| SRV["Go wavesrv Sidecar"]
    UI --> PG["Paste Security Guard\n(Breakout Strip + BiDi/Secret Scan)"]
    HOST["Tauri 2 Rust Host (src-tauri)\nor Electron Host (emain)"] --> SRV
    SRV --> PTY["Local PTY & SSH Multiplexer"]
    SRV --> AT["pkg/agentteams\n(Claude Team Roster & Tasks)"]
    SRV --> AI["pkg/aitools\n(Skills, Agents, Commands, MCP)"]
    SRV --> SEC["pkg/secretstore\n(XChaCha20-Poly1305 Envelope)"]
```

## Installation

Download prebuilt installers for your platform from [**GitHub Releases**](https://github.com/SalyyS1/SLTerm/releases):

| Platform | Tauri 2 Native Shell (`tauri-v*`) | Electron Build (`v*`) |
| :--- | :--- | :--- |
| **Windows (x64)** | `SLTerm_*_x64-setup.exe` (NSIS) | `SLTerm-win32-x64-*.exe` / `.zip` |
| **macOS (Apple Silicon / Intel)** | `SLTerm_*_aarch64.dmg` | `SLTerm-darwin-arm64-*.zip` / `x64` |
| **Linux (x86_64)** | `SLTerm_*_amd64.deb` / `.rpm` | `SLTerm-linux-x86_64-*.AppImage` / `.deb` |

> **Note for macOS:** Unsigned builds require right-click -> **Open** on first launch, or clearing the quarantine attribute via `xattr -dr com.apple.quarantine /Applications/SLTerm.app`.

### Minimum System Requirements

- **Windows:** Windows 10 version 1809 or later (x64, WebView2 runtime for Tauri builds)
- **macOS:** macOS 11 Big Sur or later (`arm64` or `x64`)
- **Linux:** `glibc >= 2.28` (Ubuntu 20.04+, Debian 10+, RHEL 8+); `webkit2gtk-4.1` for Tauri `.deb`/`.rpm` packages

## Building and Testing from Source

### Prerequisites

- **Go** `1.25+` (with CGO enabled for SQLite state persistence)
- **Node.js** `22+` and `npm`
- **Rust** `stable` toolchain (required when building the Tauri 2 native shell)

### Commands

```bash
git clone https://github.com/SalyyS1/SLTerm.git
cd SLTerm

# Install frontend dependencies
npm install

# Run frontend terminal unit tests (Vitest)
npx vitest run frontend/app/view/term/tests/

# Run Go backend unit tests
go test -race ./pkg/cmdguard/... ./cmd/cmdguard/... ./pkg/sshaudit/... ./cmd/sshaudit/... ./pkg/agentteams/... ./pkg/aitools/... ./pkg/secretstore/...

# Evaluate a shell script or agent command and emit OASIS SARIF v2.1.0
go run ./cmd/cmdguard check deploy.sh --policy balanced --sarif cmdguard.sarif

# Audit an OpenSSH client config and emit OASIS SARIF v2.1.0
go run ./cmd/sshaudit audit ~/.ssh/config --sarif ssh-audit.sarif

# Redact live credentials from a terminal transcript
go run ./cmd/sshaudit redact session.log > session.redacted.log

# Run Tauri 2 native desktop shell in development
npm run dev:tauri

# Build production Tauri 2 installer
npm run build:tauri

# Run Electron shell in development (optional fallback)
npm run dev
```

## Repository Layout

```text
SLTerm/
├── src-tauri/                  # Tauri 2 native Rust desktop shell & sidecar host
├── cmd/                        # Go binaries (wavesrv backend daemon, wsh CLI)
├── pkg/
│   ├── agentteams/             # Claude Code multi-agent team roster & task reader
│   ├── aitools/                # Skills, agents, slash commands & MCP config inspector
│   ├── secretstore/            # XChaCha20-Poly1305 authenticated credential store
│   ├── remote/                 # SSH client, agent forwarding & connection parser
│   └── shellexec/              # Local & remote PTY process lifecycle
├── frontend/
│   ├── app/view/term/          # xterm.js integration, paste-guard, replay & spawn gate
│   ├── app/view/agentteams/    # Multi-agent team observability UI
│   ├── app/view/aitools/       # AI CLI & MCP configuration UI
│   └── i18n/                   # English and Vietnamese localization bundles
└── emain/                      # Legacy Electron main process compatibility layer
```

## Related Developer & Security Tooling by Salyvn

- [**mcp-slim**](https://github.com/SalyyS1/mcp-slim): Zero-dependency CLI & stdio proxy that shrinks MCP tool schemas by ~66%, enforces tool allow/deny policies, and redacts leaked secrets with HMAC handles.
- [**SLClean**](https://github.com/SalyyS1/SLClean): Native Rust + Tauri 2 Windows developer cache & build-artifact cleaner with headless JSON CLI audit mode and WSL2/Docker `.vhdx` protection.
- [**foliora**](https://github.com/SalyyS1/foliora): Local-first Rust CLI and Tauri desktop app that converts technical PDFs into citation-grounded Markdown context packs.

## License

Licensed under the [Apache-2.0 License](LICENSE). Based on [Wave Terminal](https://github.com/wavetermdev/waveterm), customized and extended by [Salyvn](https://github.com/SalyyS1). See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for upstream credits.
