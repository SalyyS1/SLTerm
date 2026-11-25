// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Slim Rem Aqua ADE Status Bar — gives 1-click access to ADE Hub, Git & Worktrees,
// live Dev-Server Port count, active Kanban tasks, OTLP cost, Rem Anime FX,
// Ctrl+Shift+P Command Palette, and GitHub Release update status.

import { cycleRemFxMode, getRemFxMode, RemFxMode } from "@/app/element/rem-ambient";
import { triggerManualUpdateCheck } from "@/app/element/update-banner";
import { createBlock } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as React from "react";
import "./ade-statusbar.scss";

export const AdeStatusBar: React.FC = () => {
    const [fx, setFx] = React.useState<RemFxMode>(() => getRemFxMode());
    const [devPorts, setDevPorts] = React.useState(0);
    const [activeTasks, setActiveTasks] = React.useState(0);
    const [costUsd, setCostUsd] = React.useState(0);
    const [updateVer, setUpdateVer] = React.useState<string | null>(null);

    React.useEffect(() => {
        let mounted = true;
        const poll = async () => {
            try {
                const [ports, tasks, hub, upd] = await Promise.all([
                    RpcApi.AdeListPortsCommand(TabRpcClient).catch(() => [] as AdePortData[]),
                    RpcApi.AdeListTasksCommand(TabRpcClient).catch(() => [] as AdeTaskData[]),
                    RpcApi.AdeGetHubSnapshotCommand(TabRpcClient, { limit: 1 }).catch(() => null),
                    RpcApi.AdeCheckUpdateCommand(TabRpcClient, { force: false }).catch(() => null),
                ]);
                if (!mounted) return;
                setDevPorts((ports ?? []).filter((p) => p.isDevLikely).length);
                setActiveTasks((tasks ?? []).filter((t) => t.status === "in_progress").length);
                setCostUsd(hub?.cost?.totalCostUsd ?? 0);
                setUpdateVer(upd?.updateAvailable ? upd.latestVersion : null);
            } catch {
                // ignore offline/startup hiccups
            }
        };
        const t0 = setTimeout(() => void poll(), 3500);
        const iv = setInterval(() => void poll(), 45000);
        return () => {
            mounted = false;
            clearTimeout(t0);
            clearInterval(iv);
        };
    }, []);

    return (
        <footer className="ade-statusbar" aria-label="SLTerm ADE Status Bar">
            <div className="ade-sb-group">
                <button
                    className="ade-sb-pill aqua"
                    onClick={() => createBlock({ meta: { view: "adehub" } })}
                    title="Open SLTerm ADE Hub"
                >
                    ❄ ADE Hub
                </button>
                <button
                    className="ade-sb-pill"
                    onClick={() => createBlock({ meta: { view: "vcs" } })}
                    title="Open Git, Diff & Isolated Agent Worktrees"
                >
                    ⎇ Git &amp; Worktrees
                </button>
                <button
                    className="ade-sb-pill"
                    onClick={() => createBlock({ meta: { view: "adehub" } })}
                    title="Active Kanban tasks in progress"
                >
                    ⚡ Tasks: {activeTasks}
                </button>
                <button
                    className="ade-sb-pill"
                    onClick={() => createBlock({ meta: { view: "adehub" } })}
                    title="Detected localhost dev servers"
                >
                    🌐 Dev Ports: {devPorts}
                </button>
            </div>
            <div className="ade-sb-group">
                <span className="ade-sb-metric" title="Embedded local OTLP session cost">
                    ${costUsd.toFixed(4)}
                </span>
                <button
                    className="ade-sb-pill pink"
                    onClick={() => setFx(cycleRemFxMode())}
                    title="Toggle Rem Aqua Anime Ambient FX (Calm / Dreamy / Off)"
                >
                    {fx === "off" ? "✧ FX: Off" : fx === "dreamy" ? "✦ FX: Dreamy" : "❄ FX: Calm"}
                </button>
                <button
                    className={`ade-sb-pill ${updateVer ? "update" : ""}`}
                    onClick={() => triggerManualUpdateCheck()}
                    title="Check GitHub Releases for SLTerm updates"
                >
                    {updateVer ? `⬆ Update v${updateVer}` : "↻ Updates"}
                </button>
                <span className="ade-sb-kbd" title="Open Global ADE Command Palette">
                    Ctrl+Shift+P
                </span>
            </div>
        </footer>
    );
};
