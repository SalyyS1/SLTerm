// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// AI Tools view — browse and edit the Claude Code configuration that lives on
// disk: skills, MCP servers, agents and slash commands.
//
// The backend (pkg/aitools) owns all filesystem knowledge and path validation.
// This view is a list + editor over the inventory it returns.

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeIconClass } from "@/util/util";
import { Atom, atom, PrimitiveAtom, useAtomValue } from "jotai";
import * as React from "react";
import "./aitools.scss";

type AIToolsTab = "skills" | "mcp" | "agents" | "commands";

const TAB_LABELS: Record<AIToolsTab, string> = {
    skills: "Skills",
    mcp: "MCP",
    agents: "Agents",
    commands: "Commands",
};

class AIToolsViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon: Atom<string>;
    viewName: Atom<string>;

    activeTabAtom: PrimitiveAtom<AIToolsTab>;
    inventoryAtom: PrimitiveAtom<AIToolsInventoryData | null>;
    loadErrorAtom: PrimitiveAtom<string | null>;
    selectedAtom: PrimitiveAtom<AIToolsItemData | null>;
    contentAtom: PrimitiveAtom<string | null>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "aitools";
        this.viewIcon = atom("toolbox");
        this.viewName = atom("AI Tools");
        this.activeTabAtom = atom<AIToolsTab>("skills");
        this.inventoryAtom = atom(null) as PrimitiveAtom<AIToolsInventoryData | null>;
        this.loadErrorAtom = atom(null) as PrimitiveAtom<string | null>;
        this.selectedAtom = atom(null) as PrimitiveAtom<AIToolsItemData | null>;
        this.contentAtom = atom(null) as PrimitiveAtom<string | null>;
    }

    get viewComponent(): ViewComponent {
        return AIToolsView;
    }

    async refresh(): Promise<void> {
        try {
            const inv = await RpcApi.AIToolsGetInventoryCommand(TabRpcClient, {});
            globalStore.set(this.inventoryAtom, inv);
            globalStore.set(this.loadErrorAtom, null);
        } catch (err) {
            // A failed read is worth showing: it usually means the on-disk
            // layout changed, which looks identical to "nothing configured"
            // unless we say so.
            globalStore.set(this.loadErrorAtom, String(err));
        }
    }

    async select(item: AIToolsItemData): Promise<void> {
        globalStore.set(this.selectedAtom, item);
        globalStore.set(this.contentAtom, null);
        try {
            const res = await RpcApi.AIToolsReadItemCommand(TabRpcClient, {
                kind: item.kind,
                scope: item.scope,
                name: item.name,
            });
            globalStore.set(this.contentAtom, res.content);
        } catch (err) {
            globalStore.set(this.contentAtom, `Could not read ${item.path}\n\n${String(err)}`);
        }
    }
}

function ItemList({ model, items }: { model: AIToolsViewModel; items: AIToolsItemData[] }) {
    const selected = useAtomValue(model.selectedAtom);
    if (items.length === 0) {
        return <div className="aitools-empty">Nothing configured here yet.</div>;
    }
    return (
        <div className="aitools-list">
            {items.map((item) => (
                <button
                    key={`${item.scope}:${item.name}`}
                    className={`aitools-row${
                        selected?.name === item.name && selected?.scope === item.scope ? " selected" : ""
                    }`}
                    onClick={() => model.select(item)}
                >
                    <div className="aitools-row-head">
                        <span className="aitools-row-name">{item.name}</span>
                        <span className={`aitools-scope aitools-scope-${item.scope}`}>{item.scope}</span>
                    </div>
                    {item.description && <div className="aitools-row-desc">{item.description}</div>}
                </button>
            ))}
        </div>
    );
}

function MCPList({ servers }: { servers: AIToolsMCPServerData[] }) {
    if (servers.length === 0) {
        return <div className="aitools-empty">No MCP servers configured.</div>;
    }
    return (
        <div className="aitools-list">
            {servers.map((server) => (
                <div key={`${server.scope}:${server.name}`} className="aitools-row static">
                    <div className="aitools-row-head">
                        <span className="aitools-row-name">{server.name}</span>
                        <span className="aitools-transport">{server.transport}</span>
                        <span className={`aitools-scope aitools-scope-${server.scope}`}>{server.scope}</span>
                    </div>
                    <div className="aitools-row-desc mono">
                        {server.transport === "http"
                            ? server.url
                            : [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")}
                    </div>
                    <div className="aitools-row-src">{server.sourcepath}</div>
                </div>
            ))}
        </div>
    );
}

function AIToolsView({ model }: { model: AIToolsViewModel }) {
    const activeTab = useAtomValue(model.activeTabAtom);
    const inventory = useAtomValue(model.inventoryAtom);
    const loadError = useAtomValue(model.loadErrorAtom);
    const selected = useAtomValue(model.selectedAtom);
    const content = useAtomValue(model.contentAtom);

    React.useEffect(() => {
        model.refresh();
    }, [model]);

    const counts: Record<AIToolsTab, number> = {
        skills: inventory?.skills?.length ?? 0,
        mcp: inventory?.mcp?.length ?? 0,
        agents: inventory?.agents?.length ?? 0,
        commands: inventory?.commands?.length ?? 0,
    };

    return (
        <div className="aitools-view">
            <div className="aitools-tabs">
                {(Object.keys(TAB_LABELS) as AIToolsTab[]).map((tab) => (
                    <button
                        key={tab}
                        className={`aitools-tab${activeTab === tab ? " active" : ""}`}
                        onClick={() => globalStore.set(model.activeTabAtom, tab)}
                    >
                        {TAB_LABELS[tab]}
                        <span className="aitools-count">{counts[tab]}</span>
                    </button>
                ))}
                <div className="aitools-tabs-spacer" />
                <button className="aitools-refresh" title="Refresh" onClick={() => model.refresh()}>
                    <i className={makeIconClass("arrows-rotate", false)} />
                </button>
            </div>

            {loadError && <div className="aitools-warning">Could not read AI tool config: {loadError}</div>}
            {inventory?.warnings?.map((w) => (
                <div key={w} className="aitools-warning">
                    {w}
                </div>
            ))}

            <div className="aitools-body">
                <div className="aitools-pane-left">
                    {activeTab === "mcp" ? (
                        <MCPList servers={inventory?.mcp ?? []} />
                    ) : (
                        <ItemList model={model} items={inventory?.[activeTab] ?? []} />
                    )}
                </div>
                {activeTab !== "mcp" && (
                    <div className="aitools-pane-right">
                        {selected == null ? (
                            <div className="aitools-empty">Select an item to view it.</div>
                        ) : (
                            <>
                                <div className="aitools-detail-head">
                                    <span className="aitools-detail-name">{selected.name}</span>
                                    <span className="aitools-detail-path">{selected.path}</span>
                                </div>
                                <pre className="aitools-content">{content ?? "Loading…"}</pre>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export { AIToolsViewModel };
