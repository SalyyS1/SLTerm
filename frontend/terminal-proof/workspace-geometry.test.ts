import { describe, expect, it } from "vitest";
import {
    dockingPreview,
    dockingSide,
    layoutGeometry,
    resizePaneRect,
    splitIntersections,
    splitRatioAt,
    type ResizeEdge,
} from "./workspace-geometry";
import { addTerminal, addWorkspace, createWorkspace, type WorkspaceState } from "./workspace-model";

describe("workspace geometry", () => {
    const rect = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

    it.each(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeEdge[])(
        "resizes %s while preserving opposite edges",
        (edge) => {
            const next = resizePaneRect(rect, edge, 0.1, 0.1);
            if (edge.includes("n")) {
                expect(next.y).toBeCloseTo(0.3);
                expect(next.y + next.height).toBeCloseTo(0.6);
            }
            if (edge.includes("s")) {
                expect(next.y).toBe(0.2);
                expect(next.height).toBeCloseTo(0.5);
            }
            if (edge.includes("w")) {
                expect(next.x).toBeCloseTo(0.3);
                expect(next.x + next.width).toBeCloseTo(0.6);
            }
            if (edge.includes("e")) {
                expect(next.x).toBe(0.2);
                expect(next.width).toBeCloseTo(0.5);
            }
        }
    );

    it("clamps edges to the canvas and prevents an inverted rectangle", () => {
        expect(resizePaneRect(rect, "se", 2, 2)).toEqual({ ...rect, width: 0.8, height: 0.8 });
        const inverted = resizePaneRect(rect, "nw", 2, 2);
        expect(inverted.width).toBeCloseTo(0.08);
        expect(inverted.height).toBeCloseTo(0.08);
        const expanded = resizePaneRect(rect, "nw", -2, -2);
        expect(expanded.x).toBe(0);
        expect(expanded.y).toBe(0);
        expect(expanded.width).toBeCloseTo(0.6);
        expect(expanded.height).toBeCloseTo(0.6);
    });

    it("selects and previews all four docking directions", () => {
        for (const [side, x, y] of [
            ["left", 0.21, 0.4],
            ["right", 0.59, 0.4],
            ["up", 0.4, 0.21],
            ["down", 0.4, 0.59],
        ] as const) {
            expect(dockingSide(rect, x, y)).toBe(side);
            const preview = dockingPreview(rect, side);
            expect(preview.width * preview.height).toBeCloseTo((rect.width * rect.height) / 2);
            expect(preview.x).toBeGreaterThanOrEqual(rect.x);
            expect(preview.y).toBeGreaterThanOrEqual(rect.y);
            expect(preview.x + preview.width).toBeLessThanOrEqual(rect.x + rect.width);
            expect(preview.y + preview.height).toBeLessThanOrEqual(rect.y + rect.height);
        }
    });

    it("tiles without gaps or overlaps and resolves diagonal intersections including shared cuts", () => {
        let state: WorkspaceState = addWorkspace(
            { workspaces: [], activeWorkspaceId: null },
            createWorkspace("one", "One", "")
        );
        for (let id = 1; id <= 10; id++) state = addTerminal(state, "one", { paneId: id, title: "Pane" });
        const { panes, splits } = layoutGeometry(state.workspaces[0].layout);
        expect(Object.values(panes).reduce((sum, pane) => sum + pane.width * pane.height, 0)).toBeCloseTo(1);
        for (const pane of Object.values(panes)) {
            expect(pane.width).toBeCloseTo(0.2);
            expect(pane.height).toBeCloseTo(0.5);
        }
        const intersections = splitIntersections(splits);
        expect(intersections).toHaveLength(4);
        for (const point of intersections) {
            expect(point.splits).toHaveLength(3);
            expect(point.splits.some((split) => split.node.axis === "horizontal")).toBe(true);
            expect(point.splits.some((split) => split.node.axis === "vertical")).toBe(true);
            for (const split of point.splits) {
                expect(splitRatioAt(split, point.x, point.y)).toBeCloseTo(split.node.ratio);
                expect(splitRatioAt(split, 10, 10)).toBe(0.9);
                expect(splitRatioAt(split, -10, -10)).toBe(0.1);
            }
        }
    });
});
