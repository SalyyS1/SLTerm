import { clampPaneRect, layoutGeometry } from "./workspace-geometry";
import type { RemoteConnection } from "./remote";

export type Axis = "horizontal" | "vertical";
export type DockSide = "left" | "right" | "up" | "down";
export type PaneRect = { x: number; y: number; width: number; height: number };
export type PaneProvider = "claude" | "codex";
export type PaneNode = { kind: "pane"; paneId: number; title: string; runId?: string; provider?: PaneProvider; remote?: RemoteConnection };
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
export const isCanonicalRunId = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const maxWorkspaceLayoutDepth = 128;
const objectRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const validRemote = (value: unknown): value is RemoteConnection => {
    if (!objectRecord(value) || !onlyKeys(value, ["protocol", "host", "user", "port"]) ||
        (value.protocol !== "ssh" && value.protocol !== "sftp") || typeof value.host !== "string" ||
        !value.host || value.host.length > 255 || /[\u0000-\u0020\u007f\\/@]/.test(value.host) ||
        (Object.hasOwn(value, "user") && (typeof value.user !== "string" || value.user.length > 128 || !/^[A-Za-z0-9._-]*$/.test(value.user))) ||
        typeof value.port !== "number" || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) return false;
    return true;
};

/** Validate the complete document before admitting any persisted workspace. */
export function assertWorkspaceState(value: unknown): asserts value is WorkspaceState {
    const invalid = (): never => { throw new Error("Workspace đã lưu không hợp lệ. Dữ liệu cũ được giữ nguyên."); };
    if (!objectRecord(value) || !Array.isArray(value.workspaces)) invalid();
    const state = value as Record<string, unknown> & { workspaces: unknown[] };
    const workspaceIds = new Set<string>(), panes = new Set<number>(), splits = new Set<string>(), runs = new Set<string>();
    const nodes = new Set<object>();
    for (const item of state.workspaces) {
        if (!objectRecord(item) || !onlyKeys(item, ["id", "name", "cwd", "layout", "activePaneId", "zoomedPaneId", "layoutMode", "arrangement", "hiddenPaneIds", "floating"]) ||
            typeof item.id !== "string" || !item.id.trim() || workspaceIds.has(item.id) ||
            typeof item.name !== "string" || typeof item.cwd !== "string" ||
            (item.layoutMode !== "tiled" && item.layoutMode !== "free") || (item.arrangement !== "auto" && item.arrangement !== "manual") ||
            !Array.isArray(item.hiddenPaneIds) || !objectRecord(item.floating)) invalid();
        const workspace = item as Record<string, unknown> & { id: string; hiddenPaneIds: unknown[]; floating: Record<string, unknown> };
        workspaceIds.add(workspace.id);
        const localPanes = new Set<number>();
        const visit = (node: unknown, depth: number): void => {
            if (depth > maxWorkspaceLayoutDepth || !objectRecord(node) || nodes.has(node)) invalid();
            const current = node as Record<string, unknown>;
            nodes.add(current);
            if (current.kind === "pane") {
                if (!onlyKeys(current, ["kind", "paneId", "title", "runId", "provider", "remote"]) || typeof current.paneId !== "number" ||
                    !validPaneId(current.paneId) || panes.has(current.paneId) || typeof current.title !== "string" ||
                    (Object.hasOwn(current, "runId") && (!isCanonicalRunId(current.runId) || runs.has(current.runId))) ||
                    (Object.hasOwn(current, "provider") && current.provider !== "claude" && current.provider !== "codex") ||
                    (Object.hasOwn(current, "remote") && !validRemote(current.remote))) invalid();
                const pane = current as PaneNode;
                panes.add(pane.paneId); localPanes.add(pane.paneId);
                if (pane.runId !== undefined) runs.add(pane.runId);
            } else if (current.kind === "split") {
                if (!onlyKeys(current, ["kind", "splitId", "axis", "ratio", "first", "second"]) ||
                    typeof current.splitId !== "string" || !current.splitId.trim() || splits.has(current.splitId) ||
                    (current.axis !== "horizontal" && current.axis !== "vertical") || typeof current.ratio !== "number" ||
                    !Number.isFinite(current.ratio) || current.ratio < 0.1 || current.ratio > 0.9) invalid();
                splits.add(current.splitId as string);
                visit(current.first, depth + 1); visit(current.second, depth + 1);
            } else invalid();
        };
        if (workspace.layout !== null) visit(workspace.layout, 0);
        for (const selected of [workspace.activePaneId, workspace.zoomedPaneId])
            if (selected !== null && (typeof selected !== "number" || !validPaneId(selected) || !localPanes.has(selected))) invalid();
        if (workspace.hiddenPaneIds.some((id) => typeof id !== "number" || !validPaneId(id) || !localPanes.has(id)) ||
            new Set(workspace.hiddenPaneIds).size !== workspace.hiddenPaneIds.length) invalid();
        for (const [id, rect] of Object.entries(workspace.floating)) {
            if (!validPaneId(Number(id)) || String(Number(id)) !== id || !localPanes.has(Number(id)) || !objectRecord(rect) ||
                !onlyKeys(rect, ["x", "y", "width", "height"]) ||
                ![rect.x, rect.y, rect.width, rect.height].every((number) => typeof number === "number" && Number.isFinite(number))) invalid();
            const bounds = rect as PaneRect;
            if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 ||
                bounds.x + bounds.width > 1.00000001 || bounds.y + bounds.height > 1.00000001) invalid();
        }
    }
    if (state.activeWorkspaceId !== null && (typeof state.activeWorkspaceId !== "string" || !workspaceIds.has(state.activeWorkspaceId))) invalid();
}

/** Detach persisted snapshots from live mutable view metadata. */
export function snapshotWorkspaceState(value: unknown): WorkspaceState {
    assertWorkspaceState(value);
    const cloneLayout = (node: LayoutNode | null): LayoutNode | null => !node ? null : node.kind === "pane"
        ? { ...node, ...(node.remote ? { remote: { ...node.remote } } : {}) }
        : { ...node, first: cloneLayout(node.first)!, second: cloneLayout(node.second)! };
    return { activeWorkspaceId: value.activeWorkspaceId, workspaces: value.workspaces.map((workspace) => ({
        ...workspace, layout: cloneLayout(workspace.layout), hiddenPaneIds: [...workspace.hiddenPaneIds],
        floating: Object.fromEntries(Object.entries(workspace.floating).map(([id, rect]) => [id, { ...rect }])),
    })) };
}

/** Seed generated identities after restoring without reusing an existing ID. */
export function workspaceIdentitySeed(state: WorkspaceState): { pane: number; workspace: number; split: number } {
    let pane = 0, split = 0;
    const visit = (node: LayoutNode | null): void => {
        if (!node) return;
        if (node.kind === "pane") pane = Math.max(pane, node.paneId);
        else {
            const suffix = /^split-([1-9][0-9]*)$/.exec(node.splitId);
            if (suffix && Number.isSafeInteger(Number(suffix[1]))) split = Math.max(split, Number(suffix[1]));
            visit(node.first); visit(node.second);
        }
    };
    for (const workspace of state.workspaces) visit(workspace.layout);
    return { pane, workspace: state.workspaces.length, split };
}

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

function runIds(layout: LayoutNode | null): string[] {
    return !layout ? [] : layout.kind === "pane"
        ? layout.runId === undefined ? [] : [layout.runId]
        : [...runIds(layout.first), ...runIds(layout.second)];
}

function availableRun(state: WorkspaceState, id?: string): boolean {
    return id === undefined || isCanonicalRunId(id) && !state.workspaces.some((workspace) => runIds(workspace.layout).includes(id));
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
    try {
        assertWorkspaceState({ workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id });
    } catch {
        return state;
    }
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
    newPane: Pick<PaneNode, "paneId" | "title" | "runId" | "provider" | "remote">,
    splitId: string,
    axis: Axis
): WorkspaceState {
    if (
        !validPaneId(newPane.paneId) ||
        !availableRun(state, newPane.runId) ||
        !validAxis(axis) ||
        state.workspaces.some((workspace) => findPane(workspace.layout, newPane.paneId))
    )
        return state;
    return edit(state, workspaceId, (workspace) => {
        const pane: PaneNode = { kind: "pane", paneId: newPane.paneId, title: label(newPane.title, "Terminal"),
            ...(newPane.runId === undefined ? {} : { runId: newPane.runId }),
            ...(newPane.provider === undefined ? {} : { provider: newPane.provider }),
            ...(newPane.remote === undefined ? {} : { remote: newPane.remote }) };
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
    newPane: Pick<PaneNode, "paneId" | "title" | "runId" | "provider" | "remote">
): WorkspaceState {
    if (
        !validPaneId(newPane.paneId) ||
        !availableRun(state, newPane.runId) ||
        state.workspaces.some((workspace) => findPane(workspace.layout, newPane.paneId))
    )
        return state;
    return edit(state, workspaceId, (workspace) => {
        const pane: PaneNode = { kind: "pane", paneId: newPane.paneId, title: label(newPane.title, "Terminal"),
            ...(newPane.runId === undefined ? {} : { runId: newPane.runId }),
            ...(newPane.provider === undefined ? {} : { provider: newPane.provider }),
            ...(newPane.remote === undefined ? {} : { remote: newPane.remote }) };
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
