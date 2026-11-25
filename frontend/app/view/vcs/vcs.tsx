// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// ADE Git, Diff, Changelist & Isolated Agent Worktree View.
// Brings Claude Terminal's visual Git staging & changelists and Orca's isolated
// per-agent Git worktrees into SLTerm as a fast, lightweight, code-split block.

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { createBlock, globalStore } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeIconClass } from "@/util/util";
import { Atom, atom, PrimitiveAtom, useAtomValue } from "jotai";
import * as React from "react";
import "./vcs.scss";

type VcsTab = "changes" | "worktrees" | "history";

export class VcsViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon: Atom<string>;
    viewName: Atom<string>;

    dirAtom: PrimitiveAtom<string>;
    activeTabAtom: PrimitiveAtom<VcsTab>;
    statusAtom: PrimitiveAtom<VcsStatusData | null>;
    worktreesAtom: PrimitiveAtom<VcsWorktreeData[]>;
    logAtom: PrimitiveAtom<VcsCommitEntryData[]>;
    selectedCommitAtom: PrimitiveAtom<string | null>;
    commitDiffAtom: PrimitiveAtom<string>;
    selectedFileAtom: PrimitiveAtom<{ path: string; staged: boolean } | null>;
    diffAtom: PrimitiveAtom<string>;
    errorAtom: PrimitiveAtom<string | null>;
    noticeAtom: PrimitiveAtom<string | null>;
    loadingAtom: PrimitiveAtom<boolean>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "vcs";
        this.viewIcon = atom("code-branch");
        this.viewName = atom("Git & Worktrees");

        this.dirAtom = atom(".");
        this.activeTabAtom = atom<VcsTab>("changes");
        this.statusAtom = atom(null) as PrimitiveAtom<VcsStatusData | null>;
        this.worktreesAtom = atom<VcsWorktreeData[]>([]);
        this.logAtom = atom<VcsCommitEntryData[]>([]);
        this.selectedCommitAtom = atom(null) as PrimitiveAtom<string | null>;
        this.commitDiffAtom = atom("");
        this.selectedFileAtom = atom(null) as PrimitiveAtom<{ path: string; staged: boolean } | null>;
        this.diffAtom = atom("");
        this.errorAtom = atom(null) as PrimitiveAtom<string | null>;
        this.noticeAtom = atom(null) as PrimitiveAtom<string | null>;
        this.loadingAtom = atom(false);
    }

    get viewComponent(): ViewComponent {
        return VcsView;
    }

    async refresh(dirOverride?: string): Promise<void> {
        const dir = (dirOverride ?? globalStore.get(this.dirAtom)).trim() || ".";
        globalStore.set(this.loadingAtom, true);
        try {
            const [st, wts, commits] = await Promise.all([
                RpcApi.VcsGetStatusCommand(TabRpcClient, { dir }),
                RpcApi.VcsListWorktreesCommand(TabRpcClient, { dir }),
                RpcApi.VcsGetLogCommand(TabRpcClient, { dir, limit: 30 }).catch(() => [] as VcsCommitEntryData[]),
            ]);
            globalStore.set(this.statusAtom, st);
            globalStore.set(this.worktreesAtom, wts ?? []);
            globalStore.set(this.logAtom, commits ?? []);
            if (st?.repoRoot) {
                globalStore.set(this.dirAtom, st.repoRoot);
            }
            globalStore.set(this.errorAtom, null);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    async inspectCommit(hash: string): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        globalStore.set(this.selectedCommitAtom, hash);
        try {
            const res = await RpcApi.VcsShowCommitCommand(TabRpcClient, { dir, hash });
            globalStore.set(this.commitDiffAtom, res?.diff || "(empty commit)");
        } catch (err) {
            globalStore.set(this.commitDiffAtom, `Error inspecting commit: ${String(err)}`);
        }
    }

    async loadDiff(path: string, staged: boolean): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        globalStore.set(this.selectedFileAtom, { path, staged });
        try {
            const res = await RpcApi.VcsGetDiffCommand(TabRpcClient, { dir, path, staged });
            globalStore.set(this.diffAtom, res?.diff || "(no textual diff — file may be untracked or binary)");
        } catch (err) {
            globalStore.set(this.diffAtom, `Diff error: ${String(err)}`);
        }
    }

    async stage(paths?: string[]): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        try {
            await RpcApi.VcsStageCommand(TabRpcClient, { dir, paths });
            await this.refresh(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async unstage(paths?: string[]): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        try {
            await RpcApi.VcsUnstageCommand(TabRpcClient, { dir, paths });
            await this.refresh(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async discard(path: string): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        try {
            await RpcApi.VcsDiscardCommand(TabRpcClient, { dir, path });
            globalStore.set(this.noticeAtom, `Discarded unstaged changes in ${path}`);
            await this.refresh(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async assignChangelist(path: string, changelist: string): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        try {
            await RpcApi.VcsAssignChangelistCommand(TabRpcClient, { dir, path, changelist });
            globalStore.set(this.noticeAtom, `Moved ${path} → changelist "${changelist}"`);
            await this.refresh(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async draftCommit(): Promise<string | null> {
        const dir = globalStore.get(this.dirAtom);
        try {
            const res = await RpcApi.VcsDraftCommitCommand(TabRpcClient, { dir });
            return res?.output || null;
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
            return null;
        }
    }

    async commit(message: string): Promise<boolean> {
        const dir = globalStore.get(this.dirAtom);
        try {
            const res = await RpcApi.VcsCommitCommand(TabRpcClient, { dir, message });
            globalStore.set(this.noticeAtom, res?.output?.split("\n")[0] || "Committed successfully");
            await this.refresh(dir);
            return true;
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
            return false;
        }
    }

    async pushOrPull(kind: "push" | "pull"): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        try {
            const res =
                kind === "push"
                    ? await RpcApi.VcsPushCommand(TabRpcClient, { dir })
                    : await RpcApi.VcsPullCommand(TabRpcClient, { dir });
            globalStore.set(this.noticeAtom, res?.output?.trim() || `${kind} completed`);
            await this.refresh(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async createWorktree(branch: string, targetPath?: string): Promise<boolean> {
        const dir = globalStore.get(this.dirAtom);
        try {
            const wt = await RpcApi.VcsCreateWorktreeCommand(TabRpcClient, {
                dir,
                branch,
                targetPath: targetPath?.trim() || undefined,
            });
            const hyd =
                wt.hydratedFiles && wt.hydratedFiles.length > 0
                    ? ` · hydrated ${wt.hydratedFiles.join(", ")}`
                    : "";
            globalStore.set(this.noticeAtom, `Created worktree ${wt.branch} at ${wt.path}${hyd}`);
            await this.refresh(dir);
            return true;
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
            return false;
        }
    }

    async mergeWorktree(branch: string, worktreePath: string, removeAfter = false): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        try {
            const res = await RpcApi.VcsMergeWorktreeCommand(TabRpcClient, {
                dir,
                branch,
                worktreePath,
                removeAfter,
            });
            globalStore.set(this.noticeAtom, res?.output?.split("\n")[0] || `Merged ${branch} into main`);
            await this.refresh(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async removeWorktree(worktreePath: string): Promise<void> {
        const dir = globalStore.get(this.dirAtom);
        try {
            await RpcApi.VcsRemoveWorktreeCommand(TabRpcClient, { dir, worktreePath, force: false });
            globalStore.set(this.noticeAtom, `Removed worktree ${worktreePath}`);
            await this.refresh(dir);
        } catch (err) {
            globalStore.set(this.errorAtom, String(err));
        }
    }

    async openAgentInDir(cwd: string, agent: "shell" | "claude" | "codex"): Promise<void> {
        if (agent === "shell") {
            await createBlock({
                meta: {
                    view: "term",
                    controller: "shell",
                    "cmd:cwd": cwd,
                },
            });
            return;
        }
        await createBlock({
            meta: {
                view: "term",
                controller: "cmd",
                cmd: agent,
                "cmd:cwd": cwd,
                "cmd:interactive": true,
                "cmd:login": true,
            },
        });
    }
}

function renderDiffLines(diff: string): React.ReactNode {
    if (!diff) {
        return <div className="vcs-empty">Select a changed file to inspect its unified diff.</div>;
    }
    return diff.split("\n").map((line, i) => {
        let cls = "vcs-diff-line";
        if (line.startsWith("+") && !line.startsWith("+++")) cls += " add";
        else if (line.startsWith("-") && !line.startsWith("---")) cls += " del";
        else if (line.startsWith("@@")) cls += " hunk";
        return (
            <div key={i} className={cls}>
                {line || " "}
            </div>
        );
    });
}

function VcsView({ model }: { model: VcsViewModel }) {
    const dir = useAtomValue(model.dirAtom);
    const activeTab = useAtomValue(model.activeTabAtom);
    const status = useAtomValue(model.statusAtom);
    const worktrees = useAtomValue(model.worktreesAtom);
    const commits = useAtomValue(model.logAtom);
    const selectedCommit = useAtomValue(model.selectedCommitAtom);
    const commitDiff = useAtomValue(model.commitDiffAtom);
    const selected = useAtomValue(model.selectedFileAtom);
    const diff = useAtomValue(model.diffAtom);
    const error = useAtomValue(model.errorAtom);
    const notice = useAtomValue(model.noticeAtom);
    const loading = useAtomValue(model.loadingAtom);

    const [dirInput, setDirInput] = React.useState(dir);
    const [commitMsg, setCommitMsg] = React.useState("");
    const [wtBranch, setWtBranch] = React.useState("");
    const [wtPath, setWtPath] = React.useState("");
    const [clFilter, setClFilter] = React.useState("ALL");
    const [newClName, setNewClName] = React.useState("");

    React.useEffect(() => {
        setDirInput(dir);
    }, [dir]);

    React.useEffect(() => {
        model.refresh();
    }, [model]);

    const staged = (status?.changes ?? []).filter((c) => c.staged);
    const allUnstaged = (status?.changes ?? []).filter((c) => c.unstaged || c.untracked);
    const unstaged = clFilter === "ALL" ? allUnstaged : allUnstaged.filter((c) => (c.changelist || "Default") === clFilter);
    const changelists = status?.changelists && status.changelists.length > 0 ? status.changelists : ["Default"];

    return (
        <div className="vcs-view">
            <div className="vcs-header">
                <i className={makeIconClass("code-branch", false)} />
                <input
                    className="vcs-dir-input"
                    value={dirInput}
                    onChange={(e) => setDirInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") model.refresh(dirInput);
                    }}
                    placeholder="Repository folder path (e.g. C:\work\my-app)"
                />
                {status && (
                    <span className="vcs-branch-pill">
                        {status.branch}
                        {status.headShort ? ` · ${status.headShort}` : ""}
                        {status.isWorktree ? " · WT" : ""}
                        {status.ahead > 0 ? ` ↑${status.ahead}` : ""}
                        {status.behind > 0 ? ` ↓${status.behind}` : ""}
                    </span>
                )}
                <button className="vcs-btn" onClick={() => model.pushOrPull("pull")} title="git pull">
                    Pull
                </button>
                <button className="vcs-btn" onClick={() => model.pushOrPull("push")} title="git push">
                    Push
                </button>
                <button className="vcs-btn" onClick={() => model.refresh(dirInput)} disabled={loading} title="Refresh">
                    <i className={makeIconClass("rotate", false)} />
                </button>
            </div>

            <div className="vcs-tabs">
                <button
                    className={`vcs-tab ${activeTab === "changes" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "changes")}
                >
                    Changes ({status?.changes?.length ?? 0})
                </button>
                <button
                    className={`vcs-tab ${activeTab === "worktrees" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "worktrees")}
                >
                    Agent Worktrees ({worktrees.length})
                </button>
                <button
                    className={`vcs-tab ${activeTab === "history" ? "active" : ""}`}
                    onClick={() => globalStore.set(model.activeTabAtom, "history")}
                >
                    History ({commits.length})
                </button>
            </div>

            {error && <div className="vcs-banner error">{error}</div>}
            {notice && <div className="vcs-banner notice">{notice}</div>}

            {activeTab === "changes" ? (
                <div className="vcs-split">
                    <div className="vcs-sidebar">
                        <div className="vcs-section-head">
                            <span>Staged ({staged.length})</span>
                            {staged.length > 0 && (
                                <button className="vcs-link" onClick={() => model.unstage()}>
                                    Unstage all
                                </button>
                            )}
                        </div>
                        {staged.length === 0 ? (
                            <div className="vcs-empty-sm">No staged files</div>
                        ) : (
                            staged.map((c) => (
                                <div
                                    key={`s:${c.path}`}
                                    className={`vcs-file ${selected?.path === c.path && selected.staged ? "selected" : ""}`}
                                    onClick={() => model.loadDiff(c.path, true)}
                                >
                                    <span className="vcs-badge staged">{c.indexStatus}</span>
                                    <span className="vcs-filepath" title={c.path}>
                                        {c.path}
                                    </span>
                                    <button
                                        className="vcs-mini"
                                        title="Unstage"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            model.unstage([c.path]);
                                        }}
                                    >
                                        −
                                    </button>
                                </div>
                            ))
                        )}

                        <div className="vcs-section-head">
                            <span>Unstaged ({unstaged.length})</span>
                            {unstaged.length > 0 && (
                                <button className="vcs-link" onClick={() => model.stage(unstaged.map((u) => u.path))}>
                                    Stage shown
                                </button>
                            )}
                        </div>
                        <div className="vcs-prefixes" style={{ marginBottom: 4 }}>
                            <button
                                className={`vcs-chip ${clFilter === "ALL" ? "active" : ""}`}
                                onClick={() => setClFilter("ALL")}
                            >
                                All
                            </button>
                            {changelists.map((cl) => (
                                <button
                                    key={cl}
                                    className={`vcs-chip ${clFilter === cl ? "active" : ""}`}
                                    onClick={() => setClFilter(cl)}
                                >
                                    {cl}
                                </button>
                            ))}
                        </div>
                        {unstaged.length === 0 ? (
                            <div className="vcs-empty-sm">Working tree clean</div>
                        ) : (
                            unstaged.map((c) => (
                                <div
                                    key={`u:${c.path}`}
                                    className={`vcs-file ${selected?.path === c.path && !selected.staged ? "selected" : ""}`}
                                    onClick={() => model.loadDiff(c.path, false)}
                                >
                                    <span className={`vcs-badge ${c.untracked ? "untracked" : "modified"}`}>
                                        {c.untracked ? "?" : c.workStatus}
                                    </span>
                                    <span className="vcs-filepath" title={c.path}>
                                        {c.path}
                                    </span>
                                    {c.changelist && c.changelist !== "Default" && (
                                        <span className="vcs-cl-pill">{c.changelist}</span>
                                    )}
                                    <button
                                        className="vcs-mini"
                                        title="Assign file to changelist"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const targetCl = newClName.trim() || "AI-Review";
                                            void model.assignChangelist(c.path, targetCl);
                                        }}
                                    >
                                        CL
                                    </button>
                                    {!c.untracked && (
                                        <button
                                            className="vcs-mini"
                                            title="Discard unstaged edits"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (window.confirm(`Discard unstaged edits in ${c.path}?`)) {
                                                    void model.discard(c.path);
                                                }
                                            }}
                                        >
                                            ↩
                                        </button>
                                    )}
                                    <button
                                        className="vcs-mini"
                                        title="Stage"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            model.stage([c.path]);
                                        }}
                                    >
                                        +
                                    </button>
                                </div>
                            ))
                        )}

                        <div className="vcs-commit-box">
                            <input
                                className="vcs-dir-input"
                                value={newClName}
                                onChange={(e) => setNewClName(e.target.value)}
                                placeholder="Target changelist name for CL button (default: AI-Review)"
                            />
                            <div className="vcs-prefixes">
                                {["feat:", "fix:", "refactor:", "chore:"].map((p) => (
                                    <button
                                        key={p}
                                        className="vcs-chip"
                                        onClick={() => setCommitMsg((cur) => (cur.startsWith(p) ? cur : `${p} ${cur}`))}
                                    >
                                        {p}
                                    </button>
                                ))}
                                <button
                                    className="vcs-chip"
                                    disabled={staged.length === 0}
                                    title="Generate Conventional Commit draft locally from staged files"
                                    onClick={async () => {
                                        const draft = await model.draftCommit();
                                        if (draft) setCommitMsg(draft);
                                    }}
                                >
                                    ✨ Auto-Draft
                                </button>
                            </div>
                            <textarea
                                className="vcs-commit-input"
                                rows={3}
                                value={commitMsg}
                                onChange={(e) => setCommitMsg(e.target.value)}
                                placeholder="Commit message (uses 0600 temp file safely)..."
                            />
                            <button
                                className="vcs-btn primary"
                                disabled={!commitMsg.trim() || staged.length === 0}
                                onClick={async () => {
                                    if (await model.commit(commitMsg)) {
                                        setCommitMsg("");
                                    }
                                }}
                            >
                                Commit ({staged.length} staged)
                            </button>
                        </div>
                    </div>

                    <div className="vcs-diff-pane">
                        <div className="vcs-diff-head">
                            {selected ? `${selected.path} (${selected.staged ? "staged" : "working tree"})` : "Unified Diff"}
                        </div>
                        <div className="vcs-diff-body">{renderDiffLines(diff)}</div>
                    </div>
                </div>
            ) : activeTab === "history" ? (
                <div className="vcs-split">
                    <div className="vcs-sidebar">
                        <div className="vcs-section-head">
                            <span>Recent Commits ({commits.length})</span>
                        </div>
                        {commits.length === 0 ? (
                            <div className="vcs-empty-sm">No commits found</div>
                        ) : (
                            commits.map((cm) => (
                                <div
                                    key={cm.hash}
                                    className={`vcs-file ${selectedCommit === cm.shortHash ? "selected" : ""}`}
                                    onClick={() => model.inspectCommit(cm.shortHash)}
                                >
                                    <span className="vcs-sha">{cm.shortHash}</span>
                                    <span className="vcs-filepath" title={`${cm.subject} — ${cm.author} (${cm.relDate})`}>
                                        {cm.subject}
                                    </span>
                                    <button
                                        className="vcs-mini"
                                        title={`Copy ${cm.shortHash}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigator.clipboard?.writeText(cm.shortHash);
                                            globalStore.set(model.noticeAtom, `Copied SHA ${cm.shortHash}`);
                                        }}
                                    >
                                        ⧉
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="vcs-diff-pane">
                        <div className="vcs-diff-head">
                            {selectedCommit ? `git show --stat ${selectedCommit}` : "Select a commit to inspect"}
                        </div>
                        <div className="vcs-diff-body">{renderDiffLines(commitDiff)}</div>
                    </div>
                </div>
            ) : (
                <div className="vcs-worktrees">
                    <div className="vcs-wt-create">
                        <input
                            className="vcs-dir-input"
                            value={wtBranch}
                            onChange={(e) => setWtBranch(e.target.value)}
                            placeholder="New agent branch (e.g. feat/claude-auth-fix)"
                        />
                        <input
                            className="vcs-dir-input"
                            value={wtPath}
                            onChange={(e) => setWtPath(e.target.value)}
                            placeholder="Optional target folder (blank = auto sibling)"
                        />
                        <button
                            className="vcs-btn primary"
                            disabled={!wtBranch.trim()}
                            onClick={async () => {
                                if (await model.createWorktree(wtBranch, wtPath)) {
                                    setWtBranch("");
                                    setWtPath("");
                                }
                            }}
                        >
                            + New Agent Worktree
                        </button>
                    </div>

                    <div className="vcs-wt-list">
                        {worktrees.map((wt) => (
                            <div key={wt.path} className={`vcs-wt-card ${wt.isMain ? "main" : ""}`}>
                                <div className="vcs-wt-info">
                                    <div className="vcs-wt-title">
                                        <strong>{wt.branch || (wt.detached ? "detached" : "HEAD")}</strong>
                                        {wt.isMain && <span className="vcs-cl-pill">MAIN</span>}
                                        {wt.dirtyCount > 0 && (
                                            <span className="vcs-cl-pill dirty">{wt.dirtyCount} dirty</span>
                                        )}
                                        {wt.head && <span className="vcs-sha">{wt.head.slice(0, 7)}</span>}
                                    </div>
                                    <div className="vcs-wt-path">{wt.path}</div>
                                </div>
                                <div className="vcs-wt-actions">
                                    <button className="vcs-btn" onClick={() => model.openAgentInDir(wt.path, "shell")}>
                                        Terminal
                                    </button>
                                    <button className="vcs-btn primary" onClick={() => model.openAgentInDir(wt.path, "claude")}>
                                        Claude
                                    </button>
                                    <button className="vcs-btn" onClick={() => model.openAgentInDir(wt.path, "codex")}>
                                        Codex
                                    </button>
                                    {!wt.isMain && wt.branch && (
                                        <button
                                            className="vcs-btn merge"
                                            title="Merge this agent branch into the main worktree"
                                            onClick={() => model.mergeWorktree(wt.branch, wt.path, false)}
                                        >
                                            Merge → Main
                                        </button>
                                    )}
                                    {!wt.isMain && (
                                        <button className="vcs-btn danger" onClick={() => model.removeWorktree(wt.path)}>
                                            Remove
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
