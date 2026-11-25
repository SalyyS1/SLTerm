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
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeIconClass } from "@/util/util";
import { Atom, atom, PrimitiveAtom, useAtomValue } from "jotai";
import * as React from "react";
import "./adehub.scss";

type HubTab = "sessions" | "agents" | "notes";

export class AdeHubViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon: Atom<string>;
    viewName: Atom<string>;

    activeTabAtom: PrimitiveAtom<HubTab>;
    hubAtom: PrimitiveAtom<AdeHubSnapshotData | null>;
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
        this.errorAtom = atom(null) as PrimitiveAtom<string | null>;
        this.noticeAtom = atom(null) as PrimitiveAtom<string | null>;
    }

    get viewComponent(): ViewComponent {
        return AdeHubView;
    }

    async refresh(query = "", agentFilter = "all"): Promise<void> {
        try {
            const snap = await RpcApi.AdeGetHubSnapshotCommand(TabRpcClient, {
                query,
                agentFilter,
                limit: 60,
            });
            globalStore.set(this.hubAtom, snap);
            globalStore.set(this.errorAtom, null);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
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
    const error = useAtomValue(model.errorAtom);
    const notice = useAtomValue(model.noticeAtom);

    const [query, setQuery] = React.useState("");
    const [agentFilter, setAgentFilter] = React.useState("all");
    const [launchCwd, setLaunchCwd] = React.useState("");
    const [noteTitle, setNoteTitle] = React.useState("");
    const [noteAgent, setNoteAgent] = React.useState("any");
    const [noteBody, setNoteBody] = React.useState("");
    const [fxMode, setFxMode] = React.useState<RemFxMode>(() => getRemFxMode());

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
                    <span>
                        Cost: <strong>${(cost?.totalCostUsd ?? 0).toFixed(4)}</strong>
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
                                    className="adehub-btn primary"
                                    disabled={!noteTitle.trim() || !noteBody.trim()}
                                    onClick={async () => {
                                        if (await model.saveNote(noteTitle, noteAgent, noteBody)) {
                                            setNoteTitle("");
                                            setNoteBody("");
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
                                placeholder="Reusable prompt or command workflow..."
                            />
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
            </div>
        </div>
    );
}
