import { clampPaneRect, layoutGeometry } from "./workspace-geometry";

export type Axis = "horizontal" | "vertical";
export type DockSide = "left" | "right" | "up" | "down";
export type PaneRect = { x: number; y: number; width: number; height: number };
export type PaneNode = { kind: "pane"; paneId: number; title: string };
export type SplitNode = {
    kind: "split";
    splitId: string;
    axis: Axis;
    ratio: number;
    first: LayoutNode;
    second: LayoutNode;
};
export type LayoutNode = PaneNode | SplitNode;
export type Workspace = {
    id: string;
    name: string;
    cwd: string;
    layout: LayoutNode | null;
    activePaneId: number | null;
    zoomedPaneId: number | null;
    layoutMode: "tiled" | "free";
    arrangement: "auto" | "manual";
    hiddenPaneIds: number[];
    floating: Record<number, PaneRect>;
};
export type WorkspaceState = { workspaces: Workspace[]; activeWorkspaceId: string | null };

const label = (value: string, fallback: string) => value.trim().slice(0, 128) || fallback;
const validPaneId = (id: number) => Number.isSafeInteger(id) && id > 0;
const validAxis = (axis: Axis) => axis === "horizontal" || axis === "vertical";

export function createWorkspace(id: string, name: string, cwd: string): Workspace {
    if (!id.trim()) throw new Error("Workspace ID must not be blank");
    return {
        id,
        name: label(name, "Workspace"),
        cwd,
        layout: null,
        activePaneId: null,
        zoomedPaneId: null,
        layoutMode: "tiled",
        arrangement: "auto",
        hiddenPaneIds: [],
        floating: {},
    };
}

export function activeWorkspace(state: WorkspaceState): Workspace | undefined {
    return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
}

export function paneIds(layout: LayoutNode | null): number[] {
    if (!layout) return [];
    return layout.kind === "pane" ? [layout.paneId] : [...paneIds(layout.first), ...paneIds(layout.second)];
}

export function findPane(layout: LayoutNode | null, id: number): PaneNode | undefined {
    if (!layout) return undefined;
    return layout.kind === "pane"
        ? layout.paneId === id
            ? layout
            : undefined
        : (findPane(layout.first, id) ?? findPane(layout.second, id));
}

// Visibility changes the view, never the source tree or session ownership.
export function visibleLayout(workspace: Workspace): LayoutNode | null {
    function prune(node: LayoutNode | null): LayoutNode | null {
        if (!node) return null;
        if (node.kind === "pane") return workspace.hiddenPaneIds.includes(node.paneId) ? null : node;
        const first = prune(node.first),
            second = prune(node.second);
        if (!first || !second) return first ?? second;
        return first === node.first && second === node.second ? node : { ...node, first, second };
    }
    return prune(workspace.layout);
}

function splitIds(layout: LayoutNode | null): string[] {
    return !layout || layout.kind === "pane"
        ? []
        : [layout.splitId, ...splitIds(layout.first), ...splitIds(layout.second)];
}

function validGeometry(layout: LayoutNode | null): boolean {
    return (
        !layout ||
        layout.kind === "pane" ||
        (validAxis(layout.axis) &&
            Number.isFinite(layout.ratio) &&
            layout.ratio >= 0.1 &&
            layout.ratio <= 0.9 &&
            validGeometry(layout.first) &&
            validGeometry(layout.second))
    );
}

// Retain unaffected branches and state references, including rejected operations.
function edit(state: WorkspaceState, id: string, update: (workspace: Workspace) => Workspace): WorkspaceState {
    const current = state.workspaces.find((workspace) => workspace.id === id);
    if (!current) return state;
    const next = update(current);
    return next === current
        ? state
        : { ...state, workspaces: state.workspaces.map((workspace) => (workspace === current ? next : workspace)) };
}

function mapTree(layout: LayoutNode, update: (node: LayoutNode) => LayoutNode): LayoutNode {
    const result = update(layout);
    if (result !== layout || layout.kind === "pane") return result;
    const first = mapTree(layout.first, update);
    const second = mapTree(layout.second, update);
    return first === layout.first && second === layout.second ? layout : { ...layout, first, second };
}

function withoutPane(layout: LayoutNode, id: number): LayoutNode | null {
    if (layout.kind === "pane") return layout.paneId === id ? null : layout;
    const first = withoutPane(layout.first, id);
    const second = withoutPane(layout.second, id);
    if (!first || !second) return first ?? second;
    return first === layout.first && second === layout.second ? layout : { ...layout, first, second };
}

function availableSplit(state: WorkspaceState, id: string): boolean {
    return Boolean(id.trim()) && !state.workspaces.some((workspace) => splitIds(workspace.layout).includes(id));
}

// Invalid IDs and duplicate identities are rejected as no-ops.
export function addWorkspace(state: WorkspaceState, workspace: Workspace): WorkspaceState {
    const ids = paneIds(workspace.layout);
    const splits = splitIds(workspace.layout);
    const existingIds = state.workspaces.flatMap((item) => paneIds(item.layout));
    const existingSplits = state.workspaces.flatMap((item) => splitIds(item.layout));
    if (
        !workspace.id.trim() ||
        !validGeometry(workspace.layout) ||
        state.workspaces.some((item) => item.id === workspace.id) ||
        ids.some((id) => !validPaneId(id) || existingIds.includes(id)) ||
        new Set(ids).size !== ids.length ||
        splits.some((id) => !id.trim() || existingSplits.includes(id)) ||
        new Set(splits).size !== splits.length ||
        !["tiled", "free"].includes(workspace.layoutMode) ||
        !["auto", "manual"].includes(workspace.arrangement) ||
        !Array.isArray(workspace.hiddenPaneIds) ||
        workspace.hiddenPaneIds.some((id) => !ids.includes(id)) ||
        new Set(workspace.hiddenPaneIds).size !== workspace.hiddenPaneIds.length ||
        !workspace.floating ||
        Object.entries(workspace.floating).some(
            ([id, rect]) =>
                !ids.includes(Number(id)) ||
                !rect ||
                ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
                rect.x < 0 ||
                rect.y < 0 ||
                rect.width <= 0 ||
                rect.height <= 0 ||
                rect.x + rect.width > 1.00000001 ||
                rect.y + rect.height > 1.00000001
        )
    )
        return state;
    if (
        (workspace.activePaneId !== null && !ids.includes(workspace.activePaneId)) ||
        (workspace.zoomedPaneId !== null && !ids.includes(workspace.zoomedPaneId))
    )
        return state;
    const layout =
        workspace.layout &&
        mapTree(workspace.layout, (node) =>
            node.kind === "pane" ? { ...node, title: label(node.title, "Terminal") } : node
        );
    return {
        workspaces: [...state.workspaces, { ...workspace, layout, name: label(workspace.name, "Workspace") }],
        activeWorkspaceId: workspace.id,
    };
}

export function removeWorkspace(state: WorkspaceState, id: string): WorkspaceState {
    const index = state.workspaces.findIndex((workspace) => workspace.id === id);
    if (index < 0) return state;
    const workspaces = state.workspaces.filter((workspace) => workspace.id !== id);
    return {
        workspaces,
        activeWorkspaceId:
            state.activeWorkspaceId === id
                ? (workspaces[Math.min(index, workspaces.length - 1)]?.id ?? null)
                : state.activeWorkspaceId,
    };
}

export function activateWorkspace(state: WorkspaceState, id: string): WorkspaceState {
    return state.activeWorkspaceId === id || !state.workspaces.some((workspace) => workspace.id === id)
        ? state
        : { ...state, activeWorkspaceId: id };
}

export function splitPane(
    state: WorkspaceState,
    workspaceId: string,
    targetPaneId: number | null,
    newPane: { paneId: number; title: string },
    splitId: string,
    axis: Axis
): WorkspaceState {
    if (
        !validPaneId(newPane.paneId) ||
        !validAxis(axis) ||
        state.workspaces.some((workspace) => findPane(workspace.layout, newPane.paneId))
    )
        return state;
    return edit(state, workspaceId, (workspace) => {
        const pane: PaneNode = { kind: "pane", ...newPane, title: label(newPane.title, "Terminal") };
        if (!workspace.layout)
            return targetPaneId === null
                ? { ...workspace, layout: pane, activePaneId: pane.paneId, zoomedPaneId: null, arrangement: "manual" }
                : workspace;
        const target = targetPaneId ?? workspace.activePaneId ?? paneIds(workspace.layout)[0];
        if (!findPane(workspace.layout, target) || !availableSplit(state, splitId)) return workspace;
        const layout = mapTree(workspace.layout, (node) =>
            node.kind === "pane" && node.paneId === target
                ? { kind: "split", splitId, axis, ratio: 0.5, first: node, second: pane }
                : node
        );
        return {
            ...workspace,
            layout,
            activePaneId: pane.paneId,
            zoomedPaneId: null,
            arrangement: "manual",
            hiddenPaneIds: workspace.hiddenPaneIds.filter((id) => id !== target),
        };
    });
}

export function removePane(state: WorkspaceState, workspaceId: string, paneId: number): WorkspaceState {
    return edit(state, workspaceId, (workspace) => {
        if (!findPane(workspace.layout, paneId)) return workspace;
        const layout = withoutPane(workspace.layout!, paneId);
        const hiddenPaneIds = workspace.hiddenPaneIds.filter((id) => id !== paneId);
        const floating = { ...workspace.floating };
        delete floating[paneId];
        return {
            ...workspace,
            layout,
            hiddenPaneIds,
            floating,
            activePaneId:
                workspace.activePaneId === paneId
                    ? (paneIds(layout).find((id) => !hiddenPaneIds.includes(id)) ?? null)
                    : workspace.activePaneId,
            zoomedPaneId: workspace.zoomedPaneId === paneId ? null : workspace.zoomedPaneId,
        };
    });
}

export function activatePane(state: WorkspaceState, workspaceId: string, paneId: number): WorkspaceState {
    const next = edit(state, workspaceId, (workspace) =>
        !findPane(workspace.layout, paneId) ||
        (workspace.activePaneId === paneId && !workspace.hiddenPaneIds.includes(paneId))
            ? workspace
            : {
                  ...workspace,
                  activePaneId: paneId,
                  hiddenPaneIds: workspace.hiddenPaneIds.filter((id) => id !== paneId),
                  zoomedPaneId: workspace.zoomedPaneId !== null ? paneId : null,
              }
    );
    return findPane(next.workspaces.find((workspace) => workspace.id === workspaceId)?.layout ?? null, paneId)
        ? activateWorkspace(next, workspaceId)
        : state;
}

export function renamePane(state: WorkspaceState, workspaceId: string, paneId: number, title: string): WorkspaceState {
    return edit(state, workspaceId, (workspace) => {
        const pane = findPane(workspace.layout, paneId);
        if (!pane || pane.title === label(title, "Terminal")) return workspace;
        return {
            ...workspace,
            layout: mapTree(workspace.layout!, (node) =>
                node === pane ? { ...pane, title: label(title, "Terminal") } : node
            ),
        };
    });
}

export function renameWorkspace(state: WorkspaceState, workspaceId: string, name: string): WorkspaceState {
    return edit(state, workspaceId, (workspace) =>
        workspace.name === label(name, "Workspace") ? workspace : { ...workspace, name: label(name, "Workspace") }
    );
}

export function setSplitRatio(
    state: WorkspaceState,
    workspaceId: string,
    splitId: string,
    ratio: number
): WorkspaceState {
    if (!Number.isFinite(ratio)) return state;
    const bounded = Math.max(0.1, Math.min(0.9, ratio));
    return edit(state, workspaceId, (workspace) => {
        if (!workspace.layout) return workspace;
        const layout = mapTree(workspace.layout, (node) =>
            node.kind === "split" && node.splitId === splitId && node.ratio !== bounded
                ? { ...node, ratio: bounded }
                : node
        );
        return layout === workspace.layout ? workspace : { ...workspace, layout, arrangement: "manual" };
    });
}

export function togglePaneZoom(state: WorkspaceState, workspaceId: string, paneId: number): WorkspaceState {
    return edit(state, workspaceId, (workspace) =>
        !findPane(workspace.layout, paneId)
            ? workspace
            : {
                  ...workspace,
                  activePaneId: paneId,
                  zoomedPaneId: workspace.zoomedPaneId === paneId ? null : paneId,
                  hiddenPaneIds: workspace.hiddenPaneIds.filter((id) => id !== paneId),
              }
    );
}

export function movePane(
    state: WorkspaceState,
    workspaceId: string,
    sourceId: number,
    targetId: number,
    splitId: string,
    axis: Axis
): WorkspaceState {
    if (sourceId === targetId || !validAxis(axis) || !availableSplit(state, splitId)) return state;
    return edit(state, workspaceId, (workspace) => {
        const source = findPane(workspace.layout, sourceId);
        if (!source || !findPane(workspace.layout, targetId)) return workspace;
        const remaining = withoutPane(workspace.layout!, sourceId)!;
        const layout = mapTree(remaining, (node) =>
            node.kind === "pane" && node.paneId === targetId
                ? { kind: "split", splitId, axis, ratio: 0.5, first: node, second: source }
                : node
        );
        return {
            ...workspace,
            layout,
            activePaneId: sourceId,
            zoomedPaneId: null,
            arrangement: "manual",
            hiddenPaneIds: workspace.hiddenPaneIds.filter((id) => id !== sourceId && id !== targetId),
        };
    });
}

export function movePaneToSide(
    state: WorkspaceState,
    workspaceId: string,
    sourceId: number,
    targetId: number,
    splitId: string,
    side: DockSide
): WorkspaceState {
    if (!["left", "right", "up", "down"].includes(side)) return state;
    const next = movePane(
        state,
        workspaceId,
        sourceId,
        targetId,
        splitId,
        side === "left" || side === "right" ? "horizontal" : "vertical"
    );
    if (next === state || side === "right" || side === "down") return next;
    return edit(next, workspaceId, (workspace) => ({
        ...workspace,
        layout: mapTree(workspace.layout!, (node) =>
            node.kind === "split" && node.splitId === splitId
                ? { ...node, first: node.second, second: node.first }
                : node
        ),
    }));
}

function automaticLayout(state: WorkspaceState, workspace: Workspace, panes: PaneNode[]): LayoutNode | null {
    const used = new Set(state.workspaces.flatMap((item) => splitIds(item.layout)));
    let sequence = 0;
    function combine(nodes: LayoutNode[], axis: Axis): LayoutNode {
        if (nodes.length === 1) return nodes[0];
        const middle = Math.ceil(nodes.length / 2);
        let splitId: string;
        do {
            splitId = `${workspace.id}-auto-${++sequence}`;
        } while (used.has(splitId));
        used.add(splitId);
        return {
            kind: "split",
            splitId,
            axis,
            ratio: middle / nodes.length,
            first: combine(nodes.slice(0, middle), axis),
            second: combine(nodes.slice(middle), axis),
        };
    }
    const rows: LayoutNode[] = [];
    for (let i = 0; i < panes.length; i += 5) rows.push(combine(panes.slice(i, i + 5), "horizontal"));
    return rows.length ? combine(rows, "vertical") : null;
}

export function arrangePanes(state: WorkspaceState, workspaceId: string): WorkspaceState {
    return edit(state, workspaceId, (workspace) => {
        const panes = paneIds(workspace.layout).map((id) => findPane(workspace.layout, id)!);
        const layout = automaticLayout(state, workspace, panes);
        return {
            ...workspace,
            layout,
            arrangement: "auto",
            floating: layoutGeometry(layout).panes,
            zoomedPaneId: null,
        };
    });
}

export function addTerminal(
    state: WorkspaceState,
    workspaceId: string,
    newPane: { paneId: number; title: string }
): WorkspaceState {
    if (
        !validPaneId(newPane.paneId) ||
        state.workspaces.some((workspace) => findPane(workspace.layout, newPane.paneId))
    )
        return state;
    return edit(state, workspaceId, (workspace) => {
        const pane: PaneNode = { kind: "pane", paneId: newPane.paneId, title: label(newPane.title, "Terminal") };
        const panes = [...paneIds(workspace.layout).map((id) => findPane(workspace.layout, id)!), pane];
        // Manual docking remains intact; the explicit Arrange command restores the default grid.
        if (workspace.arrangement === "manual" && workspace.layout) {
            let sequence = 0,
                splitId: string;
            do {
                splitId = `${workspace.id}-add-${++sequence}`;
            } while (!availableSplit(state, splitId));
            const target = workspace.activePaneId ?? panes[0].paneId;
            const layout = mapTree(workspace.layout, (node) =>
                node.kind === "pane" && node.paneId === target
                    ? { kind: "split", splitId, axis: "horizontal", ratio: 0.5, first: node, second: pane }
                    : node
            );
            return {
                ...workspace,
                layout,
                activePaneId: pane.paneId,
                zoomedPaneId: null,
                floating: { ...workspace.floating, [pane.paneId]: { x: 0.1, y: 0.1, width: 0.6, height: 0.6 } },
            };
        }
        const layout = automaticLayout(state, workspace, panes);
        return {
            ...workspace,
            layout,
            activePaneId: pane.paneId,
            zoomedPaneId: null,
            floating: layoutGeometry(layout).panes,
        };
    });
}

export function setLayoutMode(
    state: WorkspaceState,
    workspaceId: string,
    layoutMode: Workspace["layoutMode"]
): WorkspaceState {
    if (layoutMode !== "tiled" && layoutMode !== "free") return state;
    return edit(state, workspaceId, (workspace) =>
        workspace.layoutMode === layoutMode
            ? workspace
            : {
                  ...workspace,
                  layoutMode,
                  zoomedPaneId: null,
                  floating: { ...layoutGeometry(workspace.layout).panes, ...workspace.floating },
              }
    );
}

export function setPaneRect(
    state: WorkspaceState,
    workspaceId: string,
    paneId: number,
    rect: PaneRect
): WorkspaceState {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return state;
    return edit(state, workspaceId, (workspace) =>
        !findPane(workspace.layout, paneId)
            ? workspace
            : {
                  ...workspace,
                  arrangement: "manual",
                  floating: { ...workspace.floating, [paneId]: clampPaneRect(rect) },
              }
    );
}

export function togglePaneVisibility(state: WorkspaceState, workspaceId: string, paneId: number): WorkspaceState {
    return edit(state, workspaceId, (workspace) => {
        if (!findPane(workspace.layout, paneId)) return workspace;
        const hidden = workspace.hiddenPaneIds.includes(paneId);
        const hiddenPaneIds = hidden
            ? workspace.hiddenPaneIds.filter((id) => id !== paneId)
            : [...workspace.hiddenPaneIds, paneId];
        return {
            ...workspace,
            hiddenPaneIds,
            activePaneId: hidden
                ? paneId
                : workspace.activePaneId === paneId
                  ? (paneIds(workspace.layout).find((id) => !hiddenPaneIds.includes(id)) ?? null)
                  : workspace.activePaneId,
            zoomedPaneId: workspace.zoomedPaneId === paneId ? null : workspace.zoomedPaneId,
        };
    });
}

export function showOnlyPane(state: WorkspaceState, workspaceId: string, paneId: number): WorkspaceState {
    return edit(state, workspaceId, (workspace) =>
        !findPane(workspace.layout, paneId)
            ? workspace
            : {
                  ...workspace,
                  hiddenPaneIds: paneIds(workspace.layout).filter((id) => id !== paneId),
                  activePaneId: paneId,
                  zoomedPaneId: null,
              }
    );
}

export function showAllPanes(state: WorkspaceState, workspaceId: string): WorkspaceState {
    return edit(state, workspaceId, (workspace) =>
        workspace.hiddenPaneIds.length === 0 && workspace.zoomedPaneId === null
            ? workspace
            : {
                  ...workspace,
                  hiddenPaneIds: [],
                  zoomedPaneId: null,
                  activePaneId: workspace.activePaneId ?? paneIds(workspace.layout)[0] ?? null,
              }
    );
}
