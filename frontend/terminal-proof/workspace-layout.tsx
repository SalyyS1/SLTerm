import { useLayoutEffect, useRef, type PointerEventHandler } from "react";
import { TerminalRuntime, type RuntimeSnapshot } from "./terminal-runtime";
import { Icon, type IconName } from "./workspace-icons";
import { type Axis, type PaneNode, type Workspace } from "./workspace-model";

export const statusLabel = (status?: string) =>
    ({ starting: "Đang mở", running: "Đang chạy", closing: "Đang dừng", exited: "Đã thoát", error: "Cần kiểm tra" })[
        status ?? "starting"
    ] ?? status;
export function IconButton({
    icon,
    label,
    onClick,
    disabled = false,
}: {
    icon: IconName;
    label: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            className="icon-button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
        >
            <Icon name={icon} />
        </button>
    );
}
export type LayoutActions = {
    stop: (id: number) => void;
    hide: (id: number) => void;
    only: (id: number) => void;
    select: (id: number) => void;
    rename: (id: number) => void;
    close: (id: number) => void;
    split: (id: number, axis: Axis) => void;
    zoom: (id: number) => void;
    ratio: (id: string, value: number) => void;
};
type LayoutProps = {
    workspace: Workspace;
    runtime: TerminalRuntime;
    snapshot: RuntimeSnapshot;
    actions: LayoutActions;
    disabled: boolean;
};

export function TerminalPane({ pane, workspace, runtime, snapshot, actions, disabled, dragHeaderProps }: LayoutProps & { pane: PaneNode; dragHeaderProps: { onPointerDown: PointerEventHandler<HTMLElement> } }) {
    const mount = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => runtime.attach(pane.paneId, mount.current!), [runtime, pane.paneId]);
    const info = snapshot.sessions[pane.paneId];
    return (
        <section
            className="terminal-pane"
            data-pane-id={pane.paneId}
            data-active={workspace.activePaneId === pane.paneId}
            aria-label={pane.title}
            onFocusCapture={() => actions.select(pane.paneId)}
            onPointerDown={() => actions.select(pane.paneId)}
        >
            <header className="pane-header" {...(disabled ? {} : dragHeaderProps)} title="Kéo tiêu đề để di chuyển; kéo cạnh hoặc góc để đổi kích thước">
                <span className="pane-drag-title"><Icon name="grip" /><span>{pane.title}</span></span>
                <button
                    className="pane-title-button"
                    title="Đổi tên terminal"
                    onClick={() => actions.rename(pane.paneId)}
                    disabled={disabled}
                >
                    <Icon name="rename" />
                    <span className="sr-only">Đổi tên</span>
                </button>
                <div className="pane-actions">
                    <span className="pane-state" title={info?.message}>
                        {info?.restored ? "Lịch sử · đã dừng" : statusLabel(info?.status)}
                    </span>
                    <IconButton
                        icon="split-horizontal"
                        label="Chia trái / phải"
                        disabled={disabled}
                        onClick={() => actions.split(pane.paneId, "horizontal")}
                    />
                    <IconButton
                        icon={workspace.zoomedPaneId === pane.paneId ? "restore" : "maximize"}
                        label="Phóng to / khôi phục ô"
                        onClick={() => actions.zoom(pane.paneId)}
                    />
                    <IconButton icon="sidebar" label="Ẩn terminal" disabled={disabled} onClick={() => actions.hide(pane.paneId)} />
                    <IconButton
                        icon="close"
                        label="Đóng terminal"
                        disabled={disabled || info?.status === "closing"}
                        onClick={() => actions.close(pane.paneId)}
                    />
                </div>
            </header>
            {info?.warning && <div className="terminal-persistence-warning" role="status">{info.warning}</div>}
            <div className="terminal-mount" ref={mount} />
        </section>
    );
}

