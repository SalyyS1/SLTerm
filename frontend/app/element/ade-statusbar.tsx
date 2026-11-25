// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Slim Rem Aqua ADE Status Bar — gives 1-click access to ADE Hub, Git & Worktrees,
// live Dev-Server Port count, active Kanban tasks, OTLP cost, Rem Anime FX,
// Ctrl+Shift+P Command Palette, and GitHub Release update status.

import {
    cycleRemFxMode,
    cycleRemTheme,
    getRemFxMode,
    getRemTheme,
    RemFxMode,
    RemThemeName,
} from "@/app/element/rem-ambient";
import { triggerManualUpdateCheck } from "@/app/element/update-banner";
import { createBlock } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as React from "react";
import { useTranslation } from "react-i18next";
import "./ade-statusbar.scss";

const THEME_LABELS: Record<RemThemeName, string> = {
    "rem-aqua": "❄ Rem Aqua",
    "rem-twilight": "☾ Twilight",
    "glacier-mist": "☀ Glacier",
};

export const AdeStatusBar: React.FC = () => {
    const { t } = useTranslation();
    const [fx, setFx] = React.useState<RemFxMode>(() => getRemFxMode());
    const [theme, setTheme] = React.useState<RemThemeName>(() => getRemTheme());
    const [devPorts, setDevPorts] = React.useState(0);
    const [activeTasks, setActiveTasks] = React.useState(0);
    const [costUsd, setCostUsd] = React.useState(0);
    const [budgetExceeded, setBudgetExceeded] = React.useState(false);
    const [showKeys, setShowKeys] = React.useState(false);
    const [sidecarMb, setSidecarMb] = React.useState<number | null>(null);
    const [liveAgents, setLiveAgents] = React.useState(0);
    const [unreadEvents, setUnreadEvents] = React.useState(0);
    const [waitingAgents, setWaitingAgents] = React.useState(0);
    const [updateVer, setUpdateVer] = React.useState<string | null>(null);

    React.useEffect(() => {
        let mounted = true;
        const poll = async () => {
            try {
                const [ports, tasks, hub, upd, rt, act] = await Promise.all([
                    RpcApi.AdeListPortsCommand(TabRpcClient).catch(() => [] as AdePortData[]),
                    RpcApi.AdeListTasksCommand(TabRpcClient).catch(() => [] as AdeTaskData[]),
                    RpcApi.AdeGetHubSnapshotCommand(TabRpcClient, { limit: 1 }).catch(() => null),
                    RpcApi.AdeCheckUpdateCommand(TabRpcClient, { force: false }).catch(() => null),
                    RpcApi.AdeGetRuntimeStatsCommand(TabRpcClient).catch(() => null),
                    RpcApi.AdeGetActivityCommand(TabRpcClient).catch(() => null),
                ]);
                if (!mounted) return;
                setDevPorts((ports ?? []).filter((p) => p.isDevLikely).length);
                setActiveTasks((tasks ?? []).filter((t) => t.status === "in_progress").length);
                setCostUsd(hub?.cost?.totalCostUsd ?? 0);
                setBudgetExceeded(Boolean(hub?.cost?.budgetExceeded));
                setUpdateVer(upd?.updateAvailable ? upd.latestVersion : null);
                if (rt) {
                    setSidecarMb(rt.sidecarHeapMb);
                    setLiveAgents(rt.activeAgents);
                }
                if (act) {
                    setUnreadEvents(act.unreadCount ?? 0);
                    setWaitingAgents(act.waitingCount ?? 0);
                }
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
                    ❄ {t("ade.hubTitle", "ADE Hub")}
                </button>
                <button
                    className="ade-sb-pill"
                    onClick={() => createBlock({ meta: { view: "vcs" } })}
                    title="Open Git, Diff & Isolated Agent Worktrees"
                >
                    ⎇ {t("ade.gitWorktrees", "Git & Worktrees")}
                </button>
                <button
                    className="ade-sb-pill"
                    onClick={() => createBlock({ meta: { view: "adehub" } })}
                    title="Active Kanban tasks in progress"
                >
                    ⚡ {t("ade.tasks", "Tasks")}: {activeTasks}
                </button>
                <button
                    className={`ade-sb-pill ${waitingAgents > 0 ? "alert" : unreadEvents > 0 ? "pink" : ""}`}
                    onClick={() => createBlock({ meta: { view: "adehub" } })}
                    title={
                        waitingAgents > 0
                            ? `${waitingAgents} AI agent(s) waiting for your approval · ${unreadEvents} unread activity event(s)`
                            : `${unreadEvents} unread ADE activity event(s)`
                    }
                >
                    🔔 {waitingAgents > 0 ? `${waitingAgents} ${t("ade.waiting", "waiting")}` : unreadEvents}
                </button>
                <button
                    className="ade-sb-pill"
                    onClick={() => createBlock({ meta: { view: "adehub" } })}
                    title="Detected localhost dev servers"
                >
                    🌐 {t("ade.ports", "Ports")}: {devPorts}
                </button>
            </div>
            <div className="ade-sb-group">
                {sidecarMb !== null && (
                    <span
                        className="ade-sb-metric"
                        title="SLTerm Go sidecar heap RAM & active local AI CLI agents"
                    >
                        {sidecarMb.toFixed(1)} MB{liveAgents > 0 ? ` · ${liveAgents} AI` : ""}
                    </span>
                )}
                <span
                    className={`ade-sb-metric ${budgetExceeded ? "warn" : ""}`}
                    title={
                        budgetExceeded
                            ? "AI OTLP session cost exceeded configured Cost Guard budget!"
                            : "Embedded local OTLP session cost"
                    }
                >
                    {budgetExceeded ? "⚠ " : ""}${costUsd.toFixed(4)}
                </span>
                <button
                    className="ade-sb-pill aqua"
                    onClick={() => setTheme(cycleRemTheme())}
                    title="Switch Rem Workspace Theme (Rem Aqua / Rem Twilight / Glacier Mist)"
                >
                    {THEME_LABELS[theme]}
                </button>
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
                    {updateVer ? `⬆ v${updateVer}` : `↻ ${t("ade.updates", "Updates")}`}
                </button>
                <button
                    className="ade-sb-pill"
                    onClick={() => setShowKeys((v) => !v)}
                    title="Keyboard shortcuts cheatsheet"
                >
                    ⌨ {t("ade.keys", "Keys")}
                </button>
                <span className="ade-sb-kbd" title="Open Global ADE Command Palette">
                    Ctrl+Shift+P
                </span>
            </div>
            {showKeys && (
                <div className="ade-keys-popover" onClick={() => setShowKeys(false)}>
                    <div className="ade-keys-head">
                        <strong>❄ SLTerm ADE Shortcuts</strong>
                        <span>Click anywhere to close</span>
                    </div>
                    <div className="ade-keys-row">
                        <kbd>Ctrl+Shift+P</kbd>
                        <span>Global ADE Command Palette (Views, Agents, Ports, Workspaces)</span>
                    </div>
                    <div className="ade-keys-row">
                        <kbd>Ctrl+T</kbd>
                        <span>New Tab</span>
                    </div>
                    <div className="ade-keys-row">
                        <kbd>Ctrl+D / Ctrl+Shift+D</kbd>
                        <span>Split Pane Right / Down</span>
                    </div>
                    <div className="ade-keys-row">
                        <kbd>Ctrl+W</kbd>
                        <span>Close Active Block</span>
                    </div>
                    <div className="ade-keys-row">
                        <kbd>Ctrl+Shift+F</kbd>
                        <span>Find in Terminal</span>
                    </div>
                </div>
            )}
        </footer>
    );
};
