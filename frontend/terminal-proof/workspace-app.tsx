import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ProjectEditor } from "./project-editor";
import "./workspace-project.css";
import appIcon from "../../assets/appicon-windows.svg";
import { TerminalRuntime } from "./terminal-runtime";
import { TerminalSearch } from "./terminal-search";
import { ResourceMonitor } from "./resource-monitor";
import { useWorkspaceController } from "./use-workspace-controller";
import { WorkspaceDialog } from "./workspace-dialog";
import { Icon } from "./workspace-icons";
import { IconButton, TerminalPane } from "./workspace-layout";
import { activateWorkspace, arrangePanes, setPaneRect, movePaneToSide, showAllPanes, paneIds } from "./workspace-model";

import { WorkspaceCanvas } from "./workspace-canvas";
import { WorkspaceSessionList } from "./workspace-session-list";
import { WorkspaceSettings } from "./workspace-settings";
import { WorkspaceBackdrop } from "./workspace-backdrop";
import { WslStatus } from "./wsl-status";
import { appearanceFor } from "./workspace-preferences";
import { appearanceTokens } from "./appearance-settings";
import { appearancePresets } from "./appearance-presets";
import "./workspace-customization.css";
import "./workspace-shell.css";

export function WorkspaceApp({ runtime }: { runtime: TerminalRuntime }) {
    const app = useWorkspaceController(runtime);
    const { workspace, state, snapshot } = app;
    const stage = useRef<HTMLDivElement>(null);
    const [editorOpen, setEditorOpen] = useState<Record<string, boolean>>({});
    const disabled = !app.connected || Boolean(app.dialog) || app.settingsOpen;
    const appearance = appearanceFor(app.preferences.value, workspace?.id);
    useEffect(() => {
        document.body.dataset.theme = appearancePresets.find((preset) => preset.id === appearance.themeId)?.mode ?? "dark";
        for (const [key, value] of Object.entries(appearanceTokens(appearance))) document.body.style.setProperty(key, value);
    }, [appearance]);
    const running = Object.values(snapshot.sessions).filter((session) => session.status === "running").length;
    useEffect(() => {
        const element = stage.current!;
        const wheel = (event: WheelEvent) => {
            if (event.ctrlKey && !event.altKey && !event.metaKey && event.deltaY && !app.dialog && !app.settingsOpen &&
                !(event.target instanceof HTMLElement && event.target.closest(".project-editor"))) {
                event.preventDefault();
                event.stopPropagation();
                app.changeFont(event.deltaY < 0 ? 1 : -1);
            }
        };
        element.addEventListener("wheel", wheel, { passive: false, capture: true });
        return () => element.removeEventListener("wheel", wheel, true);
    }, [runtime, app.dialog, app.settingsOpen, app.changeFont]);
    return (
        <div className={"app-shell" + (app.sidebar ? "" : " sidebar-hidden")}>
            <header className="app-header">
                <div className="app-brand">
                    <img className="brand-mark" src={appIcon} alt="" />
                    <strong className="brand-name">SLTerm</strong>
                    <span className="preview-label">Workspace preview</span>
                </div>
                <div className="header-actions">
                    <ResourceMonitor />
                    <WslStatus />
                    <IconButton
                        icon="sidebar"
                        label="Ẩn / hiện danh sách phiên"
                        onClick={() => app.setSidebar(!app.sidebar)}
                    />
                    <div className="font-controls" role="group" aria-label="Cỡ chữ terminal">
                        <button
                            title="Giảm cỡ chữ · Ctrl −"
                            aria-label="Giảm cỡ chữ"
                            disabled={appearance.terminalFontSize <= 8}
                            onClick={() => app.changeFont(-1)}
                        >
                            A−
                        </button>
                        <button title="Đặt lại · Ctrl 0" aria-label={`Cỡ chữ ${appearance.terminalFontSize} px · đặt lại`} onClick={() => app.changeFont("reset")}>
                            {appearance.terminalFontSize} px
                        </button>
                        <button
                            title="Tăng cỡ chữ · Ctrl +"
                            aria-label="Tăng cỡ chữ"
                            disabled={appearance.terminalFontSize >= 40}
                            onClick={() => app.changeFont(1)}
                        >
                            A+
                        </button>
                    </div>
                    <IconButton icon="settings" label="Tùy chỉnh giao diện và phím tắt" disabled={Boolean(app.dialog) || !app.preferences.ready} onClick={() => app.setSettingsOpen(true)} />
                    <button className="button button-ghost" title="Dừng và thoát" aria-label="Dừng và thoát" onClick={app.quit} disabled={snapshot.phase === "stopping"}>
                        <Icon name="power" />
                        <span className="button-label">Dừng và thoát</span>
                    </button>
                </div>
            </header>
            <div className="app-body">
                <WorkspaceSessionList app={app} />
                <main className="workspace-main">
                    <nav className="workspace-tabs" aria-label="Workspace">
                        {state.workspaces.map((owner) => (
                            <div
                                key={owner.id}
                                className="workspace-tab"
                                data-active={owner.id === state.activeWorkspaceId}
                            >
                                <button
                                    className="tab-select"
                                    title={owner.name}
                                    aria-current={owner.id === state.activeWorkspaceId ? "page" : undefined}
                                    onClick={() => app.setState((current) => activateWorkspace(current, owner.id))}
                                    onDoubleClick={app.renameWorkspace}
                                >
                                    <Icon name="terminal" />
                                    <span className="tab-title">{owner.name}</span>
                                </button>
                                <button
                                    className="tab-close"
                                    aria-label={`Đóng workspace ${owner.name}`}
                                    title="Đóng workspace"
                                    disabled={Boolean(app.dialog)}
                                    onClick={() => app.requestCloseWorkspace(owner)}
                                >
                                    <Icon name="close" size={14} />
                                </button>
                            </div>
                        ))}
                        <button
                            className="icon-button new-workspace"
                            title="Workspace mới · Ctrl Shift T"
                            aria-label="Workspace mới"
                            disabled={disabled}
                            onClick={app.newWorkspace}
                        >
                            <Icon name="plus" />
                            <span className="new-workspace-label">Workspace mới</span>
                        </button>
                    </nav>
                    {(snapshot.error || app.preferences.error) && (
                        <div className="error-banner" role="alert">
                            <span>{snapshot.error || app.preferences.error}</span>
                            {app.preferences.error && <button className="button" onClick={() => { void app.preferences.resync().catch(runtime.report); }}>Đọc lại tùy chỉnh đã lưu</button>}
                            <IconButton icon="close" label="Ẩn thông báo lỗi" onClick={runtime.clearError} />
                        </div>
                    )}
                    <div className="workspace-toolbar">
                        <div className="workspace-location" title={workspace?.cwd}>
                            <Icon name="folder" />
                            <span>{workspace?.cwd ?? "Chưa có workspace"}</span>
                        </div>
                        <div className="toolbar-actions">
                            <button className="button" aria-pressed={Boolean(workspace && editorOpen[workspace.id])} disabled={!workspace || disabled}
                                onClick={() => workspace && setEditorOpen((current) => ({ ...current, [workspace.id]: true }))}>
                                <Icon name="folder" /><span>Tệp dự án{workspace && app.editorDirty[workspace.id] ? " ●" : ""}</span>
                            </button>
                            <button className="button" disabled={!workspace || disabled} onClick={app.openAiDialog} title="Mở Claude hoặc Codex CLI trong pane riêng">
                                <Icon name="terminal" /><span>AI CLI</span>
                            </button>
                            <button className="button" disabled={!workspace || disabled} onClick={() => app.openRemoteDialog("ssh")} title="Mở SSH bằng OpenSSH hệ thống">
                                <Icon name="terminal" /><span>SSH</span>
                            </button>
                            <button className="button" disabled={!workspace || disabled} onClick={() => app.openRemoteDialog("sftp")} title="Mở SFTP bằng OpenSSH hệ thống">
                                <Icon name="folder" /><span>SFTP</span>
                            </button>
                            <button className="button layout-mode" title="Chuyển bố cục chia ô / tự do" disabled={!workspace || disabled} onClick={app.toggleLayout}><Icon name={workspace?.layoutMode === "free" ? "move" : "grid"} /><span>{workspace?.layoutMode === "free" ? "Tự do" : "Chia ô"}</span></button>
                            <IconButton icon="grid" label="Xếp tự động · tối đa 5 ô mỗi hàng" disabled={!workspace || disabled} onClick={() => workspace && app.setState((current) => arrangePanes(current, workspace.id))} />
                            <IconButton
                                icon="rename"
                                label="Đổi tên workspace"
                                disabled={!workspace || Boolean(app.dialog)}
                                onClick={app.renameWorkspace}
                            />
                            <IconButton
                                icon="split-horizontal"
                                label="Chia trái / phải · Ctrl Shift D"
                                disabled={disabled || !workspace}
                                onClick={() => workspace && app.addPane(workspace, "horizontal")}
                            />
                            <IconButton
                                icon="split-vertical"
                                label="Chia trên / dưới · Ctrl Shift E"
                                disabled={disabled || !workspace}
                                onClick={() => workspace && app.addPane(workspace, "vertical")}
                            />
                            <IconButton
                                icon="search"
                                label="Tìm trong terminal · Ctrl F"
                                disabled={!workspace?.activePaneId}
                                onClick={() => app.setSearching(true)}
                            />
                        </div>
                    </div>
                    <div className="workspace-stage" ref={stage}>
                        {state.workspaces.map((owner) => (
                            <div
                                key={owner.id}
                                className="workspace-panel"
                                hidden={state.activeWorkspaceId !== owner.id}
                                aria-label={owner.name}
                                style={appearanceTokens(appearanceFor(app.preferences.value, owner.id)) as CSSProperties}
                            >
                                <WorkspaceBackdrop settings={appearanceFor(app.preferences.value, owner.id)} assets={app.preferences.assets} />
                                {editorOpen[owner.id] && <div className="workspace-editor-dock">
                                    <ProjectEditor root={owner.cwd} request={runtime.request}
                                        onClose={() => setEditorOpen((current) => ({ ...current, [owner.id]: false }))}
                                        onDirtyChange={(dirty) => app.editorChanged(owner.id, dirty)}
                                        onControllerReady={(controller) => app.editorController(owner.id, controller)} />
                                </div>}
                                <div className="workspace-terminal-dock">
                                {owner.layout ? (
                                    <>
                                    <WorkspaceCanvas workspace={owner}
                                        onRatio={app.actions(owner).ratio}
                                        onRect={(id, rect) => app.setState((current) => setPaneRect(current, owner.id, id, rect))}
                                        onDock={(source, target, side) => app.setState((current) => movePaneToSide(current, owner.id, source, target, crypto.randomUUID(), side))}
                                        onActivate={app.actions(owner).select}
                                        renderPane={(pane, dragHeaderProps) => <TerminalPane pane={pane} dragHeaderProps={dragHeaderProps} workspace={owner} runtime={runtime} snapshot={snapshot} actions={app.actions(owner)} disabled={disabled} />} />
                                    {paneIds(owner.layout).every((id) => owner.hiddenPaneIds.includes(id)) && <div className="empty-state hidden-panes-state"><h2>Tất cả ô đang ẩn</h2><p>Process vẫn chạy. Chọn phiên bên trái để xem.</p><button className="button" onClick={() => app.setState((current) => showAllPanes(current, owner.id))}>Hiện tất cả</button></div>}
                                    </>
                                ) : (
                                    <div className="empty-state">
                                        <div className="empty-state-symbol"><Icon name="terminal" size={32} /></div>
                                        <h2>Workspace đang trống</h2>
                                        <p>Mở terminal để bắt đầu làm việc trong thư mục này.</p>
                                        <button
                                            className="button button-primary"
                                            disabled={disabled}
                                            onClick={() => app.addPane(owner)}
                                        >
                                            <Icon name="plus" />
                                            Mở terminal
                                        </button>
                                    </div>
                                )}
                                </div>
                            </div>
                        ))}
                        {!workspace && (
                            <div className="empty-state">
                                <div className="empty-state-symbol"><Icon name="terminal" size={32} /></div>
                                <h2>
                                    {snapshot.phase === "starting"
                                        ? "Đang kết nối terminal…"
                                        : "Không gian làm việc của bạn"}
                                </h2>
                                <p>{snapshot.phase === "starting" ? "Đang khởi động kết nối local. Workspace sẽ sẵn sàng khi kết nối hoàn tất." : "Tạo workspace với thư mục local, rồi chia ô theo cách bạn làm việc."}</p>
                                <button
                                    className="button button-primary"
                                    disabled={disabled}
                                    onClick={app.newWorkspace}
                                >
                                    <Icon name="plus" />
                                    Tạo workspace
                                </button>
                            </div>
                        )}
                        {app.searching && workspace?.activePaneId && (
                            <TerminalSearch
                                key={workspace.activePaneId}
                                paneId={workspace.activePaneId}
                                runtime={runtime}
                                close={() => app.setSearching(false)}
                            />
                        )}
                    </div>
                </main>
            </div>
            <footer className="app-footer">
                <span className="connection-state">
                    <span
                        className="status-dot"
                        data-state={app.connected ? "running" : snapshot.phase === "starting" ? "starting" : "error"}
                    />
                    {app.connected
                        ? "Local connected"
                        : snapshot.phase === "starting"
                          ? "Đang kết nối"
                          : snapshot.phase === "stopping"
                            ? "Đang dừng"
                            : "Đã ngắt kết nối"}
                </span>
                <span className="footer-path">{workspace?.name ?? "SLTerm"}</span>
                <span className="footer-count">
                    {running} đang chạy · {Object.keys(snapshot.sessions).length} terminal
                </span>
            </footer>
            {app.settingsOpen && <WorkspaceSettings preferences={app.preferences} workspaceId={workspace?.id} workspaceName={workspace?.name} close={() => app.setSettingsOpen(false)} />}
            {app.dialog && <WorkspaceDialog spec={app.dialog} close={app.dismissDialog} />}
        </div>
    );
}
