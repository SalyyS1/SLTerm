// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Global Rem Aqua ADE Command Palette (Ctrl+Shift+P / Cmd+Shift+P).
// Instant fuzzy jump to ADE Hub, Git & Worktrees, AI Tools, Agent Teams, CLI agents,
// Rem Aqua Ambient FX toggle, and live Localhost Dev-Server ports.

import { cycleRemFxMode, getRemFxMode } from "@/app/element/rem-ambient";
import { createBlock } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as React from "react";
import "./ade-palette.scss";

interface PaletteAction {
    id: string;
    icon: string;
    label: string;
    hint: string;
    run: () => void | Promise<void>;
}

export const AdeCommandPalette: React.FC = () => {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [activeIdx, setActiveIdx] = React.useState(0);
    const [devPorts, setDevPorts] = React.useState<AdePortData[]>([]);
    const [workspaces, setWorkspaces] = React.useState<AdeWorkspaceData[]>([]);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
                e.preventDefault();
                setOpen((prev) => !prev);
            } else if (e.key === "Escape") {
                setOpen(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    React.useEffect(() => {
        if (!open) return;
        setQuery("");
        setActiveIdx(0);
        setTimeout(() => inputRef.current?.focus(), 15);
        RpcApi.AdeListPortsCommand(TabRpcClient)
            .then((list) => setDevPorts((list ?? []).filter((p) => p.isDevLikely).slice(0, 6)))
            .catch(() => setDevPorts([]));
        RpcApi.AdeListWorkspacesCommand(TabRpcClient)
            .then((list) => setWorkspaces((list ?? []).slice(0, 6)))
            .catch(() => setWorkspaces([]));
    }, [open]);

    const actions = React.useMemo<PaletteAction[]>(() => {
        const base: PaletteAction[] = [
            {
                id: "open-adehub",
                icon: "✦",
                label: "Open ADE Hub (Sessions, Mini-Kanban Tasks, Port Radar & Cost HUD)",
                hint: "view:adehub",
                run: () => createBlock({ meta: { view: "adehub" } }),
            },
            {
                id: "open-vcs",
                icon: "⎇",
                label: "Open Git, Diff, Changelists & Isolated Agent Worktrees",
                hint: "view:vcs",
                run: () => createBlock({ meta: { view: "vcs" } }),
            },
            {
                id: "open-agentteams",
                icon: "◈",
                label: "Open Claude Multi-Agent Teams Board",
                hint: "view:agentteams",
                run: () => createBlock({ meta: { view: "agentteams" } }),
            },
            {
                id: "open-aitools",
                icon: "⚙",
                label: "Open AI Tools, Skills & MCP Inventory",
                hint: "view:aitools",
                run: () => createBlock({ meta: { view: "aitools" } }),
            },
            {
                id: "launch-claude",
                icon: "▶",
                label: "Launch Claude Code Session (New Terminal Block)",
                hint: "claude",
                run: () =>
                    createBlock({
                        meta: {
                            view: "term",
                            controller: "cmd",
                            cmd: "claude",
                            "cmd:interactive": true,
                            "cmd:login": true,
                        },
                    }),
            },
            {
                id: "launch-codex",
                icon: "▶",
                label: "Launch OpenAI Codex CLI Session (New Terminal Block)",
                hint: "codex",
                run: () =>
                    createBlock({
                        meta: {
                            view: "term",
                            controller: "cmd",
                            cmd: "codex",
                            "cmd:interactive": true,
                            "cmd:login": true,
                        },
                    }),
            },
            {
                id: "launch-term",
                icon: ">_",
                label: "New Local Shell Terminal Block",
                hint: "view:term",
                run: () => createBlock({ meta: { view: "term", controller: "shell" } }),
            },
            {
                id: "cycle-rem-fx",
                icon: "❄",
                label: `Cycle Rem Aqua Anime Ambient FX (Current: ${getRemFxMode()})`,
                hint: "Calm / Dreamy / Off",
                run: () => {
                    cycleRemFxMode();
                },
            },
        ];

        for (const ws of workspaces) {
            base.push({
                id: `ws-${ws.id}`,
                icon: "⚡",
                label: `Launch Workspace: ${ws.name} (${ws.layoutPreset})`,
                hint: ws.repoDir,
                run: async () => {
                    const agentCmd = ws.defaultAgent === "codex" ? "codex" : ws.defaultAgent === "gemini" ? "gemini" : "claude";
                    await createBlock({
                        meta: {
                            view: "term",
                            controller: ws.defaultAgent === "shell" ? "shell" : "cmd",
                            cmd: ws.defaultAgent === "shell" ? undefined : agentCmd,
                            "cmd:cwd": ws.repoDir,
                            "cmd:interactive": true,
                            "cmd:login": true,
                        },
                    });
                    await createBlock({ meta: { view: "vcs" } });
                },
            });
        }
        for (const p of devPorts) {
            base.push({
                id: `port-${p.port}`,
                icon: "🌐",
                label: `Preview Local Dev Server :${p.port}${p.process ? ` (${p.process})` : ""}`,
                hint: p.url,
                run: () => createBlock({ meta: { view: "web", url: p.url } }),
            });
        }
        return base;
    }, [devPorts, workspaces]);

    const filtered = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return actions;
        return actions.filter((a) => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q));
    }, [actions, query]);

    if (!open) {
        return null;
    }

    const execute = (act?: PaletteAction) => {
        if (!act) return;
        setOpen(false);
        void act.run();
    };

    return (
        <div className="ade-palette-backdrop" onClick={() => setOpen(false)}>
            <div className="ade-palette-box" onClick={(e) => e.stopPropagation()}>
                <div className="ade-palette-head">
                    <span className="ade-palette-sigil">❄</span>
                    <input
                        ref={inputRef}
                        className="ade-palette-input"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveIdx(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
                            } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setActiveIdx((i) => Math.max(i - 1, 0));
                            } else if (e.key === "Enter") {
                                e.preventDefault();
                                execute(filtered[activeIdx]);
                            }
                        }}
                        placeholder="SLTerm ADE Command Palette — search views, agents, Rem FX, or dev ports..."
                    />
                    <kbd className="ade-palette-kbd">ESC</kbd>
                </div>
                <div className="ade-palette-list">
                    {filtered.length === 0 ? (
                        <div className="ade-palette-empty">No matching ADE actions.</div>
                    ) : (
                        filtered.map((a, idx) => (
                            <button
                                key={a.id}
                                type="button"
                                className={`ade-palette-item ${idx === activeIdx ? "active" : ""}`}
                                onMouseEnter={() => setActiveIdx(idx)}
                                onClick={() => execute(a)}
                            >
                                <span className="ade-palette-ico">{a.icon}</span>
                                <span className="ade-palette-lbl">{a.label}</span>
                                <span className="ade-palette-hint">{a.hint}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
