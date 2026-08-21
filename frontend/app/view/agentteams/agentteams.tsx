// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Agent Teams view — a live, read-only picture of the multi-agent teams a
// running Claude Code session has spawned, plus each team's task board.
//
// Read-only by design: this observes what a session already decided, the way a
// build dashboard observes CI. Controlling agents from here would be a
// different feature with a different risk profile.

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeIconClass } from "@/util/util";
import { Atom, atom, PrimitiveAtom, useAtomValue } from "jotai";
import * as React from "react";
import "./agentteams.scss";

// Claude Code writes no desktop event when team state changes, so polling the
// small JSON files is the contract available to us.
const POLL_INTERVAL_MS = 3000;

class AgentTeamsViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon: Atom<string>;
    viewName: Atom<string>;

    snapshotAtom: PrimitiveAtom<AgentTeamsSnapshotData | null>;
    loadErrorAtom: PrimitiveAtom<string | null>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "agentteams";
        this.viewIcon = atom("users");
        this.viewName = atom("Agent Teams");
        this.snapshotAtom = atom(null) as PrimitiveAtom<AgentTeamsSnapshotData | null>;
        this.loadErrorAtom = atom(null) as PrimitiveAtom<string | null>;
    }

    get viewComponent(): ViewComponent {
        return AgentTeamsView;
    }

    async refresh(): Promise<void> {
        try {
            const snap = await RpcApi.AgentTeamsGetSnapshotCommand(TabRpcClient);
            globalStore.set(this.snapshotAtom, snap);
            globalStore.set(this.loadErrorAtom, null);
        } catch (err) {
            globalStore.set(this.loadErrorAtom, String(err));
        }
    }
}

function statusClass(status: string): string {
    switch (status?.toLowerCase()) {
        case "in_progress":
            return "in-progress";
        case "completed":
            return "completed";
        case "pending":
            return "pending";
        default:
            return "other";
    }
}

function TaskBoard({ tasks }: { tasks: AgentTeamsTaskData[] }) {
    if (!tasks || tasks.length === 0) {
        return <div className="agentteams-empty">No tasks on this board.</div>;
    }
    return (
        <div className="agentteams-tasks">
            {tasks.map((task) => (
                <div key={task.id} className={`agentteams-task ${statusClass(task.status)}`}>
                    <span className="agentteams-task-status">{task.status}</span>
                    <span className="agentteams-task-subject">{task.subject}</span>
                    {task.owner && <span className="agentteams-task-owner">{task.owner}</span>}
                    {task.blockedBy?.length > 0 && (
                        <span className="agentteams-task-blocked">blocked by {task.blockedBy.join(", ")}</span>
                    )}
                </div>
            ))}
        </div>
    );
}

function TeamCard({ team }: { team: AgentTeamsTeamData }) {
    const lead = team.members?.find((m) => m.agentId === team.leadAgentId);
    const others = team.members?.filter((m) => m.agentId !== team.leadAgentId) ?? [];
    return (
        <div className="agentteams-team">
            <div className="agentteams-team-head">
                <i className={makeIconClass("users", false)} />
                <span className="agentteams-team-name">{team.name}</span>
                <span className="agentteams-team-count">
                    {team.members?.length ?? 0} {team.members?.length === 1 ? "agent" : "agents"}
                </span>
            </div>
            {team.description && <div className="agentteams-team-desc">{team.description}</div>}

            <div className="agentteams-members">
                {lead && (
                    <div className="agentteams-member lead">
                        <i className={makeIconClass("crown", false)} />
                        <span className="agentteams-member-name">{lead.name}</span>
                        <span className="agentteams-member-type">{lead.agentType}</span>
                        {lead.model && <span className="agentteams-member-model">{lead.model}</span>}
                    </div>
                )}
                {others.map((m) => (
                    <div key={m.agentId} className="agentteams-member">
                        <i className={makeIconClass("user", false)} />
                        <span className="agentteams-member-name">{m.name}</span>
                        <span className="agentteams-member-type">{m.agentType}</span>
                        {m.model && <span className="agentteams-member-model">{m.model}</span>}
                    </div>
                ))}
            </div>

            <TaskBoard tasks={team.tasks} />
        </div>
    );
}

function AgentTeamsView({ model }: { model: AgentTeamsViewModel }) {
    const snapshot = useAtomValue(model.snapshotAtom);
    const loadError = useAtomValue(model.loadErrorAtom);

    React.useEffect(() => {
        model.refresh();
        const id = setInterval(() => model.refresh(), POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [model]);

    return (
        <div className="agentteams-view">
            <div className="agentteams-header">
                <span className="agentteams-title">Agent Teams</span>
                <div className="agentteams-header-spacer" />
                <button className="agentteams-refresh" title="Refresh" onClick={() => model.refresh()}>
                    <i className={makeIconClass("arrows-rotate", false)} />
                </button>
            </div>

            {loadError && <div className="agentteams-warning">Could not read team state: {loadError}</div>}
            {snapshot?.warnings?.map((w) => (
                <div key={w} className="agentteams-warning">
                    {w}
                </div>
            ))}

            <div className="agentteams-body">
                {snapshot == null ? (
                    <div className="agentteams-empty">Loading…</div>
                ) : snapshot.teams.length === 0 ? (
                    <div className="agentteams-empty">
                        No active agent teams. Teams appear here while a Claude Code session is running one.
                    </div>
                ) : (
                    snapshot.teams.map((team) => <TeamCard key={team.dirname} team={team} />)
                )}
            </div>
        </div>
    );
}

export { AgentTeamsViewModel };
