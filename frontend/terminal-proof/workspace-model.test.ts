import { describe, expect, it } from "vitest";
import {
    activatePane,
    activateWorkspace,
    activeWorkspace,
    addTerminal,
    addWorkspace,
    arrangePanes,
    assertWorkspaceState,
    createWorkspace,
    findPane,
    isCanonicalRunId,
    movePane,
    movePaneToSide,
    paneIds,
    removePane,
    removeWorkspace,
    renamePane,
    renameWorkspace,
    setLayoutMode,
    setPaneRect,
    setSplitRatio,
    showAllPanes,
    showOnlyPane,
    splitPane,
    togglePaneVisibility,
    togglePaneZoom,
    visibleLayout,
    workspaceIdentitySeed,
    type LayoutNode,
    type WorkspaceState,
} from "./workspace-model";

const empty = (): WorkspaceState => ({ workspaces: [], activeWorkspaceId: null });
const workspace = () => addWorkspace(empty(), createWorkspace("one", "One", "C:/one"));
function threePanes(): WorkspaceState {
    let state = splitPane(workspace(), "one", null, { paneId: 1, title: "First" }, "unused", "horizontal");
    state = splitPane(state, "one", 1, { paneId: 2, title: "Second" }, "root", "horizontal");
    return splitPane(state, "one", 2, { paneId: 3, title: "Third" }, "nested", "vertical");
}
function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

describe("workspace lifecycle", () => {
    it("matches the transcript core UUID version and variant contract", () => {
        for (const version of "12345678") for (const variant of "89ab")
            expect(isCanonicalRunId(`01234567-89ab-${version}cde-${variant}fab-012345678901`)).toBe(true);
        for (const version of "09abcdef")
            expect(isCanonicalRunId(`01234567-89ab-${version}cde-8fab-012345678901`)).toBe(false);
        for (const variant of "01234567cdef")
            expect(isCanonicalRunId(`01234567-89ab-4cde-${variant}fab-012345678901`)).toBe(false);
    });

    it("preserves canonical run identity through creation, arranging, rename and docking", () => {
        const runs = ["01234567-89ab-4cde-8fab-012345678901", "01234567-89ab-4cde-8fab-012345678902",
            "01234567-89ab-4cde-8fab-012345678903"];
        let state = splitPane(workspace(), "one", null, { paneId: 1, title: "First", runId: runs[0] }, "unused", "horizontal");
        state = addTerminal(state, "one", { paneId: 2, title: "Second", runId: runs[1] });
        state = splitPane(state, "one", 2, { paneId: 3, title: "Third", runId: runs[2] }, "nested", "vertical");
        state = arrangePanes(renamePane(state, "one", 1, "Renamed"), "one");
        state = movePaneToSide(state, "one", 1, 3, "dock", "up");
        expect([1, 2, 3].map((id) => findPane(state.workspaces[0].layout, id)?.runId)).toEqual(runs);
        expect(() => assertWorkspaceState(state)).not.toThrow();
        const other = addWorkspace(state, createWorkspace("two", "Two", ""));
        for (const runId of [runs[0], runs[0].toUpperCase(), "invalid",
            "01234567-89ab-0cde-8fab-012345678904", "01234567-89ab-4cde-7fab-012345678904"]) {
            expect(addTerminal(other, "two", { paneId: 4, title: "Rejected", runId })).toBe(other);
            expect(splitPane(other, "two", null, { paneId: 4, title: "Rejected", runId }, "unused", "horizontal")).toBe(other);
        }
        const duplicateRun = { ...createWorkspace("three", "Three", ""),
            layout: { kind: "pane" as const, paneId: 4, title: "Duplicate", runId: runs[0] } };
        expect(addWorkspace(other, duplicateRun)).toBe(other);
    });

    it("persists remote connection metadata without admitting unsafe host values", () => {
        const connection = { protocol: "ssh" as const, host: "server.example.com", user: "deploy", port: 2222 };
        const state = addTerminal(workspace(), "one", { paneId: 7, title: "SSH", remote: connection });
        expect(findPane(state.workspaces[0].layout, 7)?.remote).toEqual(connection);
        expect(() => assertWorkspaceState(state)).not.toThrow();
        for (const remote of [
            { protocol: "ssh", host: "bad host", port: 22 },
            { protocol: "ssh", host: "host", user: "deploy@evil", port: 22 },
            { protocol: "sftp", host: "host", port: 65536 },
        ]) {
            const invalid = { ...state, workspaces: state.workspaces.map((owner) => ({
                ...owner, layout: { ...owner.layout!, remote },
            })) };
            expect(() => assertWorkspaceState(invalid)).toThrow();
        }
    });

    it("seeds pane and generated split serials from every restored workspace", () => {
        const state = addWorkspace(splitPane(threePanes(), "one", 1, { paneId: 17, title: "Restored" }, "split-27", "horizontal"),
            createWorkspace("two", "Two", ""));
        expect(workspaceIdentitySeed(state)).toEqual({ pane: 17, workspace: 2, split: 27 });
        expect(workspaceIdentitySeed(empty())).toEqual({ pane: 0, workspace: 0, split: 0 });
    });

    it("rejects cyclic and unsupported layouts without recursion failure or partial insertion", () => {
        const cycle: LayoutNode = { kind: "split", splitId: "cycle", axis: "horizontal", ratio: 0.5,
            first: { kind: "pane", paneId: 1, title: "First" }, second: { kind: "pane", paneId: 2, title: "Second" } };
        cycle.first = cycle;
        const supplied = { ...createWorkspace("invalid", "Invalid", ""), layout: cycle };
        const state = empty();
        expect(addWorkspace(state, supplied)).toBe(state);
        expect(() => assertWorkspaceState({ workspaces: [supplied], activeWorkspaceId: "invalid" })).toThrow();
        expect(addWorkspace(state, { ...supplied, layout: { kind: "future" } as unknown as LayoutNode })).toBe(state);
    });

    it("starts empty and selects adjacent workspace when the selected one closes", () => {
        let state = workspace();
        expect(activeWorkspace(state)).toMatchObject({ cwd: "C:/one", layout: null });
        state = addWorkspace(state, createWorkspace("two", "Two", "C:/two"));
        state = addWorkspace(state, createWorkspace("three", "Three", "C:/three"));
        state = activateWorkspace(state, "two");
        state = removeWorkspace(state, "two");
        expect(state.activeWorkspaceId).toBe("three");
        state = removeWorkspace(state, "three");
        expect(state.activeWorkspaceId).toBe("one");
        expect(removeWorkspace(state, "one")).toEqual(empty());
    });

    it("preserves selection when inactive workspaces close and rejects unknown identities", () => {
        const state = addWorkspace(workspace(), createWorkspace("two", "Two", ""));
        expect(removeWorkspace(state, "one").activeWorkspaceId).toBe("two");
        expect(removeWorkspace(state, "missing")).toBe(state);
        expect(activateWorkspace(state, "missing")).toBe(state);
        expect(addWorkspace(state, createWorkspace("one", "Duplicate", ""))).toBe(state);
        expect(() => createWorkspace(" ", "Name", "")).toThrow("ID");
    });

    it("keeps pane and split identities unique across workspaces", () => {
        const state = addWorkspace(threePanes(), createWorkspace("two", "Two", ""));
        expect(splitPane(state, "two", null, { paneId: 1, title: "Duplicate" }, "unused", "horizontal")).toBe(state);
        const inserted = splitPane(state, "two", null, { paneId: 4, title: "Fourth" }, "unused", "horizontal");
        expect(splitPane(inserted, "two", 4, { paneId: 5, title: "Fifth" }, "root", "horizontal")).toBe(inserted);
        const duplicate = {
            ...createWorkspace("three", "Three", ""),
            layout: findPane(state.workspaces[0].layout, 1)!,
        };
        expect(addWorkspace(state, duplicate)).toBe(state);
    });

    it("rejects malformed supplied layouts before they enter state", () => {
        const supplied = threePanes().workspaces[0];
        const invalidRatio = { ...supplied, layout: { ...supplied.layout!, ratio: NaN } as LayoutNode };
        const state = empty();
        expect(addWorkspace(state, invalidRatio)).toBe(state);
        const duplicatePane = findPane(supplied.layout, 1)!;
        const duplicateLayout: LayoutNode = {
            kind: "split",
            splitId: "duplicate",
            axis: "vertical",
            ratio: 0.5,
            first: duplicatePane,
            second: duplicatePane,
        };
        expect(addWorkspace(state, { ...supplied, layout: duplicateLayout })).toBe(state);
        expect(addWorkspace(state, { ...supplied, activePaneId: 999 })).toBe(state);
        expect(addWorkspace(state, { ...supplied, zoomedPaneId: 999 })).toBe(state);
    });
});

describe("workspace customization", () => {
    function automatic(count: number) {
        let state = workspace();
        for (let id = 1; id <= count; id++) state = addTerminal(state, "one", { paneId: id, title: `Pane ${id}` });
        return state;
    }

    it("automatically wraps after five columns without limiting pane count", () => {
        const state = freeze(automatic(52));
        const current = state.workspaces[0];
        expect(paneIds(current.layout)).toHaveLength(52);
        const rows: number[][] = [];
        function visit(node: LayoutNode) {
            if (node.kind === "split" && node.axis === "vertical") {
                visit(node.first);
                visit(node.second);
            } else rows.push(paneIds(node));
        }
        visit(current.layout!);
        expect(rows.map((row) => row.length)).toEqual([...Array(10).fill(5), 2]);
        expect(current).toMatchObject({ arrangement: "auto", activePaneId: 52 });
        expect(addTerminal(state, "one", { paneId: 1, title: "duplicate" })).toBe(state);
        expect(addTerminal(state, "one", { paneId: NaN, title: "invalid" })).toBe(state);
        expect(addTerminal(state, "missing", { paneId: 60, title: "unknown" })).toBe(state);
    });

    it("preserves every leaf and layout identity through hide, zoom, reveal, and mode changes", () => {
        const state = freeze(automatic(7));
        const original = state.workspaces[0];
        let next = showOnlyPane(state, "one", 3);
        expect(visibleLayout(next.workspaces[0])).toBe(findPane(original.layout, 3));
        expect(next.workspaces[0].layout).toBe(original.layout);
        next = togglePaneVisibility(next, "one", 3);
        expect(visibleLayout(next.workspaces[0])).toBeNull();
        expect(next.workspaces[0].activePaneId).toBeNull();
        next = activatePane(next, "one", 4);
        expect(next.workspaces[0].hiddenPaneIds).not.toContain(4);
        next = togglePaneZoom(next, "one", 5);
        expect(next.workspaces[0]).toMatchObject({ activePaneId: 5, zoomedPaneId: 5 });
        expect(next.workspaces[0].hiddenPaneIds).not.toContain(5);
        expect(showAllPanes(next, "one").workspaces[0]).toMatchObject({ hiddenPaneIds: [], zoomedPaneId: null });
        next = setLayoutMode(next, "one", "free");
        next = showAllPanes(next, "one");
        next = setLayoutMode(next, "one", "tiled");
        expect(next.workspaces[0].layout).toBe(original.layout);
        expect(next.workspaces[0].hiddenPaneIds).toEqual([]);
        expect(paneIds(next.workspaces[0].layout)).toEqual(paneIds(original.layout));
        expect(setLayoutMode(next, "one", "tiled")).toBe(next);
        expect(togglePaneVisibility(next, "one", 99)).toBe(next);
        expect(showOnlyPane(next, "one", 99)).toBe(next);
    });

    it.each(["left", "right", "up", "down"] as const)("docks %s without replacing leaf identities", (side) => {
        const state = freeze(automatic(6));
        const source = findPane(state.workspaces[0].layout, 1);
        const next = movePaneToSide(state, "one", 1, 6, "dock", side);
        expect(findPane(next.workspaces[0].layout, 1)).toBe(source);
        expect(paneIds(next.workspaces[0].layout).sort()).toEqual([1, 2, 3, 4, 5, 6]);
        const layout = next.workspaces[0].layout!;
        function dock(node: LayoutNode): Extract<LayoutNode, { kind: "split" }> | undefined {
            return node.kind === "pane"
                ? undefined
                : node.splitId === "dock"
                  ? node
                  : (dock(node.first) ?? dock(node.second));
        }
        expect(dock(layout)).toMatchObject({
            axis: side === "left" || side === "right" ? "horizontal" : "vertical",
            first: { paneId: side === "left" || side === "up" ? 1 : 6 },
            second: { paneId: side === "left" || side === "up" ? 6 : 1 },
        });
        expect(next.workspaces[0].arrangement).toBe("manual");
        const added = addTerminal(next, "one", { paneId: 7, title: "Seventh" });
        expect(added.workspaces[0].arrangement).toBe("manual");
        expect(arrangePanes(added, "one").workspaces[0].arrangement).toBe("auto");
    });

    it("bounds free geometry, persists positions across modes and removes stale view metadata", () => {
        const state = freeze(automatic(2));
        expect(setPaneRect(state, "one", 1, { x: NaN, y: 0, width: 1, height: 1 })).toBe(state);
        expect(setPaneRect(state, "one", 99, { x: 0, y: 0, width: 1, height: 1 })).toBe(state);
        let next = setPaneRect(state, "one", 1, { x: 0.9, y: -1, width: 0.5, height: 0.4 });
        expect(next.workspaces[0].floating[1]).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.4 });
        next = setLayoutMode(setLayoutMode(next, "one", "free"), "one", "tiled");
        expect(next.workspaces[0].floating[1]).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.4 });
        next = togglePaneVisibility(next, "one", 1);
        next = removePane(next, "one", 1);
        expect(next.workspaces[0].hiddenPaneIds).toEqual([]);
        expect(next.workspaces[0].floating[1]).toBeUndefined();
    });

    it("rejects persisted visibility and geometry that refer to unknown panes", () => {
        const current = automatic(1).workspaces[0];
        expect(addWorkspace(empty(), { ...current, hiddenPaneIds: [99] })).toEqual(empty());
        expect(addWorkspace(empty(), { ...current, floating: { 99: { x: 0, y: 0, width: 1, height: 1 } } })).toEqual(
            empty()
        );
        expect(addWorkspace(empty(), { ...current, floating: { 1: { x: 0.5, y: 0, width: 1, height: 1 } } })).toEqual(
            empty()
        );
    });
});

describe("pane layout", () => {
    it("collapses nested splits and chooses a surviving pane on close", () => {
        const original = freeze(threePanes());
        let state = removePane(original, "one", 2);
        expect(paneIds(state.workspaces[0].layout)).toEqual([1, 3]);
        expect(state.workspaces[0].layout).toMatchObject({
            kind: "split",
            splitId: "root",
            second: { kind: "pane", paneId: 3 },
        });
        state = removePane(state, "one", 3);
        expect(state.workspaces[0]).toMatchObject({ layout: { kind: "pane", paneId: 1 }, activePaneId: 1 });
        expect(removePane(state, "one", 1).workspaces[0]).toMatchObject({
            layout: null,
            activePaneId: null,
            zoomedPaneId: null,
        });
        expect(paneIds(original.workspaces[0].layout)).toEqual([1, 2, 3]);
    });

    it("rejects stale split targets and invalid IDs without changing layout", () => {
        const state = threePanes();
        expect(splitPane(state, "one", 99, { paneId: 4, title: "New" }, "new", "horizontal")).toBe(state);
        expect(splitPane(state, "one", 1, { paneId: 2, title: "Duplicate" }, "new", "horizontal")).toBe(state);
        expect(splitPane(state, "one", 1, { paneId: NaN, title: "Invalid" }, "new", "horizontal")).toBe(state);
        expect(removePane(state, "one", 99)).toBe(state);
        expect(activatePane(state, "one", 99)).toBe(state);
        expect(
            splitPane(workspace(), "one", 7, { paneId: 1, title: "Invalid target" }, "unused", "horizontal")
                .workspaces[0].layout
        ).toBeNull();
    });

    it("selects a pane's workspace and isolates immutable updates", () => {
        const state = freeze(addWorkspace(threePanes(), createWorkspace("two", "Two", "")));
        const next = activatePane(state, "one", 1);
        expect(activeWorkspace(next)?.activePaneId).toBe(1);
        expect(next.workspaces[1]).toBe(state.workspaces[1]);
        expect(next.workspaces[0].layout).toBe(state.workspaces[0].layout);
        expect(state.activeWorkspaceId).toBe("two");
    });

    it("bounds split ratios and preserves other split geometry", () => {
        const state = freeze(threePanes());
        expect(setSplitRatio(state, "one", "root", NaN)).toBe(state);
        expect(setSplitRatio(state, "one", "root", Infinity)).toBe(state);
        expect(setSplitRatio(state, "one", "missing", 0.7)).toBe(state);
        const larger = setSplitRatio(state, "one", "root", 2);
        expect(larger.workspaces[0].layout).toMatchObject({ ratio: 0.9, second: { ratio: 0.5 } });
        expect(setSplitRatio(state, "one", "nested", -2).workspaces[0].layout).toMatchObject({
            ratio: 0.5,
            second: { ratio: 0.1 },
        });
    });

    it("toggles zoom without deleting hidden panes and clears removed or newly split zoom", () => {
        const state = threePanes();
        const zoomed = togglePaneZoom(state, "one", 2);
        expect(zoomed.workspaces[0]).toMatchObject({ activePaneId: 2, zoomedPaneId: 2 });
        expect(zoomed.workspaces[0].layout).toBe(state.workspaces[0].layout);
        expect(togglePaneZoom(zoomed, "one", 2).workspaces[0].zoomedPaneId).toBeNull();
        expect(togglePaneZoom(zoomed, "one", 99)).toBe(zoomed);
        expect(removePane(zoomed, "one", 2).workspaces[0].zoomedPaneId).toBeNull();
        expect(removePane(zoomed, "one", 3).workspaces[0].zoomedPaneId).toBe(2);
        expect(
            splitPane(zoomed, "one", 2, { paneId: 4, title: "Fourth" }, "more", "horizontal").workspaces[0].zoomedPaneId
        ).toBeNull();
    });

    it("trims and bounds display names while keeping titles as plain data", () => {
        const state = freeze(threePanes());
        const renamed = renamePane(state, "one", 2, "  <script>hello</script>  ");
        expect(findPane(renamed.workspaces[0].layout, 2)?.title).toBe("<script>hello</script>");
        expect(findPane(renamePane(state, "one", 2, "x".repeat(129)).workspaces[0].layout, 2)?.title).toHaveLength(128);
        expect(renameWorkspace(state, "one", "  Updated  ").workspaces[0].name).toBe("Updated");
        expect(renamePane(state, "one", 99, "Missing")).toBe(state);
        expect(findPane(state.workspaces[0].layout, 2)?.title).toBe("Second");
    });

    it("moves an existing pane across nested branches without changing its process identity", () => {
        const state = freeze(threePanes());
        const originalPane = findPane(state.workspaces[0].layout, 1);
        const next = movePane(state, "one", 1, 3, "moved", "horizontal");
        expect(paneIds(next.workspaces[0].layout).sort()).toEqual([1, 2, 3]);
        expect(findPane(next.workspaces[0].layout, 1)).toBe(originalPane);
        expect(next.workspaces[0].layout).toMatchObject({
            splitId: "nested",
            first: { paneId: 2 },
            second: { splitId: "moved", first: { paneId: 3 }, second: { paneId: 1 } },
        });
        expect(next.workspaces[0]).toMatchObject({ activePaneId: 1, zoomedPaneId: null });
        expect(paneIds(state.workspaces[0].layout)).toEqual([1, 2, 3]);
    });

    it("preserves all pane IDs through a sequence of moves and rejects stale drag operations", () => {
        let state = threePanes();
        const expected = paneIds(state.workspaces[0].layout).sort();
        for (const [source, target] of [
            [3, 1],
            [1, 2],
            [2, 3],
            [3, 2],
        ]) {
            state = movePane(freeze(state), "one", source, target, `move-${source}-${target}`, "vertical");
            expect(paneIds(state.workspaces[0].layout).sort()).toEqual(expected);
        }
        expect(movePane(state, "one", 1, 1, "self", "horizontal")).toBe(state);
        expect(movePane(state, "one", 1, 99, "stale", "horizontal")).toBe(state);
        expect(movePane(state, "one", 99, 1, "stale", "horizontal")).toBe(state);
        const layout = state.workspaces[0].layout as Extract<LayoutNode, { kind: "split" }>;
        expect(movePane(state, "one", 1, 2, layout.splitId, "horizontal")).toBe(state);
    });
});
