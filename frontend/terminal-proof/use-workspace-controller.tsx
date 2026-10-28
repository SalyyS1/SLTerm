import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { terminalAppearance, defaultAppearance } from "./appearance-settings";
import { useWorkspacePreferences } from "./use-workspace-preferences";
import { appearanceFor, restoreDescriptors, shortcutsFor, withDescriptors } from "./workspace-preferences";
import { matchShortcut, type ShortcutAction } from "./workspace-shortcuts";
import { TerminalRuntime } from "./terminal-runtime";
import { type DialogSpec } from "./workspace-dialog";
import type { LayoutActions } from "./workspace-layout";
import * as model from "./workspace-model";
import { workspacePath } from "./workspace-path";

export function useWorkspaceController(runtime: TerminalRuntime) {
    const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
    const [state, setState] = useState<model.WorkspaceState>({ workspaces: [], activeWorkspaceId: null });
    const [dialog, setDialog] = useState<DialogSpec | null>(null);
    const [sidebar, setSidebar] = useState(true);
    const [searching, setSearching] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const preferences = useWorkspacePreferences();
    const [hydrated, setHydrated] = useState(false);
    const [defaultCwd, setDefaultCwd] = useState("");
    const serial = useRef({ pane: 0, workspace: 0, split: 0 });
    const workspace = model.activeWorkspace(state);
    const connected = snapshot.phase === "connected" && hydrated;
    const splitId = () => `split-${++serial.current.split}`;
    const addPane = (owner: model.Workspace, axis?: model.Axis, target = owner.activePaneId) => {
        if (!connected) return;
        const paneId = ++serial.current.pane;
        runtime.prepare(paneId, owner.cwd, terminalAppearance(appearanceFor(preferences.value, owner.id)));
        const id = splitId();
        setState((current) =>
            axis ? model.splitPane(current, owner.id, target, { paneId, title: `Terminal ${paneId}` }, id, axis)
                : model.addTerminal(current, owner.id, { paneId, title: `Terminal ${paneId}` })
        );
    };
    useEffect(() => {
        let mounted = true;
        void Promise.all([runtime.start(), preferences.load().catch((error) => { runtime.report(error); return null; })])
            .then(([environment, saved]) => {
                if (!mounted) return;
                setDefaultCwd(environment.cwd);
                if (saved && preferences.existed.current) {
                    setState(restoreDescriptors(saved)); setHydrated(true); return;
                }
                const owner = model.createWorkspace(
                    crypto.randomUUID(),
                    "Workspace",
                    environment.cwd
                );
                const paneId = ++serial.current.pane;
                ++serial.current.workspace;
                runtime.prepare(paneId, owner.cwd, terminalAppearance(appearanceFor(saved ?? preferences.value)));
                setState(model.addTerminal(model.addWorkspace({ workspaces: [], activeWorkspaceId: null }, owner), owner.id, { paneId, title: `Terminal ${paneId}` }));
                setHydrated(true);
            })
            .catch(runtime.report);
        return () => {
            mounted = false;
        };
    }, [runtime]);
    const descriptors = JSON.stringify({ workspaces: state.workspaces.map(({ id, name, cwd, layoutMode }) => ({ id, name, cwd, layoutMode })), activeWorkspaceId: state.activeWorkspaceId });
    useEffect(() => {
        if (hydrated && preferences.writable) void preferences.commit((value) => withDescriptors(value, state)).catch(() => {});
    }, [descriptors, hydrated]);
    useEffect(() => {
        for (const owner of state.workspaces)
            runtime.applyAppearance(model.paneIds(owner.layout), terminalAppearance(appearanceFor(preferences.value, owner.id)));
    }, [preferences.value, state.workspaces.length, runtime]);
    useEffect(() => {
        runtime.scheduleResize();
        if (!dialog && !searching && !settingsOpen) runtime.focus(workspace?.activePaneId ?? null);
    }, [runtime, state.activeWorkspaceId, workspace?.activePaneId, workspace?.zoomedPaneId, dialog, searching, settingsOpen]);
    const newWorkspace = () => {
        if (!connected || dialog) return;
        setDialog({
            title: "Workspace mới",
            body: <p>Mở terminal local trong thư mục làm việc của bạn.</p>,
            accept: "Tạo workspace",
            fields: [
                { name: "name", label: "Tên workspace", value: `Workspace ${serial.current.workspace + 1}` },
                {
                    name: "cwd",
                    label: "Thư mục local",
                    value: workspace?.cwd ?? defaultCwd,
                    hint: "Nhập đường dẫn tuyệt đối trên Windows. Phiên mới dùng thư mục này.",
                },
            ],
            submit: ({ name, cwd }) => {
                const directory = workspacePath(cwd);
                ++serial.current.workspace;
                const owner = model.createWorkspace(crypto.randomUUID(), name, directory);
                const paneId = ++serial.current.pane;
                runtime.prepare(paneId, owner.cwd, terminalAppearance(appearanceFor(preferences.value, owner.id)));
                setState((current) => model.addTerminal(model.addWorkspace(current, owner), owner.id, { paneId, title: `Terminal ${paneId}` }));
            },
        });
    };
    const closePane = async (owner: model.Workspace, id: number) => {
        await runtime.close(id);
        runtime.release(id);
        setState((current) => model.removePane(current, owner.id, id));
    };
    const requestClosePane = (owner: model.Workspace, id: number) => {
        if (dialog) return;
        if (snapshot.sessions[id]?.status === "exited") {
            void closePane(owner, id).catch(runtime.report);
            return;
        }
        setDialog({
            title: "Dừng và đóng terminal?",
            body: (
                <p>
                    Process và tác vụ trong <strong>{model.findPane(owner.layout, id)?.title}</strong> sẽ dừng. Nội dung
                    ô này sẽ bị xóa.
                </p>
            ),
            danger: true,
            accept: "Dừng và đóng",
            submit: () => closePane(owner, id),
        });
    };
    const requestCloseWorkspace = (owner: model.Workspace) => {
        if (dialog) return;
        const ids = model.paneIds(owner.layout);
        const close = async () => {
            for (const id of ids) await closePane(owner, id);
            setState((current) => model.removeWorkspace(current, owner.id));
        };
        if (!ids.length) {
            void close().catch(runtime.report);
            return;
        }
        setDialog({
            title: "Đóng workspace?",
            body: (
                <p>
                    Dừng {ids.length} terminal trong <strong>{owner.name}</strong> và xóa bố cục của workspace này.
                </p>
            ),
            danger: true,
            accept: "Dừng và đóng",
            submit: close,
        });
    };
    const renameWorkspace = () => {
        if (!workspace || dialog) return;
        setDialog({
            title: "Đổi tên workspace",
            body: <p>Đổi tên hiển thị trên tab.</p>,
            fields: [{ name: "name", label: "Tên workspace", value: workspace.name }],
            submit: ({ name }) => setState((current) => model.renameWorkspace(current, workspace.id, name)),
        });
    };
    const actions = (owner: model.Workspace): LayoutActions => ({
        stop: (id) => {
            if (dialog || snapshot.sessions[id]?.status === "exited") return;
            setDialog({ title: "Dừng terminal?", body: <p>Dừng process và tác vụ con; giữ nguyên transcript của ô này.</p>,
                danger: true, accept: "Dừng process", submit: () => runtime.close(id) });
        },
        hide: (id) => setState((current) => model.togglePaneVisibility(current, owner.id, id)),
        only: (id) => setState((current) => model.showOnlyPane(current, owner.id, id)),
        select: (id) =>
            setState((current) => {
                const selected = current.workspaces.find((item) => item.id === owner.id)!;
                const unzoomed =
                    selected.zoomedPaneId !== null && selected.zoomedPaneId !== id
                        ? model.togglePaneZoom(current, owner.id, selected.zoomedPaneId)
                        : current;
                return model.activatePane(unzoomed, owner.id, id);
            }),
        rename: (id) => {
            if (!dialog)
                setDialog({
                    title: "Đổi tên terminal",
                    body: <p>Đặt tên để nhận ra tác vụ của ô này.</p>,
                    fields: [
                        {
                            name: "title",
                            label: "Tên terminal",
                            value: model.findPane(owner.layout, id)?.title ?? "Terminal",
                        },
                    ],
                    submit: ({ title }) => setState((current) => model.renamePane(current, owner.id, id, title)),
                });
        },
        close: (id) => requestClosePane(owner, id),
        split: (id, axis) => addPane(owner, axis, id),
        zoom: (id) => setState((current) => model.togglePaneZoom(current, owner.id, id)),
        ratio: (id, value) => setState((current) => model.setSplitRatio(current, owner.id, id, value)),

    });
    const quit = () => {
        const force = Boolean(snapshot.shutdownIssue);
        const exit = () => force ? runtime.forceQuit() : runtime.quit();
        const saveAndExit = async (forced = force) => {
            if (preferences.writable) await preferences.commit((value) => withDescriptors(value, state));
            await preferences.flush();
            await (forced ? runtime.forceQuit() : runtime.quit());
        };
        if (!dialog)
            setDialog({
                kind: "quit",
                title: force ? "Buộc dừng và thoát SLTerm?" : "Dừng và thoát SLTerm?",
                body: <><p>Tất cả terminal sẽ dừng. Tùy chỉnh và danh sách workspace được lưu; process và transcript không khôi phục sau khi thoát.</p>
                    {force && <><p role="alert">{snapshot.shutdownIssue}</p><p>Buộc thoát có thể làm mất output cuối chưa nhận được.</p>
                        <button type="button" className="button button-ghost" onClick={() => { void saveAndExit(false).then(() => setDialog(null)).catch(runtime.report); }}>Thử dừng lại</button></>}
                    {preferences.error && <><p role="alert">Chưa lưu được tùy chỉnh: {preferences.error}</p>
                        <button type="button" className="button button-danger" onClick={() => { void exit().catch(runtime.report); }}>{force ? "Buộc thoát không lưu tùy chỉnh" : "Thoát không lưu tùy chỉnh"}</button></>}</>,
                danger: true,
                accept: force ? "Buộc dừng và thoát" : "Dừng và thoát",
                submit: () => saveAndExit(),
            });
    };
    useEffect(() => {
        if (!snapshot.closeRequested || settingsOpen) return;
        if (dialog?.kind === "quit" || snapshot.phase === "stopping") {
            runtime.consumeCloseRequest();
        } else if (!dialog) {
            runtime.consumeCloseRequest();
            quit();
        }
    }, [snapshot.closeRequested, snapshot.phase, dialog, runtime, settingsOpen]);
    const dismissDialog = () => {
        // Coalesce title-bar close requests against the confirmation the user just answered.
        if (dialog?.kind === "quit") runtime.consumeCloseRequest();
        setDialog(null);
    };
    const changeFont = (delta: number | "reset") => {
        if (!workspace || !preferences.writable) return;
        const id = workspace.id;
        void preferences.commit((value) => {
            const appearance = appearanceFor(value, id);
            const terminalFontSize = delta === "reset" ? defaultAppearance.terminalFontSize : Math.max(8, Math.min(40, appearance.terminalFontSize + delta));
            return { ...value, overrides: { ...value.overrides, [id]: { ...value.overrides[id], appearance: { ...appearance, terminalFontSize } } } };
        }).catch(() => {});
    };
    const toggleLayout = () => workspace && setState((current) => model.setLayoutMode(current, workspace.id, workspace.layoutMode === "free" ? "tiled" : "free"));
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (dialog || searching || settingsOpen) return;
            const action = matchShortcut(event, shortcutsFor(preferences.value, workspace?.id));
            if (!action) return;
            const active = workspace?.activePaneId;
            const switchWorkspace = (delta: number) => {
                const index = state.workspaces.findIndex((item) => item.id === state.activeWorkspaceId);
                const next = state.workspaces[(index + delta + state.workspaces.length) % state.workspaces.length];
                if (next) setState((current) => model.activateWorkspace(current, next.id));
            };
            const callbacks: Record<ShortcutAction, () => void> = {
                newWorkspace, newTerminal: () => workspace && addPane(workspace),
                splitHorizontal: () => workspace && addPane(workspace, "horizontal"),
                splitVertical: () => workspace && addPane(workspace, "vertical"),
                closePane: () => workspace && active && requestClosePane(workspace, active),
                stopPane: () => workspace && active && actions(workspace).stop(active),
                zoomPane: () => workspace && active && actions(workspace).zoom(active),
                hidePane: () => workspace && active && actions(workspace).hide(active),
                showAllPanes: () => workspace && setState((current) => model.showAllPanes(current, workspace.id)),
                nextWorkspace: () => switchWorkspace(1), previousWorkspace: () => switchWorkspace(-1),
                search: () => active && setSearching(true),
                fontIncrease: () => changeFont(1), fontDecrease: () => changeFont(-1), fontReset: () => changeFont("reset"),
                toggleSidebar: () => setSidebar(!sidebar), settings: () => setSettingsOpen(true), toggleLayout,
            };
            event.preventDefault(); event.stopPropagation(); callbacks[action]();
        };
        window.addEventListener("keydown", keydown, true);
        return () => window.removeEventListener("keydown", keydown, true);
    });
    return {
        preferences, settingsOpen, setSettingsOpen, changeFont, toggleLayout,
        runtime,
        snapshot,
        state,
        setState,
        workspace,
        dialog,
        dismissDialog,
        sidebar,
        setSidebar,
        searching,
        setSearching,
        connected,
        addPane,
        newWorkspace,
        requestCloseWorkspace,
        renameWorkspace,
        actions,
        quit,
    };
}
