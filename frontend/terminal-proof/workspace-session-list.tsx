import { Icon } from "./workspace-icons";
import { IconButton, statusLabel } from "./workspace-layout";
import { findPane, paneIds, showAllPanes } from "./workspace-model";
import type { useWorkspaceController } from "./use-workspace-controller";

export function WorkspaceSessionList({ app }: { app: ReturnType<typeof useWorkspaceController> }) {
    const { workspace, snapshot } = app;
    const ids = paneIds(workspace?.layout ?? null);
    const disabled = !app.connected || Boolean(app.dialog) || app.settingsOpen;
    return <aside className="session-sidebar" aria-label="Danh sách phiên">
        <div className="sidebar-heading"><h2>TERMINAL</h2><span>{ids.length}</span></div>
        <div className="sidebar-visibility"><button className="button" disabled={!workspace} onClick={() => workspace && app.setState((state) => showAllPanes(state, workspace.id))}>Hiện tất cả</button>
            <span className="field-hint">Ẩn ô vẫn chạy</span></div>
        <div className="session-list">{workspace && ids.map((id) => {
            const actions = app.actions(workspace);
            const info = snapshot.sessions[id];
            const hidden = workspace.hiddenPaneIds.includes(id);
            return <div key={id} className="session-row" data-hidden={hidden}>
                <button className="session-item" data-active={workspace.activePaneId === id} onClick={() => { actions.select(id); app.runtime.focus(id); }}>
                    <Icon name="terminal" /><span className="session-copy"><span className="session-name">{findPane(workspace.layout, id)?.title}</span>
                        <span className="session-meta">{statusLabel(info?.status)}{hidden ? " · Đang ẩn" : ""}</span></span><span className="status-dot" data-state={info?.status} /></button>
                <div className="session-row-actions">
                    <button className="session-small-action" title={hidden ? "Hiện terminal" : "Ẩn terminal"} disabled={disabled} onClick={() => actions.hide(id)}>{hidden ? "Hiện" : "Ẩn"}</button>
                    <button className="session-small-action" title="Dừng process, giữ nội dung" disabled={disabled || info?.status === "exited" || info?.status === "closing"} onClick={() => actions.stop(id)}>Dừng</button>
                    <IconButton icon="close" label={`Đóng terminal ${id}`} disabled={disabled || info?.status === "closing"} onClick={() => actions.close(id)} />
                    <details className="session-menu"><summary aria-label={`Tác vụ terminal ${id}`} title="Tác vụ khác"><Icon name="more" /></summary>
                        <div className="session-menu-items" onClick={(event) => { const detail = event.currentTarget.parentElement as HTMLDetailsElement; detail.open = false; }}>
                            <button disabled={disabled} onClick={() => actions.rename(id)}>Đổi tên</button>
                            <button disabled={disabled} onClick={() => actions.only(id)}>Chỉ hiện ô này</button>
                            <button disabled={disabled} onClick={() => actions.zoom(id)}>Phóng to / khôi phục</button>
                            <button disabled={disabled} onClick={() => actions.split(id, "horizontal")}>Chia trái / phải</button>
                            <button disabled={disabled} onClick={() => actions.split(id, "vertical")}>Chia trên / dưới</button>
                        </div>
                    </details>
                </div>
            </div>;
        })}</div>
        <div className="sidebar-footer"><button className="button" disabled={disabled || !workspace} onClick={() => workspace && app.addPane(workspace)}><Icon name="plus" />Terminal mới</button>
            <p>Local · Windows</p><p>Tối đa 5 ô mỗi hàng tự động.</p><p>Tùy chỉnh và workspace được lưu local.</p></div>
    </aside>;
}
