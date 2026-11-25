// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Rem Aqua AI-First ADE Studio — inspired by Stella ADE's clean conversational workspace:
//   - Left Sidebar: Rem Aqua Wibu Crest, + New AI Chat, live AI Sessions with pulsing
//     "Waiting on You" rose-pink dots, and Workspace/Project switcher.
//   - Center Primary Stage: Spacious AI Chat & Transcript Viewer (secret-redacted) +
//     Stella-style floating Composer with Agent Swapper (Claude/Codex/Gemini/Dual) &
//     1-click Chat <-> Raw CLI toggle.
//   - Right Dockable Stage: Live Web Product Preview (Desktop / Mobile 390px viewport +
//     auto-detected localhost dev ports), Visual Changelogs & Git Diffs, and Tasks/Doctor.
//   - Secondary Collapsible Bottom Drawer: Quick Terminal & Offline EN/VI Shell Assist
//     (tucked away by default so AI, Preview & Changelogs remain front and center!).

import {
    cycleRemFxMode,
    cycleRemTheme,
    getRemFxMode,
    getRemTheme,
    RemFxMode,
    RemThemeName,
} from "@/app/element/rem-ambient";
import { triggerManualUpdateCheck } from "@/app/element/update-banner";
import { createBlock, globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { StudioMessageBody } from "@/app/workspace/studio-markdown";
import { atom, useAtom } from "jotai";
import * as React from "react";
import { useTranslation } from "react-i18next";
import "./ade-studio.scss";

const STUDIO_STORAGE_KEY = "slterm-studio-mode";

function readInitialStudioMode(): boolean {
    try {
        const v = localStorage.getItem(STUDIO_STORAGE_KEY);
        if (v === "classic") return false;
    } catch {
        // default to AI Studio
    }
    return true;
}

export const adeStudioModeAtom = atom<boolean>(readInitialStudioMode());

export function setAdeStudioMode(enabled: boolean): void {
    globalStore.set(adeStudioModeAtom, enabled);
    try {
        localStorage.setItem(STUDIO_STORAGE_KEY, enabled ? "studio" : "classic");
    } catch {
        // ignore storage errors
    }
}

export function toggleAdeStudioMode(): void {
    setAdeStudioMode(!globalStore.get(adeStudioModeAtom));
}

type RightTab = "preview" | "changelogs" | "review" | "tasks";
type ComposerAgent = "claude" | "codex" | "gemini" | "dual";
type ReviewTag = "looks_good" | "clarify" | "needs_tests";

interface ReviewAnnotation {
    id: string;
    file: string;
    lineNum: number;
    excerpt: string;
    tag: ReviewTag;
    comment: string;
}

interface LocalChatMsg {
    id: string;
    role: "user" | "assistant";
    text: string;
    agent?: string;
    ts: number;
}

const STARTER_CARDS = [
    {
        icon: "🌐",
        title: "Build & Live-Preview Web UI",
        sub: "Design a responsive page, start the dev server, and inspect it live in the Preview pane.",
        prompt: "Build a clean, modern responsive UI component, start the local dev server, and verify there are zero TypeScript or console errors.",
    },
    {
        icon: "🐛",
        title: "Diagnose & Fix Bug (TDD)",
        sub: "Reproduce with a failing unit test first, apply the minimal clean fix, and re-verify.",
        prompt: "1. Write a minimal failing unit test reproducing the issue.\n2. Confirm the failure.\n3. Implement the cleanest fix.\n4. Re-run tests & build.",
    },
    {
        icon: "⎇",
        title: "Isolated Worktree Feature",
        sub: "Create an auto-hydrated Git worktree (.env + CLAUDE.md) so parallel agents never collide.",
        prompt: "Implement the new feature cleanly on an isolated Git worktree branch, run tests, and summarize the changelog diff.",
    },
    {
        icon: "🛡",
        title: "Security & Changelog Audit",
        sub: "Review staged diffs, SSH configs, and dependencies for leaked tokens or injection hazards.",
        prompt: "Audit the current repository diff for hardcoded secrets, command injection, path traversal, and summarize user-facing changelog highlights.",
    },
];

const THEME_LABELS: Record<RemThemeName, string> = {
    "rem-aqua": "❄ Rem Aqua",
    "rem-twilight": "☾ Twilight",
    "glacier-mist": "☀ Glacier",
};

function timeGreeting(isVi: boolean): string {
    const h = new Date().getHours();
    if (isVi) {
        if (h < 12) return "Chào buổi sáng — Rem Aqua AI Studio ❄";
        if (h < 18) return "Chào buổi chiều — Rem Aqua AI Studio ❄";
        return "Chào buổi tối — Rem Aqua AI Studio ❄";
    }
    if (h < 12) return "Good morning — Rem Aqua AI Studio ❄";
    if (h < 18) return "Good afternoon — Rem Aqua AI Studio ❄";
    return "Good evening — Rem Aqua AI Studio ❄";
}

const RemCrestSvg: React.FC<{ size?: number }> = ({ size = 28 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="studio-rem-crest"
        aria-hidden="true"
    >
        <defs>
            <linearGradient id="remAquaGrad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#bae6fd" />
                <stop offset="52%" stopColor="#5fd4f4" />
                <stop offset="100%" stopColor="#f48fb1" />
            </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="21" stroke="url(#remAquaGrad)" strokeWidth="1.4" strokeOpacity="0.52" />
        <path
            d="M24 5.5L27.4 16.2L38.5 16.2L29.6 22.8L33 33.8L24 27.1L15 33.8L18.4 22.8L9.5 16.2L20.6 16.2L24 5.5Z"
            fill="url(#remAquaGrad)"
            fillOpacity="0.22"
            stroke="url(#remAquaGrad)"
            strokeWidth="1.45"
            strokeLinejoin="round"
        />
        <path
            d="M17.5 36.2C20 38.6 28 38.6 30.5 36.2"
            stroke="#f48fb1"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeOpacity="0.88"
        />
        <circle cx="24" cy="22.8" r="3.4" fill="#f48fb1" />
        <circle cx="34.5" cy="11.5" r="1.4" fill="#e0f2fe" />
    </svg>
);

export const AdeStudio: React.FC = () => {
    const { i18n } = useTranslation();
    const isVi = (i18n.language || "").startsWith("vi");
    const [, setStudioMode] = useAtom(adeStudioModeAtom);

    // Core ADE data
    const [sessions, setSessions] = React.useState<AdeSessionData[]>([]);
    const [workspaces, setWorkspaces] = React.useState<AdeWorkspaceData[]>([]);
    const [ports, setPorts] = React.useState<AdePortData[]>([]);
    const [tasks, setTasks] = React.useState<AdeTaskData[]>([]);
    const [commits, setCommits] = React.useState<VcsCommitEntryData[]>([]);
    const [vcsStatus, setVcsStatus] = React.useState<VcsStatusData | null>(null);
    const [project, setProject] = React.useState<AdeProjectReportData | null>(null);
    const [costUsd, setCostUsd] = React.useState(0);
    const [sidecarMb, setSidecarMb] = React.useState<number | null>(null);

    // UI selection state
    const [sessionQuery, setSessionQuery] = React.useState("");
    const [activeSession, setActiveSession] = React.useState<AdeSessionData | null>(null);
    const [sessionPreview, setSessionPreview] = React.useState<AdeSessionPreviewData | null>(null);
    const [localMsgs, setLocalMsgs] = React.useState<LocalChatMsg[]>([]);
    const [activeRepoDir, setActiveRepoDir] = React.useState(".");
    const [repoPathInput, setRepoPathInput] = React.useState("");

    // Composer state
    const [composerText, setComposerText] = React.useState("");
    const [promptQueue, setPromptQueue] = React.useState<string[]>([]);
    const [composerAgent, setComposerAgent] = React.useState<ComposerAgent>("claude");
    const [composerEffort, setComposerEffort] = React.useState<"balanced" | "deep" | "fast">("balanced");
    const [useWorktree, setUseWorktree] = React.useState(false);
    const [riskPreview, setRiskPreview] = React.useState<AdeCommandRiskData | null>(null);
    const [notice, setNotice] = React.useState<string | null>(null);

    // Stella-style Plan / Spec Review Annotations state
    const [reviewFileName, setReviewFileName] = React.useState("CLAUDE.md");
    const [reviewContent, setReviewContent] = React.useState("");
    const [annotations, setAnnotations] = React.useState<ReviewAnnotation[]>([]);

    // Right inspector & secondary drawer state
    const [rightOpen, setRightOpen] = React.useState(true);
    const [rightTab, setRightTab] = React.useState<RightTab>("preview");
    const [previewUrl, setPreviewUrl] = React.useState("");
    const [previewFrameKey, setPreviewFrameKey] = React.useState(0);
    const [previewViewport, setPreviewViewport] = React.useState<"desktop" | "tablet" | "mobile">("desktop");
    const [selectedFileDiffPath, setSelectedFileDiffPath] = React.useState<string | null>(null);
    const [selectedFileDiff, setSelectedFileDiff] = React.useState("");
    const [selectedCommitSha, setSelectedCommitSha] = React.useState<string | null>(null);
    const [selectedCommitDiff, setSelectedCommitDiff] = React.useState("");
    const [commitDraft, setCommitDraft] = React.useState("");
    const [newTaskTitle, setNewTaskTitle] = React.useState("");

    // Secondary terminal drawer (collapsed by default — AI is the focus!)
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const [nltQuery, setNltQuery] = React.useState("");
    const [nltSuggestions, setNltSuggestions] = React.useState<AdeNltSuggestionData[]>([]);

    // Theme / FX controls
    const [theme, setTheme] = React.useState<RemThemeName>(() => getRemTheme());
    const [fx, setFx] = React.useState<RemFxMode>(() => getRemFxMode());

    const showToast = React.useCallback((msg: string) => {
        setNotice(msg);
        setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 4200);
    }, []);

    const refreshAll = React.useCallback(
        async (dirOverride?: string) => {
            const targetDir = (dirOverride ?? activeRepoDir).trim() || ".";
            try {
                const [hub, wsList, portList, taskList, rt, st, logList, proj] = await Promise.all([
                    RpcApi.AdeGetHubSnapshotCommand(TabRpcClient, {
                        query: sessionQuery,
                        agentFilter: "all",
                        limit: 40,
                    }).catch(() => null),
                    RpcApi.AdeListWorkspacesCommand(TabRpcClient).catch(() => [] as AdeWorkspaceData[]),
                    RpcApi.AdeListPortsCommand(TabRpcClient).catch(() => [] as AdePortData[]),
                    RpcApi.AdeListTasksCommand(TabRpcClient).catch(() => [] as AdeTaskData[]),
                    RpcApi.AdeGetRuntimeStatsCommand(TabRpcClient).catch(() => null),
                    RpcApi.VcsGetStatusCommand(TabRpcClient, { dir: targetDir }).catch(() => null),
                    RpcApi.VcsGetLogCommand(TabRpcClient, { dir: targetDir, limit: 20 }).catch(
                        () => [] as VcsCommitEntryData[]
                    ),
                    RpcApi.AdeInspectProjectCommand(TabRpcClient, { dir: targetDir }).catch(() => null),
                ]);
                if (hub) {
                    setSessions(hub.sessions ?? []);
                    setCostUsd(hub.cost?.totalCostUsd ?? 0);
                }
                setWorkspaces(wsList ?? []);
                const safePorts = portList ?? [];
                setPorts(safePorts);
                setTasks(taskList ?? []);
                if (rt) setSidecarMb(rt.sidecarHeapMb);
                if (st) {
                    setVcsStatus(st);
                    if (st.repoRoot && targetDir === ".") {
                        setActiveRepoDir(st.repoRoot);
                    }
                }
                setCommits(logList ?? []);
                if (proj) setProject(proj);

                // Auto-pick first detected localhost dev server for Live Product Preview if none set yet
                setPreviewUrl((cur) => {
                    if (cur) return cur;
                    const dev = safePorts.find((p) => p.isDevLikely);
                    return dev ? dev.url : "";
                });
            } catch {
                // ignore startup hiccups
            }
        },
        [activeRepoDir, sessionQuery]
    );

    React.useEffect(() => {
        void refreshAll();
        const iv = setInterval(() => void refreshAll(), 25000);
        return () => clearInterval(iv);
    }, [refreshAll]);

    // Global hotkey Ctrl+Shift+A to toggle AI Studio <-> Classic Terminal
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
                e.preventDefault();
                toggleAdeStudioMode();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const selectSession = async (s: AdeSessionData) => {
        setActiveSession(s);
        if (s.cwd) {
            setActiveRepoDir(s.cwd);
            void refreshAll(s.cwd);
        }
        try {
            const prev = await RpcApi.AdePreviewSessionCommand(TabRpcClient, {
                agent: s.agent,
                sessionId: s.id,
            });
            setSessionPreview(prev);
        } catch {
            setSessionPreview(null);
        }
    };

    const launchLiveCliForSession = async (s?: AdeSessionData | null) => {
        if (s) {
            const isClaude = s.agent === "claude";
            await createBlock({
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: isClaude ? "claude" : "codex",
                    "cmd:args": isClaude ? [`--resume=${s.id}`] : ["resume", s.id],
                    "cmd:cwd": s.cwd || activeRepoDir || undefined,
                    "cmd:interactive": true,
                    "cmd:login": true,
                },
            });
        } else {
            const cmd = composerAgent === "codex" ? "codex" : composerAgent === "gemini" ? "gemini" : "claude";
            await createBlock({
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd,
                    "cmd:cwd": activeRepoDir && activeRepoDir !== "." ? activeRepoDir : undefined,
                    "cmd:interactive": true,
                    "cmd:login": true,
                },
            });
        }
        setStudioMode(false);
    };

    const loadReviewFile = React.useCallback(
        async (fname: string, dirArg?: string) => {
            setReviewFileName(fname);
            try {
                const res = await RpcApi.AdeReadContextFileCommand(TabRpcClient, {
                    dir: (dirArg ?? activeRepoDir).trim() || ".",
                    name: fname,
                });
                setReviewContent(res?.content || "");
            } catch {
                setReviewContent("");
            }
        },
        [activeRepoDir]
    );

    React.useEffect(() => {
        if (rightTab === "review" && !reviewContent) {
            void loadReviewFile(reviewFileName);
        }
    }, [rightTab, reviewContent, reviewFileName, loadReviewFile]);

    const addAnnotation = (lineNum: number, excerpt: string, tag: ReviewTag) => {
        const note = window.prompt(`Optional note for line ${lineNum} (${tag.replace("_", " ")}):`) ?? "";
        setAnnotations((prev) => [
            ...prev,
            {
                id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                file: reviewFileName,
                lineNum,
                excerpt: excerpt.slice(0, 90),
                tag,
                comment: note.trim(),
            },
        ]);
        showToast(`✨ Annotated ${reviewFileName}:${lineNum} (${tag.replace("_", " ")})`);
    };

    const sendAnnotationsToComposer = () => {
        if (annotations.length === 0) return;
        const lines = annotations.map((a, i) => {
            const label = a.tag === "looks_good" ? "Looks good" : a.tag === "clarify" ? "Clarify" : "Needs tests";
            return `${i + 1}. [${label}] ${a.file}:${a.lineNum} — "${a.excerpt}"${a.comment ? ` -> ${a.comment}` : ""}`;
        });
        const compiled = `Please address these review annotations:\n${lines.join("\n")}`;
        setComposerText((cur) => (cur.trim() ? `${cur.trim()}\n\n${compiled}` : compiled));
        setAnnotations([]);
        showToast(`✦ Sent ${lines.length} numbered feedback annotation(s) into Composer`);
    };

    const handleSendPrompt = async (overridePrompt?: string) => {
        const rawPrompt = (overridePrompt ?? composerText).trim();
        if (!rawPrompt) return;
        const effortPrefix =
            composerEffort === "deep"
                ? "[Deep Think: analyze edge cases, architecture & write tests before editing]\n"
                : composerEffort === "fast"
                ? "[Fast Ship: implement the smallest clean diff and verify]\n"
                : "";
        const prompt = effortPrefix + rawPrompt;

        // Command Firewall check before dispatching
        const risk = await RpcApi.AdeCheckCommandRiskCommand(TabRpcClient, {
            command: prompt,
            policy: "balanced",
        }).catch(() => null);
        if (risk && risk.verdict === "block") {
            setRiskPreview(risk);
            showToast(`🛡 Blocked by Command Firewall (Risk ${risk.riskScore}/100)`);
            return;
        }
        setRiskPreview(null);

        // Append immediately to conversational timeline
        setLocalMsgs((prev) => [
            ...prev,
            { id: `u-${Date.now()}`, role: "user", text: prompt, agent: composerAgent, ts: Date.now() },
        ]);
        setComposerText("");

        let launchDir = activeRepoDir && activeRepoDir !== "." ? activeRepoDir : "";
        if (useWorktree && launchDir) {
            const slug = prompt
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 28);
            const branch = `feat/${slug || "ai-task"}`;
            try {
                const wt = await RpcApi.VcsCreateWorktreeCommand(TabRpcClient, { dir: launchDir, branch });
                launchDir = wt.path;
                showToast(`⎇ Created isolated worktree ${wt.branch}`);
            } catch (err) {
                showToast(`Worktree skipped: ${String(err)}`);
            }
        }

        try {
            await navigator.clipboard?.writeText(prompt);
        } catch {
            // ignore clipboard failure
        }

        const agentsToRun = composerAgent === "dual" ? ["claude", "codex"] : [composerAgent];
        for (const ag of agentsToRun) {
            await createBlock({
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: ag,
                    "cmd:cwd": launchDir || undefined,
                    "cmd:interactive": true,
                    "cmd:login": true,
                },
            });
        }
        setLocalMsgs((prev) => [
            ...prev,
            {
                id: `a-${Date.now() + 1}`,
                role: "assistant",
                agent: composerAgent,
                text: isVi
                    ? `Đã khởi chạy ${agentsToRun.join(" + ")} ${launchDir ? `tại ${launchDir} ` : ""}và sao chép prompt vào clipboard. Nhấn "Raw CLI" ở góc trên nếu bạn muốn xem trực tiếp terminal.`
                    : `Launched ${agentsToRun.join(" + ")} ${launchDir ? `in ${launchDir} ` : ""}and copied your prompt to clipboard. Click "Raw CLI" above anytime to interact with the live PTY.`,
                ts: Date.now() + 1,
            },
        ]);
        showToast(`✦ Launched ${agentsToRun.join(" + ")} · prompt ready in clipboard`);
    };

    const inspectCommit = async (sha: string) => {
        setSelectedCommitSha(sha);
        try {
            const res = await RpcApi.VcsShowCommitCommand(TabRpcClient, { dir: activeRepoDir, hash: sha });
            setSelectedCommitDiff(res?.diff || "(no diff)");
        } catch (err) {
            setSelectedCommitDiff(String(err));
        }
    };

    const devPorts = ports.filter((p) => p.isDevLikely);
    const waitingTotal = sessions.filter((s) => s.status === "waiting_approval").length;

    return (
        <div className="ade-studio-shell">
            {/* ===== LEFT SIDEBAR: Rem Crest + AI Sessions + Workspaces ===== */}
            <aside className="studio-sidebar">
                <div className="studio-brand">
                    <div className="studio-brand-left">
                        <RemCrestSvg size={30} />
                        <div>
                            <div className="studio-brand-name">
                                SLTerm <span className="studio-ver-chip">Rem ADE</span>
                            </div>
                            <div className="studio-brand-sub">
                                {sidecarMb !== null ? `${sidecarMb.toFixed(1)} MB · ` : ""}
                                {waitingTotal > 0 ? `🔔 ${waitingTotal} waiting` : "AI-First Workspace"}
                            </div>
                        </div>
                    </div>
                    <button
                        className="studio-icon-btn"
                        title={isVi ? "Chuyển sang giao diện Classic Terminal (Ctrl+Shift+A)" : "Switch to Classic Terminal Blocks (Ctrl+Shift+A)"}
                        onClick={() => setStudioMode(false)}
                    >
                        ⊞
                    </button>
                </div>

                <button
                    className="studio-new-chat-btn"
                    onClick={() => {
                        setActiveSession(null);
                        setSessionPreview(null);
                        setLocalMsgs([]);
                    }}
                >
                    <span>✦</span> {isVi ? "Cuộc trò chuyện AI mới" : "New AI Chat"}
                </button>

                <div className="studio-search-wrap">
                    <input
                        className="studio-search"
                        value={sessionQuery}
                        onChange={(e) => setSessionQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void refreshAll();
                        }}
                        placeholder={isVi ? "Tìm phiên Claude / Codex…" : "Search Claude / Codex chats…"}
                    />
                </div>

                <div className="studio-side-section">
                    <div className="studio-side-label">
                        <span>{isVi ? "Phiên AI gần đây" : "AI Conversations"}</span>
                        <span className="studio-count">{sessions.length}</span>
                    </div>
                    <div className="studio-session-list">
                        {sessions.length === 0 ? (
                            <div className="studio-empty-sm">
                                {isVi
                                    ? "Chưa có phiên nào. Gõ prompt bên phải để bắt đầu cùng Claude/Codex!"
                                    : "No past chats yet. Send a prompt to launch Claude or Codex!"}
                            </div>
                        ) : (
                            sessions.map((s) => {
                                const isActive = activeSession?.id === s.id;
                                const folderName = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() : "";
                                return (
                                    <button
                                        key={`${s.agent}:${s.id}`}
                                        className={`studio-session-item ${isActive ? "active" : ""}`}
                                        onClick={() => void selectSession(s)}
                                    >
                                        <span className={`studio-dot ${s.status}`} title={s.status} />
                                        <div className="studio-session-copy">
                                            <div className="studio-session-title">{s.title}</div>
                                            <div className="studio-session-meta">
                                                <span className="studio-agent-mini">{s.agent}</span>
                                                {folderName && <span>{folderName}</span>}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="studio-side-workspaces">
                    <div className="studio-side-label">
                        <span>{isVi ? "Dự án & Thư mục" : "Projects & Folder"}</span>
                        <span className="studio-count">{workspaces.length}</span>
                    </div>
                    <div className="studio-drawer-search">
                        <input
                            className="studio-search"
                            value={repoPathInput}
                            onChange={(e) => setRepoPathInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && repoPathInput.trim()) {
                                    setActiveRepoDir(repoPathInput.trim());
                                    void refreshAll(repoPathInput.trim());
                                }
                            }}
                            placeholder={isVi ? "Mở thư mục (C:\\work\\app)…" : "Open folder (C:\\work\\app)…"}
                        />
                        <button
                            className="studio-icon-btn"
                            title={isVi ? "Ghim thư mục hiện tại vào Dự án" : "Pin folder as saved workspace"}
                            disabled={!repoPathInput.trim() && activeRepoDir === "."}
                            onClick={async () => {
                                const target = (repoPathInput.trim() || activeRepoDir).trim();
                                if (!target || target === ".") return;
                                const name = target.split(/[\\/]/).filter(Boolean).pop() || "Project";
                                await RpcApi.AdeSaveWorkspaceCommand(TabRpcClient, {
                                    name,
                                    repoDir: target,
                                    defaultAgent: composerAgent === "dual" ? "claude" : composerAgent,
                                    layoutPreset: "full-ade",
                                    color: "aqua",
                                });
                                setActiveRepoDir(target);
                                setRepoPathInput("");
                                showToast(`📌 Pinned project "${name}"`);
                                await refreshAll(target);
                            }}
                        >
                            📌
                        </button>
                    </div>
                    {workspaces.length > 0 && (
                        <div className="studio-ws-chips">
                            {workspaces.slice(0, 6).map((w) => (
                                <button
                                    key={w.id}
                                    className={`studio-ws-chip ${activeRepoDir === w.repoDir ? "active" : ""}`}
                                    title={w.repoDir}
                                    onClick={() => {
                                        setActiveRepoDir(w.repoDir);
                                        if (w.devPort) setPreviewUrl(`http://127.0.0.1:${w.devPort}`);
                                        void refreshAll(w.repoDir);
                                    }}
                                >
                                    ❄ {w.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="studio-side-foot">
                    <button
                        className="studio-foot-pill aqua"
                        onClick={() => setTheme(cycleRemTheme())}
                        title="Switch Rem Theme"
                    >
                        {THEME_LABELS[theme]}
                    </button>
                    <button
                        className="studio-foot-pill pink"
                        onClick={() => setFx(cycleRemFxMode())}
                        title="Toggle Rem Anime Ambient FX"
                    >
                        {fx === "off" ? "✧ FX Off" : fx === "dreamy" ? "✦ Dreamy" : "❄ Calm"}
                    </button>
                    <button
                        className="studio-foot-pill"
                        onClick={() => triggerManualUpdateCheck()}
                        title="Check & Auto-Update SLTerm"
                    >
                        ↻
                    </button>
                </div>
            </aside>

            {/* ===== CENTER PRIMARY STAGE: AI Chat + Composer + Collapsible Secondary Terminal ===== */}
            <main className="studio-main">
                <header className="studio-topbar">
                    <div className="studio-topbar-left">
                        <strong className="studio-conv-title">
                            {activeSession
                                ? activeSession.title
                                : isVi
                                ? "✦ Phòng làm việc AI Rem Aqua"
                                : "✦ Rem Aqua AI Studio"}
                        </strong>
                        {vcsStatus && (
                            <span className="studio-pill aqua">
                                ⎇ {vcsStatus.branch}
                                {vcsStatus.changes?.length ? ` · ${vcsStatus.changes.length}Δ` : ""}
                            </span>
                        )}
                        <span className="studio-pill mint" title="Embedded OTLP AI Session Cost">
                            ${costUsd.toFixed(4)}
                        </span>
                    </div>

                    <div className="studio-topbar-right">
                        <div className="studio-seg">
                            <button className="studio-seg-btn active" title="Conversational AI Studio View">
                                💬 {isVi ? "AI Chat" : "AI Chat"}
                            </button>
                            <button
                                className="studio-seg-btn"
                                title={isVi ? "Mở CLI trực tiếp cho phiên này" : "Switch to Live Raw CLI PTY"}
                                onClick={() => void launchLiveCliForSession(activeSession)}
                            >
                                &gt;_ {isVi ? "Raw CLI" : "Raw CLI"}
                            </button>
                        </div>

                        <button
                            className={`studio-top-btn ${drawerOpen ? "active" : ""}`}
                            onClick={() => setDrawerOpen((v) => !v)}
                            title={isVi ? "Ngăn kéo Terminal phụ & NLT Shell Assist" : "Toggle Secondary Terminal & Shell Drawer"}
                        >
                            &gt;_ {isVi ? "Terminal phụ" : "Drawer"}
                        </button>
                        <button
                            className={`studio-top-btn ${rightOpen ? "active" : ""}`}
                            onClick={() => setRightOpen((v) => !v)}
                            title={isVi ? "Ẩn/Hiện Preview & Changelogs" : "Toggle Product Preview & Changelogs"}
                        >
                            🌐 {isVi ? "Preview & Log" : "Inspector"}
                        </button>
                    </div>
                </header>

                {notice && <div className="studio-toast-bar">{notice}</div>}

                {/* Center Scrollable Conversation Feed */}
                <div className="studio-chat-scroll">
                    <div className="studio-chat-container">
                        {!activeSession && localMsgs.length === 0 ? (
                            <div className="studio-welcome">
                                <div className="studio-welcome-emblem">
                                    <RemCrestSvg size={64} />
                                </div>
                                <h1 className="studio-welcome-title">{timeGreeting(isVi)}</h1>
                                <p className="studio-welcome-sub">
                                    {isVi
                                        ? "Tập trung hoàn toàn vào AI, xem trước sản phẩm Web trực tiếp và theo dõi Changelogs — Terminal chỉ mở khi bạn cần."
                                        : "AI-first agent workspace with live Web Product Preview & visual Changelogs — terminal stays cleanly tucked away until needed."}
                                </p>

                                <div className="studio-starter-grid">
                                    {STARTER_CARDS.map((card) => (
                                        <button
                                            key={card.title}
                                            className="studio-starter-card"
                                            onClick={() => setComposerText(card.prompt)}
                                        >
                                            <div className="studio-starter-head">
                                                <span className="studio-starter-ico">{card.icon}</span>
                                                <strong>{card.title}</strong>
                                            </div>
                                            <p>{card.sub}</p>
                                        </button>
                                    ))}
                                </div>

                                {project && (
                                    <div className="studio-doctor-ribbon">
                                        <span className="studio-doctor-lbl">🩺 {project.name}</span>
                                        {(project.stacks ?? []).map((st) => (
                                            <span key={st} className="studio-pill aqua">
                                                {st}
                                            </span>
                                        ))}
                                        {(project.commands ?? []).slice(0, 4).map((cmd) => (
                                            <button
                                                key={cmd.label}
                                                className="studio-mini-run"
                                                onClick={async () => {
                                                    const parts = cmd.command.trim().split(/\s+/);
                                                    await createBlock({
                                                        meta: {
                                                            view: "term",
                                                            controller: "cmd",
                                                            cmd: parts[0],
                                                            "cmd:args": parts.slice(1),
                                                            "cmd:cwd": project.dir,
                                                            "cmd:interactive": true,
                                                            "cmd:login": true,
                                                        },
                                                    });
                                                    showToast(`▶ Started ${cmd.label} in background terminal`);
                                                }}
                                            >
                                                ▶ {cmd.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="studio-thread">
                                {activeSession && (
                                    <div className="studio-session-banner">
                                        <div>
                                            <span className="studio-pill aqua">{activeSession.agent}</span>{" "}
                                            <strong>{activeSession.title}</strong>
                                            {activeSession.cwd && (
                                                <span className="studio-banner-cwd"> · {activeSession.cwd}</span>
                                            )}
                                        </div>
                                        <div className="studio-banner-actions">
                                            {sessionPreview?.handoffMarkdown && (
                                                <button
                                                    className="studio-mini-btn"
                                                    onClick={() => {
                                                        navigator.clipboard?.writeText(sessionPreview.handoffMarkdown);
                                                        showToast("📋 Copied redacted Claude ↔ Codex handoff!");
                                                    }}
                                                >
                                                    📋 Handoff
                                                </button>
                                            )}
                                            <button
                                                className="studio-mini-btn"
                                                onClick={async () => {
                                                    const forked = await RpcApi.AdeForkSessionCommand(TabRpcClient, {
                                                        agent: activeSession.agent,
                                                        sessionId: activeSession.id,
                                                    });
                                                    showToast(`⑂ Forked → ${forked.id.slice(0, 8)}`);
                                                    await refreshAll();
                                                }}
                                            >
                                                ⑂ Fork
                                            </button>
                                            <button
                                                className="studio-mini-btn primary"
                                                onClick={() => void launchLiveCliForSession(activeSession)}
                                            >
                                                ▶ Resume Live
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {(sessionPreview?.messages ?? []).map((m, idx) => (
                                    <div key={`prev-${idx}`} className={`studio-msg ${m.role}`}>
                                        {m.role === "assistant" && (
                                            <div className="studio-msg-avatar">
                                                <RemCrestSvg size={22} />
                                            </div>
                                        )}
                                        <div className="studio-msg-bubble">
                                            <div className="studio-msg-head">
                                                <span>
                                                    {m.role === "user"
                                                        ? isVi
                                                            ? "Bạn"
                                                            : "You"
                                                        : `${activeSession?.agent || "AI"} · Redacted`}
                                                </span>
                                            </div>
                                            <div className="studio-msg-text">
                                                <StudioMessageBody
                                                    text={m.text}
                                                    onCopy={() => showToast("Copied code block to clipboard")}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {localMsgs.map((m) => (
                                    <div key={m.id} className={`studio-msg ${m.role}`}>
                                        {m.role === "assistant" && (
                                            <div className="studio-msg-avatar">
                                                <RemCrestSvg size={22} />
                                            </div>
                                        )}
                                        <div className="studio-msg-bubble">
                                            <div className="studio-msg-head">
                                                <span>
                                                    {m.role === "user"
                                                        ? isVi
                                                            ? "Bạn"
                                                            : "You"
                                                        : `SLTerm · ${m.agent || "AI"}`}
                                                </span>
                                            </div>
                                            <div className="studio-msg-text">
                                                <StudioMessageBody
                                                    text={m.text}
                                                    onCopy={() => showToast("Copied code block to clipboard")}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Stella-Style Floating Composer + Prompt Queue */}
                <div className="studio-composer-dock">
                    {promptQueue.length > 0 && (
                        <div className="studio-queue-strip">
                            <span className="studio-queue-lbl">⏳ Queued ({promptQueue.length}):</span>
                            {promptQueue.map((qp, qi) => (
                                <span key={qi} className="studio-queue-pill">
                                    <span title={qp}>{qp.slice(0, 42)}{qp.length > 42 ? "…" : ""}</span>
                                    <button
                                        title="Send now"
                                        onClick={() => {
                                            setPromptQueue((prev) => prev.filter((_, idx) => idx !== qi));
                                            void handleSendPrompt(qp);
                                        }}
                                    >
                                        ▶
                                    </button>
                                    <button
                                        title="Remove from queue"
                                        onClick={() => setPromptQueue((prev) => prev.filter((_, idx) => idx !== qi))}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="studio-composer-card">
                        {riskPreview && (
                            <div className="studio-risk-strip">
                                <strong>🛡 Command Firewall: {riskPreview.verdict.toUpperCase()}</strong> (Risk{" "}
                                {riskPreview.riskScore}/100) — {riskPreview.findings?.[0]?.message || "Safe"}
                            </div>
                        )}
                        <textarea
                            className="studio-composer-input"
                            rows={2}
                            value={composerText}
                            onChange={(e) => setComposerText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSendPrompt();
                                }
                            }}
                            placeholder={
                                isVi
                                    ? "Nhắn Claude, Codex hoặc Gemini để xây dựng, sửa lỗi, xem trước web… (Enter gửi · Shift+Enter xuống dòng)"
                                    : "Message Claude, Codex, or Gemini to build, debug, or preview… (Enter to launch · Shift+Enter newline)"
                            }
                        />
                        <div className="studio-composer-bar">
                            <div className="studio-composer-pills">
                                <select
                                    className="studio-agent-select"
                                    value={composerAgent}
                                    onChange={(e) => setComposerAgent(e.target.value as ComposerAgent)}
                                    title="Swap AI agent on the fly"
                                >
                                    <option value="claude">✦ Claude Code</option>
                                    <option value="codex">⚡ OpenAI Codex</option>
                                    <option value="gemini">◈ Gemini CLI</option>
                                    <option value="dual">🚀 Dual (Claude + Codex)</option>
                                </select>
                                <select
                                    className="studio-agent-select"
                                    value={composerEffort}
                                    onChange={(e) => setComposerEffort(e.target.value as "balanced" | "deep" | "fast")}
                                    title="Reasoning effort hint"
                                >
                                    <option value="balanced">❄ Balanced</option>
                                    <option value="deep">🧠 Deep Think</option>
                                    <option value="fast">⚡ Fast Ship</option>
                                </select>
                                <label className={`studio-toggle-pill ${useWorktree ? "on" : ""}`}>
                                    <input
                                        type="checkbox"
                                        checked={useWorktree}
                                        onChange={(e) => setUseWorktree(e.target.checked)}
                                    />
                                    ⎇ {isVi ? "Worktree riêng" : "Isolated Worktree"}
                                </label>
                                <button
                                    className="studio-mini-btn"
                                    disabled={!composerText.trim()}
                                    onClick={async () => {
                                        const r = await RpcApi.AdeCheckCommandRiskCommand(TabRpcClient, {
                                            command: composerText,
                                            policy: "balanced",
                                        }).catch(() => null);
                                        setRiskPreview(r);
                                    }}
                                >
                                    🛡 Audit
                                </button>
                            </div>
                            <div className="studio-banner-actions">
                                <button
                                    className="studio-mini-btn"
                                    disabled={!composerText.trim()}
                                    title="Queue this prompt to run next without interrupting current work"
                                    onClick={() => {
                                        if (!composerText.trim()) return;
                                        setPromptQueue((prev) => [...prev, composerText.trim()]);
                                        setComposerText("");
                                        showToast("⏳ Added prompt to follow-up queue");
                                    }}
                                >
                                    + Queue
                                </button>
                                <button
                                    className="studio-send-btn"
                                    disabled={!composerText.trim()}
                                    onClick={() => void handleSendPrompt()}
                                >
                                    {isVi ? "Gửi AI ↵" : "Send ↵"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Collapsible Secondary Terminal & Offline Shell Drawer */}
                {drawerOpen && (
                    <section className="studio-term-drawer">
                        <div className="studio-drawer-head">
                            <strong>&gt;_ {isVi ? "Ngăn kéo Terminal phụ & Trợ lý lệnh Offline (EN/VI)" : "Secondary Terminal & Offline Shell Assist"}</strong>
                            <div className="studio-drawer-actions">
                                <button
                                    className="studio-mini-btn"
                                    onClick={async () => {
                                        await createBlock({
                                            meta: { view: "term", controller: "shell", "cmd:cwd": activeRepoDir || undefined },
                                        });
                                        setStudioMode(false);
                                    }}
                                >
                                    + New Shell
                                </button>
                                <button
                                    className="studio-mini-btn"
                                    onClick={async () => {
                                        await createBlock({ meta: { view: "vcs" } });
                                        setStudioMode(false);
                                    }}
                                >
                                    ⎇ Full Git
                                </button>
                                <button
                                    className="studio-mini-btn"
                                    onClick={async () => {
                                        await createBlock({ meta: { view: "adehub" } });
                                        setStudioMode(false);
                                    }}
                                >
                                    ❄ Full ADE Hub
                                </button>
                                <button className="studio-mini-btn" onClick={() => setDrawerOpen(false)}>
                                    ×
                                </button>
                            </div>
                        </div>
                        <div className="studio-drawer-body">
                            <div className="studio-drawer-search">
                                <input
                                    className="studio-search"
                                    value={nltQuery}
                                    onChange={(e) => setNltQuery(e.target.value)}
                                    onKeyDown={async (e) => {
                                        if (e.key === "Enter") {
                                            const res = await RpcApi.AdeSuggestCommandsCommand(TabRpcClient, {
                                                query: nltQuery,
                                                limit: 4,
                                            }).catch(() => []);
                                            setNltSuggestions(res ?? []);
                                        }
                                    }}
                                    placeholder={
                                        isVi
                                            ? "Gõ yêu cầu tiếng Việt/Anh (vd: 'tìm port 5173', 'git undo 2 commits', 'dọn docker') rồi Enter…"
                                            : "Type natural intent (e.g. 'find port 5173', 'git undo', 'docker prune') & press Enter…"
                                    }
                                />
                                <button
                                    className="studio-mini-btn primary"
                                    onClick={async () => {
                                        const res = await RpcApi.AdeSuggestCommandsCommand(TabRpcClient, {
                                            query: nltQuery,
                                            limit: 4,
                                        }).catch(() => []);
                                        setNltSuggestions(res ?? []);
                                    }}
                                >
                                    ✨ Suggest
                                </button>
                            </div>
                            {nltSuggestions.length > 0 && (
                                <div className="studio-nlt-row">
                                    {nltSuggestions.map((s) => (
                                        <div key={s.id} className="studio-nlt-chip">
                                            <div>
                                                <strong>{s.title}</strong>
                                                <code>{s.recommended}</code>
                                            </div>
                                            <button
                                                className="studio-mini-btn"
                                                onClick={() => {
                                                    navigator.clipboard?.writeText(s.recommended);
                                                    showToast(`Copied: ${s.recommended}`);
                                                }}
                                            >
                                                Copy
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </main>

            {/* ===== RIGHT DOCKABLE STAGE: Live Web Product Preview + Changelogs & Diffs + Tasks ===== */}
            {rightOpen && (
                <aside className="studio-inspector">
                    <div className="studio-insp-tabs">
                        <button
                            className={`studio-insp-tab ${rightTab === "preview" ? "active" : ""}`}
                            onClick={() => setRightTab("preview")}
                        >
                            🌐 {isVi ? "Web Preview" : "Preview"} ({devPorts.length})
                        </button>
                        <button
                            className={`studio-insp-tab ${rightTab === "changelogs" ? "active" : ""}`}
                            onClick={() => setRightTab("changelogs")}
                        >
                            📝 {isVi ? "Changelogs" : "Changelogs"}
                        </button>
                        <button
                            className={`studio-insp-tab ${rightTab === "review" ? "active" : ""}`}
                            onClick={() => setRightTab("review")}
                        >
                            ✨ {isVi ? "Review" : "Review"}{annotations.length > 0 ? ` (${annotations.length})` : ""}
                        </button>
                        <button
                            className={`studio-insp-tab ${rightTab === "tasks" ? "active" : ""}`}
                            onClick={() => setRightTab("tasks")}
                        >
                            ⚡ {isVi ? "Tasks" : "Tasks"} ({tasks.length})
                        </button>
                    </div>

                    {rightTab === "preview" && (
                        <div className="studio-preview-pane">
                            <div className="studio-url-bar">
                                <input
                                    className="studio-url-input"
                                    value={previewUrl}
                                    onChange={(e) => setPreviewUrl(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") setPreviewFrameKey((k) => k + 1);
                                    }}
                                    placeholder="http://127.0.0.1:5173"
                                />
                                <button
                                    className="studio-icon-btn"
                                    title="Cycle Desktop / Tablet 768px / Mobile 390px viewport"
                                    onClick={() =>
                                        setPreviewViewport((v) =>
                                            v === "desktop" ? "tablet" : v === "tablet" ? "mobile" : "desktop"
                                        )
                                    }
                                >
                                    {previewViewport === "desktop" ? "🖥" : previewViewport === "tablet" ? "📟" : "📱"}
                                </button>
                                <button
                                    className="studio-icon-btn"
                                    title="Reload Preview"
                                    onClick={() => setPreviewFrameKey((k) => k + 1)}
                                >
                                    ↻
                                </button>
                                {previewUrl && (
                                    <button
                                        className="studio-icon-btn"
                                        title="Copy Preview URL"
                                        onClick={() => {
                                            navigator.clipboard?.writeText(previewUrl);
                                            showToast(`Copied ${previewUrl}`);
                                        }}
                                    >
                                        ⧉
                                    </button>
                                )}
                                {previewUrl && (
                                    <button
                                        className="studio-icon-btn"
                                        title="Open Full Web Block"
                                        onClick={async () => {
                                            await createBlock({ meta: { view: "web", url: previewUrl } });
                                            setStudioMode(false);
                                        }}
                                    >
                                        ↗
                                    </button>
                                )}
                            </div>

                            {devPorts.length > 0 && (
                                <div className="studio-port-strip">
                                    {devPorts.map((p) => (
                                        <button
                                            key={`${p.port}:${p.pid}`}
                                            className={`studio-port-pill ${previewUrl === p.url ? "active" : ""}`}
                                            onClick={() => {
                                                setPreviewUrl(p.url);
                                                setPreviewFrameKey((k) => k + 1);
                                            }}
                                        >
                                            ● :{p.port} {p.process ? `(${p.process})` : ""}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className={`studio-iframe-stage ${previewViewport}`}>
                                {previewUrl ? (
                                    <iframe
                                        key={`${previewUrl}:${previewFrameKey}`}
                                        src={previewUrl}
                                        title="Live Product Web Preview"
                                        className="studio-preview-iframe"
                                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                                    />
                                ) : (
                                    <div className="studio-preview-empty">
                                        <div className="studio-preview-icon">🌐</div>
                                        <strong>{isVi ? "Xem trước sản phẩm Web trực tiếp" : "Live Web Product Preview"}</strong>
                                        <p>
                                            {isVi
                                                ? "SLTerm tự phát hiện dev server (Vite :5173, Next :3000, Go :8080…) hoặc bấm nhanh cổng bên dưới."
                                                : "Start a local dev server or click a quick localhost port preset below to preview live beside your AI."}
                                        </p>
                                        <div className="studio-port-strip" style={{ justifyContent: "center", marginTop: 10 }}>
                                            {[5173, 3000, 8080, 1420].map((port) => (
                                                <button
                                                    key={port}
                                                    className="studio-port-pill"
                                                    onClick={() => {
                                                        setPreviewUrl(`http://127.0.0.1:${port}`);
                                                        setPreviewFrameKey((k) => k + 1);
                                                    }}
                                                >
                                                    :{port}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {rightTab === "changelogs" && (
                        <div className="studio-insp-scroll">
                            <div className="studio-insp-card">
                                <div className="studio-insp-head">
                                    <strong>
                                        ⎇ {vcsStatus?.branch || "Git"} ({vcsStatus?.changes?.length ?? 0} changed)
                                    </strong>
                                    <div className="studio-banner-actions">
                                        <button
                                            className="studio-mini-btn"
                                            disabled={(vcsStatus?.changes?.length ?? 0) === 0}
                                            onClick={async () => {
                                                await RpcApi.VcsStageCommand(TabRpcClient, { dir: activeRepoDir });
                                                const res = await RpcApi.VcsDraftCommitCommand(TabRpcClient, {
                                                    dir: activeRepoDir,
                                                }).catch(() => null);
                                                if (res?.output) setCommitDraft(res.output);
                                                await refreshAll();
                                            }}
                                        >
                                            ✨ Stage &amp; Draft
                                        </button>
                                    </div>
                                </div>
                                {commitDraft && (
                                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                                        <textarea
                                            className="studio-composer-input"
                                            rows={2}
                                            value={commitDraft}
                                            onChange={(e) => setCommitDraft(e.target.value)}
                                        />
                                        <button
                                            className="studio-mini-btn primary"
                                            onClick={async () => {
                                                await RpcApi.VcsCommitCommand(TabRpcClient, {
                                                    dir: activeRepoDir,
                                                    message: commitDraft,
                                                });
                                                setCommitDraft("");
                                                showToast("✓ Committed cleanly!");
                                                await refreshAll();
                                            }}
                                        >
                                            ✓ Commit Staged
                                        </button>
                                    </div>
                                )}
                                {(vcsStatus?.changes ?? []).length > 0 && (
                                    <div className="studio-ws-chips" style={{ marginTop: 8 }}>
                                        {(vcsStatus?.changes ?? []).slice(0, 10).map((ch) => (
                                            <button
                                                key={`${ch.path}:${ch.staged}`}
                                                className={`studio-ws-chip ${
                                                    selectedFileDiffPath === ch.path ? "active" : ""
                                                }`}
                                                title={`Inspect unified diff for ${ch.path}`}
                                                onClick={async () => {
                                                    setSelectedFileDiffPath(ch.path);
                                                    const d = await RpcApi.VcsGetDiffCommand(TabRpcClient, {
                                                        dir: activeRepoDir,
                                                        path: ch.path,
                                                        staged: ch.staged && !ch.unstaged,
                                                    }).catch(() => null);
                                                    setSelectedFileDiff(d?.diff || "(untracked or binary file)");
                                                }}
                                            >
                                                {ch.untracked ? "?" : ch.staged ? "S" : "M"} {ch.path.split("/").pop()}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {selectedFileDiffPath && selectedFileDiff && (
                                    <div style={{ marginTop: 8 }}>
                                        <StudioMessageBody
                                            text={`\`\`\`diff\n${selectedFileDiff.slice(0, 4000)}\n\`\`\``}
                                            onCopy={() => showToast(`Copied diff for ${selectedFileDiffPath}`)}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="studio-side-label" style={{ marginTop: 8 }}>
                                <span>{isVi ? "Lịch sử Changelogs & Commits" : "Changelogs & Commit Timeline"}</span>
                                <span className="studio-count">{commits.length}</span>
                            </div>
                            <div className="studio-changelog-list">
                                {commits.map((cm) => (
                                    <button
                                        key={cm.hash}
                                        className={`studio-changelog-item ${
                                            selectedCommitSha === cm.shortHash ? "active" : ""
                                        }`}
                                        onClick={() => void inspectCommit(cm.shortHash)}
                                    >
                                        <div className="studio-cl-top">
                                            <span className="studio-sha">{cm.shortHash}</span>
                                            <span className="studio-cl-date">{cm.relDate}</span>
                                        </div>
                                        <div className="studio-cl-subj">{cm.subject}</div>
                                        <div className="studio-cl-author">{cm.author}</div>
                                    </button>
                                ))}
                            </div>

                            {selectedCommitDiff && (
                                <pre className="studio-diff-mini">{selectedCommitDiff}</pre>
                            )}
                        </div>
                    )}

                    {rightTab === "review" && (
                        <div className="studio-insp-scroll">
                            <div className="studio-ws-chips">
                                {["CLAUDE.md", "AGENTS.md", ".worktreeinclude", ".gitignore"].map((fn) => (
                                    <button
                                        key={fn}
                                        className={`studio-ws-chip ${reviewFileName === fn ? "active" : ""}`}
                                        onClick={() => void loadReviewFile(fn)}
                                    >
                                        {fn}
                                    </button>
                                ))}
                            </div>
                            {annotations.length > 0 && (
                                <div className="studio-insp-card">
                                    <div className="studio-insp-head">
                                        <strong>✨ {annotations.length} Annotation(s)</strong>
                                        <button className="studio-mini-btn primary" onClick={sendAnnotationsToComposer}>
                                            ⚡ Send to Composer
                                        </button>
                                    </div>
                                    <div className="studio-changelog-list" style={{ marginTop: 6 }}>
                                        {annotations.map((a) => (
                                            <div key={a.id} className="studio-cl-author">
                                                <strong>[{a.tag.replace("_", " ")}]</strong> L{a.lineNum}: {a.excerpt}
                                                {a.comment ? ` — ${a.comment}` : ""}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="studio-review-lines">
                                {(reviewContent || "(File is empty — choose another or edit in Project Doctor)")
                                    .split("\n")
                                    .slice(0, 60)
                                    .map((ln, idx) => (
                                        <div key={idx} className="studio-review-line">
                                            <span className="studio-review-num">{idx + 1}</span>
                                            <span className="studio-review-txt">{ln || " "}</span>
                                            {ln.trim() && (
                                                <span className="studio-review-btns">
                                                    <button
                                                        title="Mark Looks good"
                                                        onClick={() => addAnnotation(idx + 1, ln.trim(), "looks_good")}
                                                    >
                                                        ✓
                                                    </button>
                                                    <button
                                                        title="Mark Clarify"
                                                        onClick={() => addAnnotation(idx + 1, ln.trim(), "clarify")}
                                                    >
                                                        ?
                                                    </button>
                                                    <button
                                                        title="Mark Needs tests"
                                                        onClick={() => addAnnotation(idx + 1, ln.trim(), "needs_tests")}
                                                    >
                                                        🧪
                                                    </button>
                                                </span>
                                            )}
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}

                    {rightTab === "tasks" && (
                        <div className="studio-insp-scroll">
                            <div className="studio-drawer-search">
                                <input
                                    className="studio-search"
                                    value={newTaskTitle}
                                    onChange={(e) => setNewTaskTitle(e.target.value)}
                                    placeholder={isVi ? "+ Thêm task cho AI agent…" : "+ Add agent task…"}
                                />
                                <button
                                    className="studio-mini-btn primary"
                                    disabled={!newTaskTitle.trim()}
                                    onClick={async () => {
                                        await RpcApi.AdeSaveTaskCommand(TabRpcClient, {
                                            title: newTaskTitle.trim(),
                                            agent: composerAgent === "dual" ? "claude" : composerAgent,
                                            priority: "medium",
                                            repoDir: activeRepoDir !== "." ? activeRepoDir : undefined,
                                            status: "todo",
                                        });
                                        setNewTaskTitle("");
                                        await refreshAll();
                                    }}
                                >
                                    + Add
                                </button>
                            </div>
                            <div className="studio-changelog-list">
                                {tasks.length === 0 ? (
                                    <div className="studio-empty-sm">
                                        {isVi
                                            ? "Thêm task phía trên để giao cho AI chạy trên worktree riêng."
                                            : "Add a task above to dispatch an AI agent into an isolated worktree."}
                                    </div>
                                ) : (
                                    tasks.map((tk) => (
                                        <div key={tk.id} className="studio-insp-card">
                                            <div className="studio-insp-head">
                                                <strong>{tk.title}</strong>
                                                <span className="studio-pill aqua">{tk.status}</span>
                                            </div>
                                            {tk.branch && <div className="studio-cl-author">⎇ {tk.branch}</div>}
                                            <div className="studio-banner-actions" style={{ marginTop: 6 }}>
                                                <button
                                                    className="studio-mini-btn primary"
                                                    onClick={async () => {
                                                        await RpcApi.AdeMoveTaskCommand(TabRpcClient, {
                                                            id: tk.id,
                                                            status: "in_progress",
                                                        });
                                                        await createBlock({
                                                            meta: {
                                                                view: "term",
                                                                controller: "cmd",
                                                                cmd: tk.agent === "codex" ? "codex" : "claude",
                                                                "cmd:cwd": tk.worktreePath || tk.repoDir || activeRepoDir || undefined,
                                                                "cmd:interactive": true,
                                                                "cmd:login": true,
                                                            },
                                                        });
                                                        showToast(`⚡ Dispatched "${tk.title}"`);
                                                        await refreshAll();
                                                    }}
                                                >
                                                    ⚡ Dispatch
                                                </button>
                                                <button
                                                    className="studio-mini-btn"
                                                    onClick={async () => {
                                                        await RpcApi.AdeDeleteTaskCommand(TabRpcClient, { id: tk.id });
                                                        await refreshAll();
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </aside>
            )}
        </div>
    );
};
