import {
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent,
    type PointerEventHandler,
    type ReactNode,
} from "react";
import "./workspace-canvas.css";
import {
    clampPaneRect,
    dockingPreview,
    dockingSide,
    fullRect,
    layoutGeometry,
    resizePaneRect,
    splitIntersections,
    splitRatioAt,
    type ResizeEdge,
    type SplitGeometry,
} from "./workspace-geometry";
import {
    findPane,
    paneIds,
    visibleLayout,
    type DockSide,
    type PaneNode,
    type PaneRect,
    type Workspace,
} from "./workspace-model";

export type WorkspaceCanvasProps = {
    workspace: Workspace;
    onRatio: (splitId: string, ratio: number) => void;
    onRect: (paneId: number, rect: PaneRect) => void;
    onDock: (source: number, target: number, side: DockSide) => void;
    onActivate: (paneId: number) => void;
    renderPane: (pane: PaneNode, dragHeaderProps: { onPointerDown: PointerEventHandler<HTMLElement> }) => ReactNode;
};
type Gesture = {
    pointerId: number;
    startX: number;
    startY: number;
    viewport: DOMRect;
    moved: boolean;
} & ({ kind: "split"; splits: SplitGeometry[] } | { kind: "pane"; paneId: number; rect: PaneRect; edge?: ResizeEdge });
type DockTarget = { paneId: number; side: DockSide; rect: PaneRect };
const resizeEdges: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const rectStyle = (rect: PaneRect): CSSProperties => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
});

export function WorkspaceCanvas({ workspace, onRatio, onRect, onDock, onActivate, renderPane }: WorkspaceCanvasProps) {
    const canvas = useRef<HTMLDivElement>(null);
    const gesture = useRef<Gesture | null>(null);
    const target = useRef<DockTarget | null>(null);
    const [preview, setPreview] = useState<DockTarget | null>(null);
    const geometry = layoutGeometry(visibleLayout(workspace));
    const fallback = layoutGeometry(workspace.layout).panes;
    const zoom = workspace.zoomedPaneId;
    const isFree = workspace.layoutMode === "free";

    function start(
        event: PointerEvent<HTMLElement>,
        detail:
            | { kind: "split"; splits: SplitGeometry[] }
            | { kind: "pane"; paneId: number; rect: PaneRect; edge?: ResizeEdge }
    ) {
        if (event.button !== 0 || !canvas.current || gesture.current) return;
        event.preventDefault();
        event.stopPropagation();
        gesture.current = {
            ...detail,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            viewport: canvas.current.getBoundingClientRect(),
            moved: false,
        };
        if (detail.kind === "pane") onActivate(detail.paneId);
        canvas.current.setPointerCapture(event.pointerId);
    }

    function move(event: PointerEvent<HTMLDivElement>) {
        const drag = gesture.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const { viewport } = drag;
        if (!viewport.width || !viewport.height) return;
        const x = (event.clientX - viewport.left) / viewport.width;
        const y = (event.clientY - viewport.top) / viewport.height;
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
        drag.moved = true;
        if (drag.kind === "split") {
            for (const split of drag.splits) onRatio(split.node.splitId, splitRatioAt(split, x, y));
            return;
        }
        if (isFree) {
            const dx = (event.clientX - drag.startX) / viewport.width;
            const dy = (event.clientY - drag.startY) / viewport.height;
            onRect(
                drag.paneId,
                drag.edge
                    ? resizePaneRect(
                          drag.rect,
                          drag.edge,
                          dx,
                          dy,
                          Math.min(0.3, 160 / viewport.width),
                          Math.min(0.3, 100 / viewport.height)
                      )
                    : clampPaneRect(
                          { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy },
                          Math.min(0.08, drag.rect.width),
                          Math.min(0.08, drag.rect.height)
                      )
            );
            return;
        }
        const hit = Object.entries(geometry.panes).find(
            ([id, rect]) =>
                Number(id) !== drag.paneId &&
                x >= rect.x &&
                x <= rect.x + rect.width &&
                y >= rect.y &&
                y <= rect.y + rect.height
        );
        target.current = hit ? { paneId: Number(hit[0]), rect: hit[1], side: dockingSide(hit[1], x, y) } : null;
        setPreview(target.current);
    }

    function finish(event: PointerEvent<HTMLDivElement>, cancel = false) {
        const drag = gesture.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        gesture.current = null;
        if (!cancel && drag.moved && drag.kind === "pane" && !isFree && target.current)
            onDock(drag.paneId, target.current.paneId, target.current.side);
        target.current = null;
        setPreview(null);
        if (canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId);
    }

    return (
        <div
            ref={canvas}
            className="workspace-canvas"
            data-layout-mode={workspace.layoutMode}
            onPointerMove={move}
            onPointerUp={(event) => finish(event)}
            onPointerCancel={(event) => finish(event, true)}
            onLostPointerCapture={(event) => finish(event, true)}
        >
            {paneIds(workspace.layout).map((paneId) => {
                const pane = findPane(workspace.layout, paneId)!;
                const hidden = workspace.hiddenPaneIds.includes(paneId) || (zoom !== null && zoom !== paneId);
                const rect =
                    zoom === paneId
                        ? fullRect
                        : isFree
                          ? (workspace.floating[paneId] ?? fallback[paneId])
                          : (geometry.panes[paneId] ?? fallback[paneId]);
                return (
                    <div
                        key={paneId}
                        className="canvas-pane"
                        data-canvas-pane-id={paneId}
                        style={{
                            ...rectStyle(rect),
                            display: hidden ? "none" : undefined,
                            zIndex: isFree && workspace.activePaneId === paneId ? 2 : 1,
                        }}
                        onPointerDownCapture={() => onActivate(paneId)}
                    >
                        {renderPane(pane, {
                            onPointerDown: (event) => {
                                if (
                                    zoom !== null ||
                                    (event.target as HTMLElement).closest("button,input,select,textarea,a")
                                )
                                    return;
                                start(event, { kind: "pane", paneId, rect });
                            },
                        })}
                        {isFree &&
                            zoom === null &&
                            resizeEdges.map((edge) => (
                                <div
                                    key={edge}
                                    className={`canvas-resize canvas-resize-${edge}`}
                                    role="separator"
                                    tabIndex={0}
                                    aria-label={`Resize ${pane.title}: ${edge}`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round(
                                        (edge.includes("e") || edge.includes("w") ? rect.width : rect.height) * 100
                                    )}
                                    onPointerDown={(event) => start(event, { kind: "pane", paneId, rect, edge })}
                                    onKeyDown={(event) => {
                                        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
                                            return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onRect(
                                            paneId,
                                            resizePaneRect(
                                                rect,
                                                edge,
                                                event.key === "ArrowLeft"
                                                    ? -0.02
                                                    : event.key === "ArrowRight"
                                                      ? 0.02
                                                      : 0,
                                                event.key === "ArrowUp" ? -0.02 : event.key === "ArrowDown" ? 0.02 : 0
                                            )
                                        );
                                    }}
                                />
                            ))}
                    </div>
                );
            })}
            {!isFree &&
                zoom === null &&
                geometry.splits.map((split) => {
                    const horizontal = split.node.axis === "horizontal";
                    return (
                        <div
                            key={split.node.splitId}
                            className="canvas-separator"
                            data-axis={split.node.axis}
                            role="separator"
                            tabIndex={0}
                            aria-label="Resize terminal split"
                            aria-orientation={horizontal ? "vertical" : "horizontal"}
                            aria-valuemin={10}
                            aria-valuemax={90}
                            aria-valuenow={Math.round(split.node.ratio * 100)}
                            style={{
                                left: `${split.x * 100}%`,
                                top: `${split.y * 100}%`,
                                width: horizontal ? undefined : `${split.length * 100}%`,
                                height: horizontal ? `${split.length * 100}%` : undefined,
                            }}
                            onPointerDown={(event) => {
                                event.currentTarget.focus();
                                start(event, { kind: "split", splits: [split] });
                            }}
                            onDoubleClick={() => onRatio(split.node.splitId, 0.5)}
                            onKeyDown={(event) => {
                                const decrease = horizontal ? "ArrowLeft" : "ArrowUp",
                                    increase = horizontal ? "ArrowRight" : "ArrowDown";
                                if (![decrease, increase, "Home", "End"].includes(event.key)) return;
                                event.preventDefault();
                                event.stopPropagation();
                                onRatio(
                                    split.node.splitId,
                                    event.key === "Home"
                                        ? 0.1
                                        : event.key === "End"
                                          ? 0.9
                                          : split.node.ratio + (event.key === decrease ? -0.02 : 0.02)
                                );
                            }}
                        />
                    );
                })}
            {!isFree &&
                zoom === null &&
                splitIntersections(geometry.splits).map((point) => (
                    <div
                        key={point.splits
                            .map((split) => split.node.splitId)
                            .sort()
                            .join(":")}
                        className="canvas-intersection"
                        role="button"
                        tabIndex={0}
                        aria-label="Resize both terminal directions"
                        style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                        onPointerDown={(event) => start(event, { kind: "split", splits: point.splits })}
                        onKeyDown={(event) => {
                            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            for (const split of point.splits) {
                                const horizontal = split.node.axis === "horizontal";
                                if (horizontal === (event.key === "ArrowLeft" || event.key === "ArrowRight"))
                                    onRatio(
                                        split.node.splitId,
                                        split.node.ratio +
                                            (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -0.02 : 0.02)
                                    );
                            }
                        }}
                    />
                ))}
            {preview && (
                <div
                    className="canvas-dock-preview"
                    data-dock-side={preview.side}
                    style={rectStyle(dockingPreview(preview.rect, preview.side))}
                    aria-hidden="true"
                />
            )}
        </div>
    );
}
