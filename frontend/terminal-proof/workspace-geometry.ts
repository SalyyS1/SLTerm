import type { DockSide, LayoutNode, PaneRect, SplitNode } from "./workspace-model";

export type SplitGeometry = { node: SplitNode; bounds: PaneRect; x: number; y: number; length: number };
export type SplitIntersection = { x: number; y: number; splits: SplitGeometry[] };
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const fullRect: PaneRect = { x: 0, y: 0, width: 1, height: 1 };
const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function clampPaneRect(rect: PaneRect, minimumWidth = 0.08, minimumHeight = 0.08): PaneRect {
    const width = bound(rect.width, minimumWidth, 1),
        height = bound(rect.height, minimumHeight, 1);
    return { x: bound(rect.x, 0, 1 - width), y: bound(rect.y, 0, 1 - height), width, height };
}

export function layoutGeometry(layout: LayoutNode | null) {
    const panes: Record<number, PaneRect> = {};
    const splits: SplitGeometry[] = [];
    function visit(node: LayoutNode, bounds: PaneRect) {
        if (node.kind === "pane") {
            panes[node.paneId] = bounds;
            return;
        }
        const horizontal = node.axis === "horizontal";
        const x = bounds.x + (horizontal ? bounds.width * node.ratio : 0);
        const y = bounds.y + (horizontal ? 0 : bounds.height * node.ratio);
        splits.push({ node, bounds, x, y, length: horizontal ? bounds.height : bounds.width });
        visit(node.first, {
            ...bounds,
            width: horizontal ? bounds.width * node.ratio : bounds.width,
            height: horizontal ? bounds.height : bounds.height * node.ratio,
        });
        visit(node.second, {
            x: horizontal ? x : bounds.x,
            y: horizontal ? bounds.y : y,
            width: horizontal ? bounds.width * (1 - node.ratio) : bounds.width,
            height: horizontal ? bounds.height : bounds.height * (1 - node.ratio),
        });
    }
    if (layout) visit(layout, fullRect);
    return { panes, splits };
}

// Include T junctions and four-way crossings. Collinear cuts meeting at the same
// junction participate together so a diagonal drag does not leave a seam behind.
export function splitIntersections(splits: SplitGeometry[]): SplitIntersection[] {
    const epsilon = 1e-7;
    const intersections: SplitIntersection[] = [];
    for (const vertical of splits.filter((split) => split.node.axis === "horizontal")) {
        for (const horizontal of splits.filter((split) => split.node.axis === "vertical")) {
            const { x } = vertical,
                { y } = horizontal;
            if (
                x + epsilon < horizontal.x ||
                x - epsilon > horizontal.x + horizontal.length ||
                y + epsilon < vertical.y ||
                y - epsilon > vertical.y + vertical.length
            )
                continue;
            let point = intersections.find((item) => Math.abs(item.x - x) < epsilon && Math.abs(item.y - y) < epsilon);
            if (!point) {
                point = { x, y, splits: [] };
                intersections.push(point);
            }
            for (const split of [vertical, horizontal]) if (!point.splits.includes(split)) point.splits.push(split);
        }
    }
    return intersections;
}

export function splitRatioAt(split: SplitGeometry, x: number, y: number): number {
    return bound(
        split.node.axis === "horizontal"
            ? (x - split.bounds.x) / split.bounds.width
            : (y - split.bounds.y) / split.bounds.height,
        0.1,
        0.9
    );
}

export function resizePaneRect(
    rect: PaneRect,
    edge: ResizeEdge,
    dx: number,
    dy: number,
    minWidth = 0.08,
    minHeight = 0.08
): PaneRect {
    let { x, y, width, height } = rect;
    const right = x + width,
        bottom = y + height;
    // Respect the opposite edge even when the starting pane is below the usual minimum.
    if (edge.includes("w")) {
        x = bound(x + dx, 0, right - Math.min(minWidth, width));
        width = right - x;
    }
    if (edge.includes("n")) {
        y = bound(y + dy, 0, bottom - Math.min(minHeight, height));
        height = bottom - y;
    }
    if (edge.includes("e")) width = bound(width + dx, Math.min(minWidth, width), 1 - x);
    if (edge.includes("s")) height = bound(height + dy, Math.min(minHeight, height), 1 - y);
    return { x, y, width, height };
}

export function dockingSide(rect: PaneRect, x: number, y: number): DockSide {
    const distances: [DockSide, number][] = [
        ["left", (x - rect.x) / rect.width],
        ["right", (rect.x + rect.width - x) / rect.width],
        ["up", (y - rect.y) / rect.height],
        ["down", (rect.y + rect.height - y) / rect.height],
    ];
    return distances.sort((a, b) => a[1] - b[1])[0][0];
}

export function dockingPreview(rect: PaneRect, side: DockSide): PaneRect {
    if (side === "left") return { ...rect, width: rect.width / 2 };
    if (side === "right") return { ...rect, x: rect.x + rect.width / 2, width: rect.width / 2 };
    if (side === "up") return { ...rect, height: rect.height / 2 };
    return { ...rect, y: rect.y + rect.height / 2, height: rect.height / 2 };
}
