// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// ADE Hub — unified lightweight command center inspired by Stella ADE, Orca ADE,
// and Claude Terminal:
//   1. Cross-agent session fuzzy search + 1-click `--resume=<id>` + Waiting-on-You dots
//   2. Windows-first Universal CLI Agent & Shell Launcher (Claude, Codex, Gemini, OpenCode, PowerShell 7, WSL)
//   3. Orca-style "Notes That Do Things" executable prompt & command workflow recipes
//   4. Live embedded OTLP/JSON DELTA Cost & Token HUD.

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { cycleRemFxMode, getRemFxMode, RemFxMode } from "@/app/element/rem-ambient";
import { createBlock, globalStore } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeIconClass, stringToBase64 } from "@/util/util";
import { Atom, atom, PrimitiveAtom, useAtomValue } from "jotai";
import * as React from "react";
import "./adehub.scss";

type HubTab = "sessions" | "tasks" | "workspaces" | "ports" | "agents" | "notes" | "runtime";

const KANBAN_COLS: { id: string; label: string }[] = [
    { id: "todo", label: "To Do" },
    { id: "in_progress", label: "In Progress" },
    { id: "review", label: "Review" },
    { id: "done", label: "Done" },
];

const WORKFLOW_PACKS: { title: string; agent: string; body: string }[] = [
    {
        title: "Windows Port & Dev Server Inspector",
        agent: "shell",
        body: "Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3000,5173,8080,8000 } | Select-Object LocalPort,OwningProcess",
    },
    {
        title: "TDD Bug Fix & Verification",
        agent: "claude",
        body: "1. Reproduce the bug with a minimal failing unit test first.\n2. Run the test suite to confirm failure.\n3. Implement the smallest clean fix.\n4. Re-run tests + build and summarize root cause & diff.",
    },
    {
        title: "Git Conflict Safe Resolver",
        agent: "codex",
        body: "Inspect `git status` and all conflict markers (`<<<<<<<`). Preserve both feature intents, never drop security checks, run project tests, and stage resolved files.",
    },
    {
        title: "Security & Secret Diff Audit",
        agent: "any",
        body: "Review `git diff --cached` for hardcoded tokens, command injection, path traversal (`..`), unsafe shell invocation, and missing error checks. Report exact line numbers and fixes.",
    },
];

export class AdeHubViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon: Atom<string>;
    viewName: Atom<string>;

    activeTabAtom: PrimitiveAtom<HubTab>;
    hubAtom: PrimitiveAtom<AdeHubSnapshotData | null>;
    portsAtom: PrimitiveAtom<AdePortData[]>;
    tasksAtom: PrimitiveAtom<AdeTaskData[]>;
    workspacesAtom: PrimitiveAtom<AdeWorkspaceData[]>;
    runtimeAtom: PrimitiveAtom<AdeRuntimeStatsData | null>;
    activityAtom: PrimitiveAtom<AdeActivityFeedData | null>;
    sshAuditAtom: PrimitiveAtom<AdeSSHAuditReportData | null>;
    projectAtom: PrimitiveAtom<AdeProjectReportData | null>;
    errorAtom: PrimitiveAtom<string | null>;
    noticeAtom: PrimitiveAtom<string | null>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "adehub";
        this.viewIcon = atom("sparkles");
        this.viewName = atom("ADE Hub");

        this.activeTabAtom = atom<HubTab>("sessions");
        this.hubAtom = atom(null) as PrimitiveAtom<AdeHubSnapshotData | null>;
        this.portsAtom = atom<AdePortData[]>([]);
        this.tasksAtom = atom<AdeTaskData[]>([]);
        this.workspacesAtom = atom<AdeWorkspaceData[]>([]);
        this.runtimeAtom = atom(null) as PrimitiveAtom<AdeRuntimeStatsData | null>;
        this.activityAtom = atom(null) as PrimitiveAtom<AdeActivityFeedData | null>;
        this.sshAuditAtom = atom(null) as PrimitiveAtom<AdeSSHAuditReportData | null>;
        this.projectAtom = atom(null) as PrimitiveAtom<AdeProjectReportData | null>;
        this.errorAtom = atom(null) as PrimitiveAtom<string | null>;
        this.noticeAtom = atom(null) as PrimitiveAtom<string | null>;
    }

    get viewComponent(): ViewComponent {
        return AdeHubView;
    }

    async refresh(query = "", agentFilter = "all"): Promise<void> {
        try {
            const [snap, ports, tasks, workspaces, runtime, activity] = await Promise.all([
                RpcApi.AdeGetHubSnapshotCommand(TabRpcClient, {
                    query,
                    agentFilter,
                    limit: 60,
                }),
                RpcApi.AdeListPortsCommand(TabRpcClient).catch(() => [] as AdePortData[]),
                RpcApi.AdeListTasksCommand(TabRpcClient).catch(() => [] as AdeTaskData[]),
                RpcApi.AdeListWorkspacesCommand(TabRpcClient).catch(() => [] as AdeWorkspaceData[]),
                RpcApi.AdeGetRuntimeStatsCommand(TabRpcClient).catch(() => null),
                RpcApi.AdeGetActivityCommand(TabRpcClient).catch(() => null),
            ]);
            globalStore.set(this.hubAtom, snap);
            globalStore.set(this.portsAtom, ports ?? []);
            globalStore.set(this.tasksAtom, tasks ?? []);
            globalStore.set(this.workspacesAtom, workspaces ?? []);
            globalStore.set(this.runtimeAtom, runtime);
            globalStore.set(this.activityAtom, activity);
            globalStore.set(this.errorAtom, null);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async markActivityRead(): Promise<void> {
        try {
            await RpcApi.AdeMarkActivityReadCommand(TabRpcClient);
            globalStore.set(this.noticeAtom, "Marked all activity notifications as read");
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async setCostBudget(budgetUsd: number): Promise<void> {
        try {
            await RpcApi.AdeSetCostBudgetCommand(TabRpcClient, { budgetUsd });
            globalStore.set(
                this.noticeAtom,
                budgetUsd > 0 ? `AI Cost Guard set to $${budgetUsd.toFixed(2)}` : "AI Cost Guard disabled"
            );
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async resetCost(): Promise<void> {
        try {
            await RpcApi.AdeResetCostCommand(TabRpcClient);
            globalStore.set(this.noticeAtom, "Reset session OTLP cost & token counters");
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async inspectProject(dir: string): Promise<void> {
        try {
            const rep = await RpcApi.AdeInspectProjectCommand(TabRpcClient, { dir });
            globalStore.set(this.projectAtom, rep);
            globalStore.set(this.noticeAtom, `Detected ${rep.stacks.join(", ") || "project"} in ${rep.name}`);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async generateWorktreeInclude(dir: string): Promise<void> {
        try {
            const res = await RpcApi.AdeEnsureWorktreeIncludeCommand(TabRpcClient, { dir });
            globalStore.set(this.noticeAtom, res?.output || "Updated .worktreeinclude");
            await this.inspectProject(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async runProjectCommand(cwd: string, command: string): Promise<void> {
        const parts = command.trim().split(/\s+/);
        await createBlock({
            meta: {
                view: "term",
                controller: "cmd",
                cmd: parts[0],
                "cmd:args": parts.slice(1),
                "cmd:cwd": cwd,
                "cmd:interactive": true,
                "cmd:login": true,
            },
        });
    }

    async runSSHAudit(content = ""): Promise<void> {
        try {
            const rep = await RpcApi.AdeAuditSSHConfigCommand(TabRpcClient, { content });
            globalStore.set(this.sshAuditAtom, rep);
            globalStore.set(
                this.noticeAtom,
                `Audited ${rep.file}: ${rep.errorCount} error(s), ${rep.warningCount} warning(s)`
            );
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async saveWorkspace(
        name: string,
        repoDir: string,
        defaultAgent: string,
        layoutPreset: string,
        devPort: number
    ): Promise<boolean> {
        try {
            const saved = await RpcApi.AdeSaveWorkspaceCommand(TabRpcClient, {
                name,
                repoDir,
                defaultAgent,
                layoutPreset,
                devPort: devPort > 0 ? devPort : undefined,
                color: "aqua",
            });
            globalStore.set(this.noticeAtom, `Saved workspace "${saved.name}" (${saved.layoutPreset})`);
            await this.refresh();
            return true;
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
            return false;
        }
    }

    async deleteWorkspace(id: string): Promise<void> {
        try {
            await RpcApi.AdeDeleteWorkspaceCommand(TabRpcClient, { id });
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async launchWorkspace(ws: AdeWorkspaceData): Promise<void> {
        const cwd = ws.repoDir;
        const primaryAgent = ws.defaultAgent === "codex" ? "codex" : ws.defaultAgent === "gemini" ? "gemini" : "claude";
        if (ws.layoutPreset === "dual-agent") {
            await createBlock({
                meta: { view: "term", controller: "cmd", cmd: "claude", "cmd:cwd": cwd, "cmd:interactive": true, "cmd:login": true },
            });
            await createBlock({
                meta: { view: "term", controller: "cmd", cmd: "codex", "cmd:cwd": cwd, "cmd:interactive": true, "cmd:login": true },
            });
            await createBlock({ meta: { view: "vcs" } });
        } else if (ws.layoutPreset === "ship-review") {
            await createBlock({ meta: { view: "vcs" } });
            await createBlock({ meta: { view: "aitools" } });
            await createBlock({ meta: { view: "term", controller: "shell", "cmd:cwd": cwd } });
        } else {
            await createBlock({
                meta: {
                    view: "term",
                    controller: primaryAgent === "shell" ? "shell" : "cmd",
                    cmd: primaryAgent === "shell" ? undefined : primaryAgent,
                    "cmd:cwd": cwd,
                    "cmd:interactive": true,
                    "cmd:login": true,
                },
            });
            await createBlock({ meta: { view: "vcs" } });
        }
        if (ws.devPort && ws.devPort > 0) {
            await createBlock({ meta: { view: "web", url: `http://127.0.0.1:${ws.devPort}` } });
        }
        globalStore.set(this.noticeAtom, `Launched workspace "${ws.name}" (${ws.layoutPreset})`);
    }

    async saveTask(title: string, agent: string, priority: string, repoDir: string, description: string): Promise<boolean> {
        try {
            const saved = await RpcApi.AdeSaveTaskCommand(TabRpcClient, {
                title,
                agent,
                priority,
                repoDir: repoDir.trim() || undefined,
                description: description.trim() || undefined,
                status: "todo",
            });
            globalStore.set(this.noticeAtom, `Added task "${saved.title}" (${saved.branch})`);
            await this.refresh();
            return true;
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
            return false;
        }
    }

    async moveTask(id: string, status: string, worktreePath?: string): Promise<void> {
        try {
            await RpcApi.AdeMoveTaskCommand(TabRpcClient, { id, status, worktreePath });
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async deleteTask(id: string): Promise<void> {
        try {
            await RpcApi.AdeDeleteTaskCommand(TabRpcClient, { id });
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async dispatchTask(task: AdeTaskData): Promise<void> {
        let launchDir = task.worktreePath || task.repoDir || "";
        if (!task.worktreePath && task.repoDir && task.branch) {
            try {
                const wt = await RpcApi.VcsCreateWorktreeCommand(TabRpcClient, {
                    dir: task.repoDir,
                    branch: task.branch,
                });
                launchDir = wt.path;
                const hyd =
                    wt.hydratedFiles && wt.hydratedFiles.length > 0
                        ? ` · hydrated ${wt.hydratedFiles.join(", ")}`
                        : "";
                globalStore.set(this.noticeAtom, `Dispatched "${task.title}" → ${wt.branch} (${wt.path}${hyd})`);
            } catch (err) {
                globalStore.set(this.errorAtom, `Worktree dispatch failed (launching in repo dir): ${String(err)}`);
            }
        }
        await this.moveTask(task.id, "in_progress", launchDir || undefined);
        const cmd = task.agent === "codex" ? "codex" : task.agent === "gemini" ? "gemini" : "claude";
        await createBlock({
            meta: {
                view: "term",
                controller: "cmd",
                cmd,
                "cmd:cwd": launchDir || undefined,
                "cmd:interactive": true,
                "cmd:login": true,
            },
        });
    }

    async openPortWebBlock(url: string): Promise<void> {
        await createBlock({
            meta: {
                view: "web",
                url,
            },
        });
    }

    async killDevPort(port: number, pid: number): Promise<void> {
        try {
            const res = await RpcApi.AdeKillDevPortCommand(TabRpcClient, { port, pid });
            globalStore.set(this.noticeAtom, res?.output || `Stopped dev server PID ${pid} on :${port}`);
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async broadcastToTabTerminals(text: string): Promise<void> {
        const clean = text.trim();
        if (!clean) return;
        // Run SLTerm Command Firewall (SLT011–SLT016) before broadcasting to multiple terminals!
        const risk = await this.checkCommandRisk(clean);
        if (risk && risk.verdict === "block") {
            globalStore.set(
                this.errorAtom,
                `Broadcast BLOCKED by Command Firewall (Risk ${risk.riskScore}/100): ${risk.findings?.[0]?.message || "high-risk command"}`
            );
            return;
        }
        const tabData = globalStore.get(this.tabModel.tabAtom);
        const blockIds = tabData?.blockids ?? [];
        const termIds: string[] = [];
        for (const bid of blockIds) {
            if (bid === this.blockId) continue;
            const blk = WOS.getObjectValue<Block>(WOS.makeORef("block", bid), globalStore.get);
            if (blk?.meta?.view === "term") {
                termIds.push(bid);
            }
        }
        if (termIds.length === 0) {
            globalStore.set(this.errorAtom, "No open terminal blocks found in this tab to broadcast to.");
            return;
        }
        const payload64 = stringToBase64(clean + "\n");
        let sent = 0;
        for (const bid of termIds) {
            try {
                await RpcApi.ControllerInputCommand(TabRpcClient, {
                    blockid: bid,
                    inputdata64: payload64,
                });
                sent++;
            } catch {
                // ignore closed terminal race
            }
        }
        globalStore.set(this.noticeAtom, `📡 Broadcasted command/prompt to ${sent} open terminal block(s) in this tab`);
    }

    async resumeSession(session: AdeSessionData): Promise<void> {
        const isClaude = session.agent === "claude";
        await createBlock({
            meta: {
                view: "term",
                controller: "cmd",
                cmd: isClaude ? "claude" : "codex",
                "cmd:args": isClaude ? [`--resume=${session.id}`] : ["resume", session.id],
                "cmd:cwd": session.cwd || undefined,
                "cmd:interactive": true,
                "cmd:login": true,
            },
        });
    }

    async forkSession(session: AdeSessionData): Promise<void> {
        try {
            const forked = await RpcApi.AdeForkSessionCommand(TabRpcClient, {
                agent: session.agent,
                sessionId: session.id,
            });
            globalStore.set(
                this.noticeAtom,
                `Forked ${session.agent} session ${session.id.slice(0, 8)} → ${forked.id.slice(0, 8)}`
            );
            await this.refresh();
            await this.resumeSession(forked);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async checkCommandRisk(command: string): Promise<AdeCommandRiskData | null> {
        try {
            return await RpcApi.AdeCheckCommandRiskCommand(TabRpcClient, {
                command,
                policy: "balanced",
            });
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
            return null;
        }
    }

    async launchAgent(agent: AdeDetectedAgentData, cwd: string): Promise<void> {
        const parts = agent.command.trim().split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        await createBlock({
            meta: {
                view: "term",
                controller: agent.category === "shell" ? "shell" : "cmd",
                cmd: agent.category === "shell" ? undefined : cmd,
                "cmd:args": args.length > 0 ? args : undefined,
                "cmd:cwd": cwd.trim() || undefined,
                "cmd:interactive": true,
                "cmd:login": true,
            },
        });
    }

    async launchParallelAgents(agents: string[], cwd: string, promptText: string): Promise<void> {
        const cleanCwd = cwd.trim() || undefined;
        if (promptText.trim()) {
            try {
                await navigator.clipboard?.writeText(promptText.trim());
            } catch {
                // ignore clipboard failure
            }
        }
        for (const ag of agents) {
            await createBlock({
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: ag,
                    "cmd:cwd": cleanCwd,
                    "cmd:interactive": true,
                    "cmd:login": true,
                },
            });
        }
        globalStore.set(
            this.noticeAtom,
            `Launched ${agents.join(" + ")} in parallel${promptText.trim() ? " (prompt copied to clipboard)" : ""}`
        );
    }

    async saveNote(title: string, agent: string, body: string): Promise<boolean> {
        try {
            await RpcApi.AdeSavePromptNoteCommand(TabRpcClient, { title, agent, body });
            globalStore.set(this.noticeAtom, `Saved prompt note "${title}"`);
            await this.refresh();
            return true;
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
            return false;
        }
    }

    async deleteNote(id: string): Promise<void> {
        try {
            await RpcApi.AdeDeletePromptNoteCommand(TabRpcClient, { id });
            await this.refresh();
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }
}

function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n || 0);
}

function AdeHubView({ model }: { model: AdeHubViewModel }) {
    const activeTab = useAtomValue(model.activeTabAtom);
    const hub = useAtomValue(model.hubAtom);
    const ports = useAtomValue(model.portsAtom);
    const tasks = useAtomValue(model.tasksAtom);
    const workspaces = useAtomValue(model.workspacesAtom);
    const runtime = useAtomValue(model.runtimeAtom);
    const activity = useAtomValue(model.activityAtom);
    const sshAudit = useAtomValue(model.sshAuditAtom);
    const project = useAtomValue(model.projectAtom);
    const error = useAtomValue(model.errorAtom);
    const notice = useAtomValue(model.noticeAtom);

    const [query, setQuery] = React.useState("");
    const [agentFilter, setAgentFilter] = React.useState("all");
    const [launchCwd, setLaunchCwd] = React.useState("");
    const [noteTitle, setNoteTitle] = React.useState("");
    const [noteAgent, setNoteAgent] = React.useState("any");
    const [noteBody, setNoteBody] = React.useState("");
    const [fxMode, setFxMode] = React.useState<RemFxMode>(() => getRemFxMode());
    const [taskTitle, setTaskTitle] = React.useState("");
    const [taskAgent, setTaskAgent] = React.useState("claude");
    const [taskPriority, setTaskPriority] = React.useState("medium");
    const [taskRepo, setTaskRepo] = React.useState("");
    const [devPortsOnly, setDevPortsOnly] = React.useState(true);
    const [riskReport, setRiskReport] = React.useState<AdeCommandRiskData | null>(null);
    const [wsName, setWsName] = React.useState("");
    const [wsDir, setWsDir] = React.useState("");
    const [wsAgent, setWsAgent] = React.useState("claude");
    const [wsPreset, setWsPreset] = React.useState("full-ade");
    const [wsPort, setWsPort] = React.useState("");

    React.useEffect(() => {
        model.refresh(query, agentFilter);
    }, [model, agentFilter]);

    const cost = hub?.cost;
    const waitingCount = (hub?.sessions ?? []).filter((s) => s.status === "waiting_approval").length;

    return (
        <div className="adehub-view">
            <div className="adehub-hud">
                <div className="adehub-hud-title">
                    <i className={makeIconClass("sparkles", false)} />
                    <strong>SLTerm ADE Hub</strong>
                    {waitingCount > 0 && <span className="adehub-pill waiting">{waitingCount} waiting on you</span>}
                </div>
                <div className="adehub-hud-metrics">
                    <span className={cost?.budgetExceeded ? "adehub-pill waiting" : ""}>
                        Cost: <strong>${(cost?.totalCostUsd ?? 0).toFixed(4)}</strong>
                        {cost?.budgetUsd ? ` / $${cost.budgetUsd.toFixed(2)}` : ""}
                    </span>
                    <span>
                        In: <strong>{fmtTokens(cost?.totalInputTokens ?? 0)}</strong>
                    </span>
                    <span>
                        Out: <strong>{fmtTokens(cost?.totalOutputTokens ?? 0)}</strong>
                    </span>
                    <span>
                        Cache: <strong>{fmtTokens(cost?.totalCacheTokens ?? 0)}</strong>
                    </span>
                    <button
                        className="adehub-btn rem-fx"
                        onClick={() => setFxMode(cycleRemFxMode())}
                        title="Toggle Rem Aqua Anime Ambient FX (Calm / Dreamy / Off)"
                    >
                        {fxMode === "off" ? "✧ FX: Off" : fxMode === "dreamy" ? "✦ FX: Dreamy" : "❄ FX: Calm"}
                    </button>
                    <button
                        className="adehub-btn"
                        onClick={() => model.refresh(query, agentFilter)}
                        title="Refresh ADE Hub"
                    >
                        <i className={makeIconClass("rotate", false)} />
                    </button>
                </div>
            </div>

            <div className="adehub-tabs">
                <button
                    className={`adehub-tab ${activeTab === "sessions" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "sessions")}
                >
                    Sessions ({hub?.sessions?.length ?? 0})
                </button>
                <button
                    className={`adehub-tab ${activeTab === "tasks" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "tasks")}
                >
                    Tasks ({tasks.length})
                </button>
                <button
                    className={`adehub-tab ${activeTab === "workspaces" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "workspaces")}
                >
                    Workspaces ({workspaces.length})
                </button>
                <button
                    className={`adehub-tab ${activeTab === "ports" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "ports")}
                >
                    Ports Radar ({ports.filter((p) => p.isDevLikely).length}/{ports.length})
                </button>
                <button
                    className={`adehub-tab ${activeTab === "agents" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "agents")}
                >
                    Agents &amp; Shells ({(hub?.agents ?? []).filter((a) => a.installed).length}/{hub?.agents?.length ?? 0})
                </button>
                <button
                    className={`adehub-tab ${activeTab === "notes" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "notes")}
                >
                    Prompt Notes ({hub?.notes?.length ?? 0})
                </button>
                <button
                    className={`adehub-tab ${activeTab === "runtime" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "runtime")}
                >
                    🛡 Activity &amp; Runtime ({runtime ? `${runtime.sidecarHeapMb.toFixed(1)} MB` : "…"}
                    {(activity?.unreadCount ?? 0) > 0 ? ` · 🔔 ${activity?.unreadCount}` : ""})
                </button>
            </div>

            {error && <div className="adehub-banner error">{error}</div>}
            {notice && <div className="adehub-banner notice">{notice}</div>}

            <div className="adehub-body">
                {activeTab === "sessions" && (
                    <>
                        <div className="adehub-bar">
                            <input
                                className="adehub-input"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") model.refresh(query, agentFilter);
                                }}
                                placeholder="Fuzzy search past Claude & Codex prompts, folders, or session IDs..."
                            />
                            <select
                                className="adehub-select"
                                value={agentFilter}
                                onChange={(e) => setAgentFilter(e.target.value)}
                            >
                                <option value="all">All Agents</option>
                                <option value="claude">Claude Code</option>
                                <option value="codex">OpenAI Codex</option>
                            </select>
                            <button className="adehub-btn" onClick={() => model.refresh(query, agentFilter)}>
                                Search
                            </button>
                        </div>

                        {(hub?.sessions ?? []).length === 0 ? (
                            <div className="adehub-empty">
                                No matching Claude Code or Codex sessions found on disk yet. Launch an agent from the
                                Agents tab to begin.
                            </div>
                        ) : (
                            <div className="adehub-list">
                                {(hub?.sessions ?? []).map((s) => (
                                    <div key={`${s.agent}:${s.id}`} className="adehub-card">
                                        <div className="adehub-card-main">
                                            <div className="adehub-card-head">
                                                <span className={`adehub-dot ${s.status}`} title={s.status} />
                                                <span className="adehub-agent-tag">{s.agent}</span>
                                                <strong className="adehub-card-title">{s.title}</strong>
                                            </div>
                                            <div className="adehub-card-meta">
                                                <span>{s.cwd || "(no cwd)"}</span>
                                                <span>· {s.messageCount} msgs</span>
                                                <span>· {s.id.slice(0, 8)}</span>
                                            </div>
                                        </div>
                                        <div className="adehub-card-actions">
                                            <button
                                                className="adehub-btn primary"
                                                onClick={() => model.resumeSession(s)}
                                                title={s.resumeCommand}
                                            >
                                                Resume
                                            </button>
                                            <button
                                                className="adehub-btn"
                                                onClick={() => model.forkSession(s)}
                                                title="Clone transcript into a new branch session without mutating the original"
                                            >
                                                Fork
                                            </button>
                                            <button
                                                className="adehub-btn"
                                                onClick={() => {
                                                    navigator.clipboard?.writeText(s.resumeCommand);
                                                    globalStore.set(model.noticeAtom, `Copied: ${s.resumeCommand}`);
                                                }}
                                            >
                                                Copy
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {activeTab === "tasks" && (
                    <>
                        <div className="adehub-bar">
                            <input
                                className="adehub-input"
                                value={taskTitle}
                                onChange={(e) => setTaskTitle(e.target.value)}
                                placeholder="New agent task (auto-generates feat/<slug> branch)..."
                            />
                            <input
                                className="adehub-input"
                                value={taskRepo}
                                onChange={(e) => setTaskRepo(e.target.value)}
                                placeholder="Repo path (optional, for 1-click worktree dispatch)"
                            />
                            <select
                                className="adehub-select"
                                value={taskAgent}
                                onChange={(e) => setTaskAgent(e.target.value)}
                            >
                                <option value="claude">Claude</option>
                                <option value="codex">Codex</option>
                                <option value="gemini">Gemini</option>
                            </select>
                            <select
                                className="adehub-select"
                                value={taskPriority}
                                onChange={(e) => setTaskPriority(e.target.value)}
                            >
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                            <button
                                className="adehub-btn primary"
                                disabled={!taskTitle.trim()}
                                onClick={async () => {
                                    if (await model.saveTask(taskTitle, taskAgent, taskPriority, taskRepo, "")) {
                                        setTaskTitle("");
                                    }
                                }}
                            >
                                + Add Task
                            </button>
                        </div>

                        <div className="adehub-kanban">
                            {KANBAN_COLS.map((col, colIdx) => {
                                const colTasks = tasks.filter((t) => t.status === col.id);
                                return (
                                    <div key={col.id} className="adehub-kanban-col">
                                        <div className="adehub-kanban-head">
                                            <strong>{col.label}</strong>
                                            <span className="adehub-pill">{colTasks.length}</span>
                                        </div>
                                        <div className="adehub-kanban-cards">
                                            {colTasks.length === 0 ? (
                                                <div className="adehub-empty">No tasks</div>
                                            ) : (
                                                colTasks.map((t) => (
                                                    <div key={t.id} className={`adehub-task-card prio-${t.priority}`}>
                                                        <div className="adehub-card-head">
                                                            <span className="adehub-agent-tag">{t.agent}</span>
                                                            <strong className="adehub-card-title">{t.title}</strong>
                                                        </div>
                                                        {t.branch && <div className="adehub-card-meta">⎇ {t.branch}</div>}
                                                        {t.worktreePath && (
                                                            <div className="adehub-card-meta" title={t.worktreePath}>
                                                                wt: {t.worktreePath}
                                                            </div>
                                                        )}
                                                        <div className="adehub-task-actions">
                                                            {colIdx > 0 && (
                                                                <button
                                                                    className="adehub-btn"
                                                                    title="Move left"
                                                                    onClick={() =>
                                                                        model.moveTask(t.id, KANBAN_COLS[colIdx - 1].id)
                                                                    }
                                                                >
                                                                    ←
                                                                </button>
                                                            )}
                                                            {colIdx < KANBAN_COLS.length - 1 && (
                                                                <button
                                                                    className="adehub-btn"
                                                                    title="Move right"
                                                                    onClick={() =>
                                                                        model.moveTask(t.id, KANBAN_COLS[colIdx + 1].id)
                                                                    }
                                                                >
                                                                    →
                                                                </button>
                                                            )}
                                                            {col.id !== "done" && (
                                                                <button
                                                                    className="adehub-btn primary"
                                                                    title="Create worktree + launch AI agent"
                                                                    onClick={() => model.dispatchTask(t)}
                                                                >
                                                                    ⚡ Dispatch
                                                                </button>
                                                            )}
                                                            <button
                                                                className="adehub-btn danger"
                                                                title="Delete task"
                                                                onClick={() => model.deleteTask(t.id)}
                                                            >
                                                                ×
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {activeTab === "workspaces" && (
                    <>
                        <div className="adehub-bar">
                            <input
                                className="adehub-input"
                                value={wsName}
                                onChange={(e) => setWsName(e.target.value)}
                                placeholder="Project workspace name (e.g. SLTerm, SLClean)"
                            />
                            <input
                                className="adehub-input"
                                value={wsDir}
                                onChange={(e) => setWsDir(e.target.value)}
                                placeholder="Folder path (e.g. C:\work\SLTerm)"
                            />
                            <select className="adehub-select" value={wsAgent} onChange={(e) => setWsAgent(e.target.value)}>
                                <option value="claude">Claude</option>
                                <option value="codex">Codex</option>
                                <option value="gemini">Gemini</option>
                                <option value="shell">Shell</option>
                            </select>
                            <select
                                className="adehub-select"
                                value={wsPreset}
                                onChange={(e) => setWsPreset(e.target.value)}
                            >
                                <option value="full-ade">Full ADE Studio</option>
                                <option value="dual-agent">Dual-Agent (Claude+Codex)</option>
                                <option value="ship-review">Ship &amp; Security Review</option>
                            </select>
                            <input
                                className="adehub-input"
                                style={{ maxWidth: 96 }}
                                value={wsPort}
                                onChange={(e) => setWsPort(e.target.value)}
                                placeholder="Port (opt)"
                            />
                            <button
                                className="adehub-btn primary"
                                disabled={!wsName.trim() || !wsDir.trim()}
                                onClick={async () => {
                                    const pNum = parseInt(wsPort, 10) || 0;
                                    if (await model.saveWorkspace(wsName, wsDir, wsAgent, wsPreset, pNum)) {
                                        setWsName("");
                                        setWsDir("");
                                        setWsPort("");
                                    }
                                }}
                            >
                                + Save Workspace
                            </button>
                        </div>

                        {workspaces.length === 0 ? (
                            <div className="adehub-empty">
                                Save your favorite Windows/Unix project folders above for 1-click multi-pane ADE
                                workspace launches (Agent + Git/Worktrees + Dev Preview).
                            </div>
                        ) : (
                            <div className="adehub-list">
                                {workspaces.map((w) => (
                                    <div key={w.id} className="adehub-card">
                                        <div className="adehub-card-main">
                                            <div className="adehub-card-head">
                                                <span className="adehub-agent-tag">{w.layoutPreset}</span>
                                                <strong>{w.name}</strong>
                                                <span className="adehub-pill">{w.defaultAgent}</span>
                                                {w.devPort ? <span className="adehub-pill ready">:{w.devPort}</span> : null}
                                            </div>
                                            <div className="adehub-card-meta">{w.repoDir}</div>
                                        </div>
                                        <div className="adehub-card-actions">
                                            <button className="adehub-btn" onClick={() => model.inspectProject(w.repoDir)}>
                                                🔍 Doctor
                                            </button>
                                            <button className="adehub-btn primary" onClick={() => model.launchWorkspace(w)}>
                                                ⚡ Launch Layout
                                            </button>
                                            <button className="adehub-btn danger" onClick={() => model.deleteWorkspace(w.id)}>
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {project && (
                            <div className="adehub-card" style={{ flexDirection: "column", alignItems: "stretch" }}>
                                <div className="adehub-card-head" style={{ justifyContent: "space-between" }}>
                                    <div className="adehub-card-head">
                                        <strong>🩺 Project Doctor: {project.name}</strong>
                                        {(project.stacks ?? []).map((st) => (
                                            <span key={st} className="adehub-agent-tag">
                                                {st}
                                            </span>
                                        ))}
                                    </div>
                                    {!project.hasWorktreeInclude && (
                                        <button
                                            className="adehub-btn primary"
                                            onClick={() => model.generateWorktreeInclude(project.dir)}
                                        >
                                            + Create .worktreeinclude
                                        </button>
                                    )}
                                </div>
                                <div className="adehub-card-meta">
                                    ADE Readiness: {project.hasGit ? "✓ .git" : "✗ .git"} ·{" "}
                                    {project.hasClaudeMd ? "✓ CLAUDE.md" : "· CLAUDE.md"} ·{" "}
                                    {project.hasAgentsMd ? "✓ AGENTS.md" : "· AGENTS.md"} ·{" "}
                                    {project.hasMcpJson ? "✓ .mcp.json" : "· .mcp.json"} ·{" "}
                                    {project.hasWorktreeInclude ? "✓ .worktreeinclude" : "⚠ no .worktreeinclude"}
                                    {project.envExampleCount > 0 &&
                                        ((project.missingEnvKeys?.length ?? 0) > 0
                                            ? ` · ⚠ missing .env keys (${project.missingEnvKeys.length}): ${project.missingEnvKeys.join(", ")}`
                                            : ` · ✓ .env complete (${project.envExampleCount} keys)`)}
                                </div>
                                {(project.commands ?? []).length > 0 && (
                                    <div className="adehub-task-actions">
                                        {(project.commands ?? []).map((c) => (
                                            <button
                                                key={`${c.source}:${c.label}`}
                                                className="adehub-btn"
                                                title={`Run "${c.command}" in ${project.dir}`}
                                                onClick={() => model.runProjectCommand(project.dir, c.command)}
                                            >
                                                ▶ {c.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {activeTab === "ports" && (
                    <>
                        <div className="adehub-bar">
                            <button
                                className={`adehub-btn ${devPortsOnly ? "primary" : ""}`}
                                onClick={() => setDevPortsOnly((v) => !v)}
                            >
                                {devPortsOnly ? "Showing Dev Ports (Click for All)" : "Showing All Listening Ports"}
                            </button>
                            <button className="adehub-btn" onClick={() => model.refresh(query, agentFilter)}>
                                Refresh Ports
                            </button>
                        </div>
                        <div className="adehub-list">
                            {ports.filter((p) => !devPortsOnly || p.isDevLikely).length === 0 ? (
                                <div className="adehub-empty">
                                    No listening {devPortsOnly ? "dev " : ""}ports detected right now. Start a Vite,
                                    Next.js, Go, or Python server and refresh.
                                </div>
                            ) : (
                                ports
                                    .filter((p) => !devPortsOnly || p.isDevLikely)
                                    .map((p) => (
                                        <div key={`${p.port}:${p.pid}`} className="adehub-card">
                                            <div className="adehub-card-main">
                                                <div className="adehub-card-head">
                                                    <span className={`adehub-dot ${p.isDevLikely ? "active" : "idle"}`} />
                                                    <strong>:{p.port}</strong>
                                                    {p.isDevLikely && <span className="adehub-pill ready">DEV</span>}
                                                    {p.process && <span className="adehub-agent-tag">{p.process}</span>}
                                                </div>
                                                <div className="adehub-card-meta">
                                                    {p.url} · bind {p.address}
                                                    {p.pid > 0 ? ` · PID ${p.pid}` : ""}
                                                </div>
                                            </div>
                                            <div className="adehub-card-actions">
                                                <button
                                                    className="adehub-btn primary"
                                                    onClick={() => model.openPortWebBlock(p.url)}
                                                >
                                                    Open Preview
                                                </button>
                                                <button
                                                    className="adehub-btn"
                                                    onClick={() => {
                                                        navigator.clipboard?.writeText(p.url);
                                                        globalStore.set(model.noticeAtom, `Copied ${p.url}`);
                                                    }}
                                                >
                                                    Copy URL
                                                </button>
                                                {p.isDevLikely && p.pid > 4 && (
                                                    <button
                                                        className="adehub-btn danger"
                                                        title={`Safely stop localhost dev server PID ${p.pid} on :${p.port}`}
                                                        onClick={() => {
                                                            if (
                                                                window.confirm(
                                                                    `Stop local dev server ${p.process || "process"} (PID ${p.pid}) listening on :${p.port}?`
                                                                )
                                                            ) {
                                                                void model.killDevPort(p.port, p.pid);
                                                            }
                                                        }}
                                                    >
                                                        ⏹ Stop PID
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                    </>
                )}

                {activeTab === "agents" && (
                    <>
                        <div className="adehub-bar">
                            <input
                                className="adehub-input"
                                value={launchCwd}
                                onChange={(e) => setLaunchCwd(e.target.value)}
                                placeholder="Optional launch directory (e.g. C:\work\project — blank = home)"
                            />
                        </div>
                        <div className="adehub-grid">
                            {(hub?.agents ?? []).map((a) => (
                                <div key={a.id} className={`adehub-agent-card ${a.installed ? "ready" : "missing"}`}>
                                    <div className="adehub-agent-top">
                                        <strong>{a.name}</strong>
                                        <span className={`adehub-pill ${a.installed ? "ready" : "missing"}`}>
                                            {a.installed ? "Installed" : "Not found"}
                                        </span>
                                    </div>
                                    <div className="adehub-card-meta">{a.description}</div>
                                    {a.binaryPath && <div className="adehub-bin-path">{a.binaryPath}</div>}
                                    <div className="adehub-card-actions">
                                        <button
                                            className={`adehub-btn ${a.installed ? "primary" : ""}`}
                                            onClick={() => model.launchAgent(a, launchCwd)}
                                        >
                                            Launch {a.name}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {activeTab === "notes" && (
                    <>
                        <div className="adehub-note-form">
                            <div className="adehub-bar">
                                <input
                                    className="adehub-input"
                                    value={noteTitle}
                                    onChange={(e) => setNoteTitle(e.target.value)}
                                    placeholder="Workflow note title (e.g. Audit Windows Perf)"
                                />
                                <select
                                    className="adehub-select"
                                    value={noteAgent}
                                    onChange={(e) => setNoteAgent(e.target.value)}
                                >
                                    <option value="any">Any Agent</option>
                                    <option value="claude">Claude</option>
                                    <option value="codex">Codex</option>
                                    <option value="shell">Shell</option>
                                </select>
                                <button
                                    className="adehub-btn"
                                    disabled={!noteBody.trim()}
                                    title="Launch Claude + Codex side-by-side in launch directory and copy this prompt to clipboard"
                                    onClick={() => model.launchParallelAgents(["claude", "codex"], launchCwd, noteBody)}
                                >
                                    🚀 Dual Launch
                                </button>
                                <button
                                    className="adehub-btn"
                                    disabled={!noteBody.trim()}
                                    title="Send this prompt/command to ALL open terminal blocks in the current tab (Command Firewall checked)"
                                    onClick={() => model.broadcastToTabTerminals(noteBody)}
                                >
                                    📡 Broadcast
                                </button>
                                <button
                                    className="adehub-btn"
                                    disabled={!noteBody.trim()}
                                    title="Run SLTerm Command Firewall (SLT011-SLT016) safety scan before saving/executing"
                                    onClick={async () => {
                                        setRiskReport(await model.checkCommandRisk(noteBody));
                                    }}
                                >
                                    🛡 Audit Risk
                                </button>
                                <button
                                    className="adehub-btn primary"
                                    disabled={!noteTitle.trim() || !noteBody.trim()}
                                    onClick={async () => {
                                        if (await model.saveNote(noteTitle, noteAgent, noteBody)) {
                                            setNoteTitle("");
                                            setNoteBody("");
                                            setRiskReport(null);
                                        }
                                    }}
                                >
                                    + Save Note
                                </button>
                            </div>
                            <textarea
                                className="adehub-textarea"
                                rows={2}
                                value={noteBody}
                                onChange={(e) => setNoteBody(e.target.value)}
                                placeholder="Reusable prompt or shell command workflow (click 🛡 Audit Risk for SLT011–SLT016 preview)..."
                            />
                            {riskReport && (
                                <div className={`adehub-risk-box verdict-${riskReport.verdict}`}>
                                    <div className="adehub-card-head">
                                        <strong>Command Firewall: {riskReport.verdict.toUpperCase()}</strong>
                                        <span className="adehub-pill">Risk {riskReport.riskScore}/100</span>
                                        <span className="adehub-card-meta">
                                            {riskReport.findings?.length ?? 0} finding(s)
                                        </span>
                                    </div>
                                    {(riskReport.findings ?? []).map((f, i) => (
                                        <div key={i} className="adehub-card-meta">
                                            [{f.ruleId}] {f.message} — {f.remediation}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="adehub-task-actions" style={{ marginTop: 6 }}>
                                <span className="adehub-card-meta" style={{ marginRight: 4 }}>
                                    Quick Packs:
                                </span>
                                {WORKFLOW_PACKS.map((pk) => (
                                    <button
                                        key={pk.title}
                                        className="adehub-btn"
                                        title="Load curated workflow pack into editor"
                                        onClick={() => {
                                            setNoteTitle(pk.title);
                                            setNoteAgent(pk.agent);
                                            setNoteBody(pk.body);
                                        }}
                                    >
                                        ✦ {pk.title}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="adehub-list">
                            {(hub?.notes ?? []).map((n) => (
                                <div key={n.id} className="adehub-card">
                                    <div className="adehub-card-main">
                                        <div className="adehub-card-head">
                                            <span className="adehub-agent-tag">{n.agent}</span>
                                            <strong className="adehub-card-title">{n.title}</strong>
                                        </div>
                                        <div className="adehub-note-body">{n.body}</div>
                                    </div>
                                    <div className="adehub-card-actions">
                                        <button
                                            className="adehub-btn"
                                            title="Audit this workflow with SLTerm Command Firewall"
                                            onClick={async () => {
                                                setRiskReport(await model.checkCommandRisk(n.body));
                                            }}
                                        >
                                            🛡 Check
                                        </button>
                                        <button
                                            className="adehub-btn primary"
                                            onClick={() => {
                                                navigator.clipboard?.writeText(n.body);
                                                globalStore.set(model.noticeAtom, `Copied workflow "${n.title}" to clipboard`);
                                            }}
                                        >
                                            Copy Prompt
                                        </button>
                                        <button className="adehub-btn danger" onClick={() => model.deleteNote(n.id)}>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {activeTab === "runtime" && (
                    <>
                        <div className="adehub-card">
                            <div className="adehub-card-main">
                                <div className="adehub-card-head">
                                    <strong>❄ SLTerm Lean Sidecar Runtime</strong>
                                    {runtime && <span className="adehub-pill ready">{runtime.platform}</span>}
                                </div>
                                <div className="adehub-card-meta">
                                    {runtime
                                        ? `Heap: ${runtime.sidecarHeapMb.toFixed(1)} MB · Sys: ${runtime.sidecarSysMb.toFixed(1)} MB · Goroutines: ${runtime.goroutines} · Active AI Agents: ${runtime.activeAgents} · Dev Procs: ${runtime.activeDevProcs}`
                                        : "Loading runtime telemetry..."}
                                </div>
                            </div>
                            <div className="adehub-card-actions">
                                <button className="adehub-btn" onClick={() => model.refresh(query, agentFilter)}>
                                    Refresh
                                </button>
                                <button className="adehub-btn primary" onClick={() => model.runSSHAudit("")}>
                                    🛡 Audit ~/.ssh/config
                                </button>
                            </div>
                        </div>

                        {(runtime?.processes ?? []).length > 0 && (
                            <div className="adehub-list">
                                {(runtime?.processes ?? []).map((p) => (
                                    <div key={`${p.pid}:${p.name}`} className="adehub-card">
                                        <div className="adehub-card-main">
                                            <div className="adehub-card-head">
                                                <span className={`adehub-pill ${p.role === "agent" ? "ready" : ""}`}>
                                                    {p.role}
                                                </span>
                                                <strong>{p.name}</strong>
                                            </div>
                                            <div className="adehub-card-meta">
                                                PID {p.pid} · {p.rssMb.toFixed(1)} MB RSS
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="adehub-card" style={{ flexDirection: "column", alignItems: "stretch" }}>
                            <div className="adehub-card-head" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                                <div className="adehub-card-head">
                                    <strong>💰 AI OTLP Cost Guard &amp; Breakdown</strong>
                                    <span className={`adehub-pill ${cost?.budgetExceeded ? "waiting" : "ready"}`}>
                                        ${(cost?.totalCostUsd ?? 0).toFixed(4)}
                                        {cost?.budgetUsd ? ` / $${cost.budgetUsd.toFixed(2)}` : " (no cap)"}
                                    </span>
                                </div>
                                <div className="adehub-card-actions">
                                    {[0, 1, 5, 10, 25].map((cap) => (
                                        <button
                                            key={cap}
                                            className={`adehub-btn ${
                                                Math.abs((cost?.budgetUsd ?? 0) - cap) < 0.01 ? "primary" : ""
                                            }`}
                                            onClick={() => model.setCostBudget(cap)}
                                        >
                                            {cap === 0 ? "Off" : `$${cap}`}
                                        </button>
                                    ))}
                                    <button className="adehub-btn danger" onClick={() => model.resetCost()}>
                                        ↺ Reset
                                    </button>
                                </div>
                            </div>
                            {(cost?.blocks ?? []).length === 0 ? (
                                <div className="adehub-card-meta">
                                    Configure Claude Code or Codex OTLP endpoint to track per-block token &amp; USD spend
                                    with automatic budget alerts.
                                </div>
                            ) : (
                                <div className="adehub-list" style={{ marginTop: 6 }}>
                                    {(cost?.blocks ?? []).map((b) => (
                                        <div key={b.blockId} className="adehub-card">
                                            <div className="adehub-card-main">
                                                <div className="adehub-card-head">
                                                    <span className="adehub-agent-tag">{b.blockId.slice(0, 12)}</span>
                                                    <strong>${b.costUsd.toFixed(4)}</strong>
                                                </div>
                                                <div className="adehub-card-meta">
                                                    In {fmtTokens(b.inputTokens)} · Out {fmtTokens(b.outputTokens)} ·
                                                    Cache {fmtTokens(b.cacheTokens)}
                                                    {b.sessionId ? ` · session ${b.sessionId.slice(0, 8)}` : ""}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="adehub-card" style={{ flexDirection: "column", alignItems: "stretch" }}>
                            <div className="adehub-card-head" style={{ justifyContent: "space-between" }}>
                                <div className="adehub-card-head">
                                    <strong>🔔 ADE Activity Feed</strong>
                                    <span className={`adehub-pill ${(activity?.unreadCount ?? 0) > 0 ? "waiting" : ""}`}>
                                        {activity?.unreadCount ?? 0} unread
                                    </span>
                                    {(activity?.waitingCount ?? 0) > 0 && (
                                        <span className="adehub-pill waiting">
                                            {activity?.waitingCount} waiting approval
                                        </span>
                                    )}
                                </div>
                                {(activity?.unreadCount ?? 0) > 0 && (
                                    <button className="adehub-btn" onClick={() => model.markActivityRead()}>
                                        ✓ Mark all read
                                    </button>
                                )}
                            </div>
                            {(activity?.events ?? []).length === 0 ? (
                                <div className="adehub-card-meta">
                                    Watching Claude/Codex session transitions, worktree operations, and SSH security
                                    audits.
                                </div>
                            ) : (
                                <div className="adehub-list" style={{ marginTop: 6 }}>
                                    {(activity?.events ?? []).slice(0, 12).map((ev) => (
                                        <div key={ev.id} className="adehub-card">
                                            <div className="adehub-card-main">
                                                <div className="adehub-card-head">
                                                    <span
                                                        className={`adehub-dot ${
                                                            ev.severity === "attention"
                                                                ? "waiting_approval"
                                                                : ev.read
                                                                ? "idle"
                                                                : "active"
                                                        }`}
                                                    />
                                                    <span className="adehub-agent-tag">{ev.kind}</span>
                                                    <strong>{ev.title}</strong>
                                                </div>
                                                {(ev.detail || ev.cwd) && (
                                                    <div className="adehub-card-meta">
                                                        {ev.detail}
                                                        {ev.cwd ? ` · ${ev.cwd}` : ""}
                                                    </div>
                                                )}
                                            </div>
                                            {ev.sessionId && (
                                                <div className="adehub-card-actions">
                                                    <button
                                                        className="adehub-btn primary"
                                                        onClick={() => {
                                                            const matched = (hub?.sessions ?? []).find(
                                                                (s) => s.id === ev.sessionId
                                                            );
                                                            if (matched) {
                                                                model.resumeSession(matched);
                                                            } else {
                                                                globalStore.set(model.activeTabAtom, "sessions");
                                                            }
                                                        }}
                                                    >
                                                        Resume
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {sshAudit && (
                            <div
                                className={`adehub-risk-box ${
                                    sshAudit.errorCount > 0
                                        ? "verdict-block"
                                        : sshAudit.warningCount > 0
                                        ? "verdict-warn"
                                        : "verdict-allow"
                                }`}
                            >
                                <div className="adehub-card-head">
                                    <strong>OpenSSH Audit ({sshAudit.file})</strong>
                                    <span className="adehub-pill">
                                        {sshAudit.errorCount} err · {sshAudit.warningCount} warn
                                    </span>
                                </div>
                                {(sshAudit.findings ?? []).length === 0 ? (
                                    <div className="adehub-card-meta">
                                        ✓ Clean! Zero SLT001–SLT010 SSH security findings detected.
                                    </div>
                                ) : (
                                    (sshAudit.findings ?? []).map((f, i) => (
                                        <div key={i} className="adehub-card-meta">
                                            Line {f.line} [{f.ruleId}/{f.cwe}] {f.message} — {f.remediation}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
