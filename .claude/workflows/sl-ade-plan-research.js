export const meta = {
  name: 'sl-ade-plan-research',
  description: 'Research ADE landscape + Tauri/Windows gaps + rebrand, and scout both repos, for the SLTerm → SL-ADE upgrade plan',
  phases: [
    { title: 'Research', detail: '4 web researchers + 3 codebase scouts in parallel' },
    { title: 'Critique', detail: 'completeness critic over all reports' },
  ],
}

const REPORTS = '/home/stackops/saly/plans/reports'
const STAMP = '260903-1202'

const COMMON = `
CONTEXT (read carefully, this is the whole brief you get):
- Project: SLTerm, a fork of Wave Terminal at /home/stackops/saly/SLTerm (Go backend in pkg/, React+TS frontend in frontend/, Tauri 2 Rust shell in src-tauri/, legacy Electron shell in emain/). GitHub: SalyyS1/SLTerm. Owner brand: "Salyvn".
- Reference repo: claude-terminal at /home/stackops/saly/claude-terminal (Tauri 2 + React, a "Claude Code workstation"; github.com/talayash/claude-terminal).
- The owner's intent: turn SLTerm into an ADE (AI Development Environment) by merging the best of SLTerm and claude-terminal, shipped as a light Tauri + Go build (Electron goes away), Windows first, and gradually REBRAND it to "sl-ade" (this is decided; do not argue it).
- Hard architecture rule: the Rust shell owns ZERO business logic. Windows, menus, tray, dialogs, shortcuts, updater only. Everything else is Go under pkg/ or the React frontend.
- Already shipped: Tauri shell tag tauri-v0.20.0 (Linux verified; Windows/macOS builds exist but have never been launched). Missing in the Tauri shell today: frameless titlebar/drag region, app menu, dialogs/tray/global shortcuts, renderer-side key interception, "open in browser" for the web block, code signing, updater.
- Existing plan (read-only reference, do NOT edit): /home/stackops/saly/SLTerm/plans/260821-1912-slterm-upgrade/ (README.md + phase-*.md). Phases 4 (Claude session layer), 5 (VCS/changelists), 6 (pet rewrite, keybindings, tabs) are still open.
- Keep the pet system (owner's passion feature). Web-block loss (iframe only) is accepted.

RULES:
- You are researching/scouting for a PLAN. Do not modify any source file. The ONLY files you may create are markdown reports under ${REPORTS}/.
- Cite sources: URLs for web claims, file:line for code claims. Mark anything you could not verify as UNVERIFIED rather than guessing.
- Write the report in English, concise, evidence-first. Use headings; no fluff.
- End your final response with the structured output the harness asks for (a short summary + report path + key findings). The report file holds the detail.
`

const SUMMARY = {
  type: 'object',
  required: ['report_path', 'summary', 'key_findings', 'recommendations', 'unverified'],
  properties: {
    report_path: { type: 'string' },
    summary: { type: 'string', description: '3-5 sentences' },
    key_findings: { type: 'array', items: { type: 'string' }, description: '5-12 one-line findings, each with a source hint' },
    recommendations: { type: 'array', items: { type: 'string' }, description: 'Concrete recommendations for the plan, most important first' },
    unverified: { type: 'array', items: { type: 'string' }, description: 'Claims you could not verify' },
  },
}

const RESEARCH = [
  {
    key: 'orca-ade',
    type: 'researcher',
    prompt: `${COMMON}
TASK: Deep-dive "Orca ADE" (the owner named it explicitly: "research một số ade hay như orca ade"). Find what Orca ADE is (product site, GitHub, docs, launch posts, reviews, HN/Reddit threads, YouTube demos), who makes it, its stack (Electron/Tauri/native?), install size if published, pricing/licensing, and above all its FEATURE SET and UX MODEL: how it organizes agents/sessions/worktrees, terminal vs editor vs chat panels, how it handles multiple parallel coding agents (Claude Code, Codex, Gemini CLI, etc.), diff/review flow, git integration, task boards, notifications, cost/token visibility, keyboard model, Windows support status. Note what users praise and complain about.
If "Orca ADE" is ambiguous (several products named Orca), enumerate the candidates and identify the one that is an AI development environment for coding agents; say which you picked and why.
Write the report to ${REPORTS}/researcher-${STAMP}-orca-ade.md with sections: Identity & stack; Feature inventory (table: feature | how it works | worth adopting for SL-ADE? y/n/maybe + why); UX model; Windows status; Praise/complaints; What SL-ADE should copy, adapt, or skip.`,
  },
  {
    key: 'ade-landscape',
    type: 'researcher',
    prompt: `${COMMON}
TASK: Map the 2025-2026 "ADE / agentic development environment" landscape beyond Orca, so the plan adopts proven patterns rather than inventing them. Cover at least: Warp (Agentic Development Environment), Conductor (conductor.build), Crystal, Vibe Kanban, Superset, Claude Code desktop/Cowork-style apps, OpenAI Codex desktop app, Zed (agent panel + ACP), Cursor background agents, Kiro, Google Antigravity, Wave Terminal's own AI features, and any other multi-agent orchestration desktops you find (e.g. Multica, Tandem, Terminal-first tools like Ghostty/Kitty AI integrations if relevant). For each: stack + install size where known, core UX metaphor (tabs / grid / kanban / sidebar), how it multiplexes multiple agent sessions and worktrees, review/diff UX, git integration depth, cost/token HUD, notifications when an agent needs input, keyboard/command-palette model, Windows support, pricing. Then extract the CROSS-CUTTING PATTERNS that define the category (what every serious ADE has) and the differentiators.
Deliverable: ${REPORTS}/researcher-${STAMP}-ade-landscape.md with a comparison table, a "table stakes vs differentiators" section, and a ranked list of 8-15 features SL-ADE should have given it is a Windows-first Tauri+Go terminal with an existing block/tab/workspace model, a pet system, skills/agents/MCP viewers and an agent-teams viewer already built.`,
  },
  {
    key: 'tauri-windows',
    type: 'researcher',
    prompt: `${COMMON}
TASK: Research the Tauri 2 specifics SL-ADE still needs, Windows-first. Use official Tauri v2 docs, plugin READMEs, GitHub issues, and real apps' source (claude-terminal at /home/stackops/saly/claude-terminal/src-tauri is a working reference you may read; also look at public Tauri apps that ship frameless Windows titlebars). Cover, with concrete API names/config keys and gotchas:
1. Frameless window on Windows: decorations=false + custom React titlebar, data-tauri-drag-region, window controls (minimize/maximize/close), Windows 11 Snap Layouts on hover of maximize (the WM_NCHITTEST problem; tauri-plugin-decorum / window-vibrancy / titleBarStyle Overlay options), DPI scaling, maximize edge clipping, shadow/rounded corners, transparent window cost on WebView2.
2. Updater: tauri-plugin-updater with minisign keys, endpoint JSON format (latest.json), GitHub Releases hosting, per-platform artifacts (nsis vs msi), passive/silent install modes on Windows, and how the artifact names must line up with the current release-tauri.yml naming.
3. Code signing on Windows for an open-source solo dev: Azure Trusted Signing, SignPath foundation for OSS, self-signed + SmartScreen reality, cost; macOS notarization briefly.
4. Native surface plugins: tauri-plugin-single-instance, tray-icon, global-shortcut, dialog, notification, window-state, shell/opener, clipboard-manager; capability/permission JSON for each.
5. Key interception: there is no Electron before-input-event; how apps intercept Ctrl+Shift chords, Alt menu behavior on Windows, IME, and keys swallowed by WebView2 (F5, Ctrl+F, Ctrl+P print, Alt+F4) and how to disable WebView2 default shortcuts (initialization script vs additionalBrowserArgs vs webview2 settings like --disable-features).
6. WebView2 runtime: evergreen bootstrapper vs embedded, offline installer size, what happens on a machine without it; NSIS installer options (perMachine/currentUser, installMode).
7. Multi-window (tear-off tabs) and window-per-workspace in Tauri 2: WebviewWindowBuilder, shared init script, IPC between windows.
Deliverable: ${REPORTS}/researcher-${STAMP}-tauri-windows-shell.md organised by the 7 topics, each ending with "Recommendation for SL-ADE" and an effort estimate.`,
  },
  {
    key: 'rebrand',
    type: 'researcher',
    prompt: `${COMMON}
TASK: Research how to rebrand a shipped Tauri 2 + Go desktop app from "SLTerm" to "SL-ADE" gradually and safely. Also read the actual repo to ground it: /home/stackops/saly/SLTerm/src-tauri/tauri.conf.json, src-tauri/Cargo.toml, package.json, electron-builder.config.cjs, .github/workflows/release-tauri.yml, .github/workflows/release.yml, pkg/wavebase/wavebase.go (data dir names, env var prefixes like SLTERM_*), cmd/wsh (CLI name), and grep counts of "SLTerm"/"slterm"/"SLTERM" across the repo (exclude node_modules, dist, target). Cover:
1. Which identifiers are user-visible vs load-bearing: productName, bundle identifier (com.x.y — changing it changes app data paths and updater identity on all OSes), exe name, NSIS install dir and registry keys/uninstall entry, Windows AppUserModelID, macOS bundle id, Linux desktop file/appId, deep-link scheme, data/config dirs (~/.slterm), env vars, unix socket path, wsh CLI name, shell integration rc snippets, telemetry app names.
2. Migration strategy: how to keep updating existing SLTerm installs into SL-ADE (updater endpoint continuity, identifier change consequences, data dir migration or symlink/alias at first launch, keeping SLTERM_* env aliases), and what to do about the Electron release line.
3. Repo/release naming: GitHub repo rename redirects (git remotes, releases URLs, gh pages), tag naming (v* vs tauri-v*), winget/scoop/homebrew manifest implications if any exist.
4. Name collision check: search whether "sl-ade" / "SL-ADE" / "slade" already exists as a product, npm/cargo/GitHub org, trademark risk with obvious ADE products; propose 2-3 safe display names/identifiers (e.g. "SL-ADE" display, "sl-ade" slug, "com.salyvn.slade" id) with rationale.
5. A phased rebrand ladder (what to rename first with zero migration cost → what to rename last), with a checklist of files/keys.
Deliverable: ${REPORTS}/researcher-${STAMP}-rebrand-sl-ade.md including the grep counts and the exact current values you found in the repo.`,
  },
]

const SCOUTS = [
  {
    key: 'claude-terminal-inventory',
    prompt: `${COMMON}
TASK: Produce a complete, file-grounded FEATURE INVENTORY of claude-terminal at /home/stackops/saly/claude-terminal so the plan can decide what to port. Read README.md, docs/, src/components/*, src/store/*, src/hooks/*, src/lib/*, src-tauri/src/*.rs (list every #[tauri::command]), workers/, and the changelog (src/changelog.json) for the feature timeline. For EACH feature give: name; what it does for the user; where it lives (files); backend needs (Rust commands / DB tables / external CLI); rough size (LOC); and a verdict for SL-ADE: PORTED ALREADY (SLTerm has it — check /home/stackops/saly/SLTerm/frontend/app/view and pkg/ to confirm: aitools, agentteams, pet, term, preview, codeeditor, sysinfo, webview, waveconfig exist), PORT (high value), ADAPT (value but SLTerm's block/tab model changes shape), SKIP (not ADE-relevant or already covered by SLTerm's Wave heritage). Pay special attention to: Sessions panel + session history/timeline/insights/metrics (Claude session resume, JSONL parsing), OrchestrationPanel, Changelists/FileChangesPanel/InlineDiffView/PushModal/WorktreeModal, CommandPalette + GlobalSearch, HintsPanel, Profiles/ClaudeConfigModal/MemoryEditor/PromptEditorDrawer/SnippetsModal, StatusBar/TerminalStatusBar/StateDot (agent-state detection: how does it know Claude is waiting for input? read the exact heuristic), ToolStripe, PasteAsFileDrawer, ScriptsMenu/ScriptChildPane, AutoUpdater/UpdatePill, TitleBar (frameless implementation on Windows: files + how drag/controls/snap are done), SetupWizard, notifications/sounds. Also list Windows-specific code paths in src-tauri (ConPTY, path handling, git exec split).
Deliverable: ${REPORTS}/scout-${STAMP}-claude-terminal-inventory.md with a master table and a section "Agent-state detection heuristic, verbatim logic".`,
  },
  {
    key: 'slterm-surface',
    prompt: `${COMMON}
TASK: Scout SLTerm's CURRENT surface at /home/stackops/saly/SLTerm so the plan starts from reality, not from the older plan's assumptions. Report with file:line evidence:
1. Frontend views/widgets: every entry under frontend/app/view/*, the widget registry (search for the default widgets config / "view:aitools" / "view:agentteams" / "widgets" in pkg/wconfig and frontend), keybinding registration (frontend/app/store/keymodel.ts registerGlobalKeys), the command palette or launcher if any (frontend/app/view/launcher), the tab/workspace model (frontend/app/store/*, pkg/wcore), the existing "pet" view surface.
2. HostApi seam: frontend/util/host.ts, electron-host.ts, tauri-host.ts — list every member and mark which throw/stub in tauri-host.ts; frontend/app/store/tauri-window-ops.ts.
3. Tauri shell: src-tauri/src/*.rs (every command, every plugin in Cargo.toml, capabilities/*.json, tauri.conf.json bundle section incl. identifier/productName/resources/targets), and .github/workflows/release-tauri.yml (targets, artifact names, prerelease flag).
4. Go backend ADE layer: pkg/aitools (what it reads, RPC names), pkg/agentteams (RPC names, what dirs), pkg/wshrpc route list for "host" route, pkg/waveserver.Start options, pkg/telemetry status (stubbed?), pkg/petengine public RPCs, pkg/wconfig settings keys relevant to AI/pet/ai tools.
5. Size + build facts: dist/ or release artifact sizes if present locally (src-tauri/target/release/bundle), Monaco share of the frontend bundle (check vite config / frontend/app/view/codeeditor for how monaco is imported), fonts, pet assets.
6. Branding footprint: counts of SLTerm|slterm|SLTERM|Salyvn|wave|Wave|wavesrv|wsh occurrences by top-level dir (exclude node_modules, dist, src-tauri/target, .git), and the list of files/keys where the name is load-bearing (env var prefixes, data dir, socket name, bundle identifier, exe names, workflow artifact names).
7. Tests: what test suites exist (vitest, go test, playwright/testdriver) and how they are run (package.json scripts, Taskfile.yml).
Deliverable: ${REPORTS}/scout-${STAMP}-slterm-surface.md. Be exhaustive on 2, 3 and 6; those drive the plan's file lists.`,
  },
  {
    key: 'windows-readiness',
    prompt: `${COMMON}
TASK: Audit how Windows-ready the SLTerm Go backend and frontend are today, because the product is now Windows-first and the Tauri Windows build has never been launched. Read /home/stackops/saly/SLTerm/pkg/shellexec (ConPTY usage: which pty library, creack/pty vs github.com/UserExistsError/conpty vs aymanbagabas/go-pty; PowerShell/pwsh/cmd detection; shell integration/rc injection for pwsh), pkg/wavebase (Windows paths, data dir, socket vs named pipe for wsh: search for winio / named pipe), pkg/wsl + pkg/wslconn (WSL support), pkg/remote (ssh on Windows, known_hosts, agent), pkg/wshutil + cmd/wsh (how the wsh binary is installed on Windows; PATH; shell integration for pwsh profile), pkg/util (any HideWindow / SysProcAttr), pkg/filestore, pkg/wconfig default shell resolution, pkg/blockcontroller shell process handling (signals vs TerminateProcess), frontend keybinding platform handling ("Cmd" mapping to Alt on Windows in keymodel.ts / keyutil), frontend fonts (Hack Nerd WOFF2 present?), and the existing Electron code in emain/ that did Windows-specific work (search for process.platform === "win32" / "darwin") which the Tauri shell has NOT replicated (this is the list of parity gaps). Also check zigcc.bat and scripts/build-tauri-sidecar.mjs for the Windows cross-build path, and .github/workflows for the windows runner steps. 
Deliverable: ${REPORTS}/scout-${STAMP}-windows-readiness.md with: (a) a table of Windows capabilities: works / untested / missing, with file:line; (b) the Electron-only Windows behaviors not yet in Tauri; (c) the exact list of things that must be manually verified on a real Windows machine (a QA checklist) and what can be verified from Linux CI; (d) risks specific to WebView2 + xterm WebGL + ConPTY.`,
  },
]

phase('Research')
const items = [
  ...RESEARCH.map(r => ({ ...r, kind: 'research' })),
  ...SCOUTS.map(s => ({ ...s, kind: 'scout' })),
]
const results = await parallel(items.map(it => () =>
  agent(it.prompt, {
    label: `${it.kind}:${it.key}`,
    phase: 'Research',
    schema: SUMMARY,
    ...(it.type ? { agentType: it.type } : {}),
  }).then(r => ({ key: it.key, kind: it.kind, ...r }))
))
const done = results.filter(Boolean)
log(`${done.length}/${items.length} research/scout reports written`)

phase('Critique')
const digest = done.map(r => `### ${r.key} (${r.report_path})\n${r.summary}\nFindings:\n- ${r.key_findings.join('\n- ')}\nRecommendations:\n- ${r.recommendations.join('\n- ')}\nUnverified:\n- ${(r.unverified || []).join('\n- ') || 'none'}`).join('\n\n')

const critique = await agent(`${COMMON}
TASK: You are the completeness critic for a research packet that will feed an upgrade plan for SLTerm → SL-ADE. Read EVERY report file listed below in full (they are at ${REPORTS}/), plus the existing plan README at /home/stackops/saly/SLTerm/plans/260821-1912-slterm-upgrade/README.md. Then answer, with evidence:
1. Contradictions between reports (e.g. two reports disagree on a fact about Tauri, Windows, claude-terminal, or SLTerm). For each, say which is right after checking the source.
2. Gaps: questions the plan author will need answered that no report covers. Where you can answer a gap cheaply by reading the repos or one web page, ANSWER IT here instead of just listing it.
3. Premise checks: does anything in the packet rely on an assumption the code contradicts? (E.g. "SLTerm has a command palette" — verify.)
4. The 10 most decision-relevant facts for the plan, ranked, each with its source.
5. Scope traps: features the reports recommend that would violate the "Rust owns zero business logic" rule, or that duplicate something SLTerm already has, or that are not ADE-relevant.
Write ${REPORTS}/critic-${STAMP}-research-packet.md and return the structured summary.

REPORT DIGEST (summaries only; read the files for detail):
${digest}`, { label: 'critic:completeness', phase: 'Critique', schema: SUMMARY, effort: 'high' })

return { reports: done.map(r => ({ key: r.key, path: r.report_path, summary: r.summary, recommendations: r.recommendations, unverified: r.unverified })), critique }