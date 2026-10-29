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
import type { EditorState } from "./editor-state";
import type { AiProvider } from "./ai-cli";
import { parseRemoteConnection, remoteLabel, type RemoteProtocol } from "./remote";

export function useWorkspaceController(runtime: TerminalRuntime) {
    const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
    const [state, setState] = useState<model.WorkspaceState>({ workspaces: [], activeWorkspaceId: null });
    const [dialog, setDialog] = useState<DialogSpec | null>(null);
    const [sidebar, setSidebar] = useState(true);
    const [searching, setSearching] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const preferences = useWorkspacePreferences(runtime);
    const [hydrated, setHydrated] = useState(false);
    const [defaultCwd, setDefaultCwd] = useState("");
    const focusOwner = useRef<"terminal" | "editor">("terminal");
    useEffect(() => {
        const onFocus = (event: FocusEvent) => {
            if (!(event.target instanceof HTMLElement)) return;
            if (event.target.closest(".project-editor")) focusOwner.current = "editor";
            else if (event.target.closest(".terminal-pane")) focusOwner.current = "terminal";
        };
        document.addEventListener("focusin", onFocus);
        return () => document.removeEventListener("focusin", onFocus);
    }, []);
    const serial = useRef({ pane: 0, workspace: 0, split: 0 });
    const nextSerial = (key: keyof typeof serial.current) => {
        const value = serial.current[key] + 1;
        if (!Number.isSafeInteger(value)) throw new Error("Hết miền định danh an toàn; không khởi chạy thêm process.");
        serial.current[key] = value;
        return value;
    };
    const editors = useRef(new Map<string, EditorState>());
    const [editorDirty, setEditorDirty] = useState<Record<string, boolean>>({});
    const editorController = (id: string, controller: EditorState | null) => {
        if (controller) editors.current.set(id, controller); else editors.current.delete(id);
    };
    const editorChanged = (id: string, dirty: boolean) => setEditorDirty((current) =>
        current[id] === dirty ? current : { ...current, [id]: dirty });
    const ensureEditorsIdle = (id?: string) => {
        const selected = id ? [editors.current.get(id)] : [...editors.current.values()];
        if (selected.some((editor) => editor?.getSnapshot().documents.some((document) => document.saving)))
            throw new Error("Đang lưu tệp. Chờ kết quả trước khi đóng.");
    };
    const workspace = model.activeWorkspace(state);
    const connected = snapshot.phase === "connected" && hydrated;
    const splitId = () => `split-${nextSerial("split")}`;
    const addPane = (owner: model.Workspace, axis?: model.Axis, target = owner.activePaneId) => {
        if (!connected) return;
        try {
            const paneId = nextSerial("pane");
            const id = splitId();
            const runId = runtime.prepare(paneId, owner.cwd, terminalAppearance(appearanceFor(preferences.value, owner.id)), owner.id);
            setState((current) =>
                axis ? model.splitPane(current, owner.id, target, { paneId, title: `Terminal ${paneId}`, runId }, id, axis)
                    : model.addTerminal(current, owner.id, { paneId, title: `Terminal ${paneId}`, runId })
            );
        } catch (error) { runtime.report(error); }
    };
    const openProvider = (provider: AiProvider) => {
        if (!workspace || !connected || dialog) return undefined;
        const paneId = nextSerial("pane");
        try {
            const command = runtime.providerCommand(provider);
            const runId = runtime.prepare(paneId, workspace.cwd,
                terminalAppearance(appearanceFor(preferences.value, workspace.id)), workspace.id, command);
            const label = provider === "claude" ? "Claude CLI" : "Codex CLI";
            setState((current) => model.addTerminal(current, workspace.id, {
                paneId, title: `${label} · Terminal ${paneId}`, runId, provider,
            }));
        } catch (error) {
            runtime.report(error);
            throw error;
        }
        return paneId;
    };
    const openRemote = (protocol: RemoteProtocol, values: Record<string, string>) => {
        if (!workspace || !connected || dialog) return;
        const connection = parseRemoteConnection({ protocol, host: values.host, user: values.user, port: values.port });
        const paneId = nextSerial("pane");
        const runId = runtime.prepare(paneId, workspace.cwd,
            terminalAppearance(appearanceFor(preferences.value, workspace.id)), workspace.id, runtime.remoteCommand(connection));
        setState((current) => model.addTerminal(current, workspace.id, {
            paneId, title: `${remoteLabel(connection)} · Terminal ${paneId}`, runId, remote: connection,
        }));
    };
    const openRemoteDialog = (protocol: RemoteProtocol) => {
        if (!workspace || !connected || dialog) return;
        const label = protocol === "ssh" ? "SSH" : "SFTP";
        setDialog({
            title: `Mở kết nối ${label}`,
            body: <><p>SLTerm dùng OpenSSH có sẵn trên Windows. Host key vẫn do OpenSSH xác minh trong terminal; không tự chấp nhận key mới và không lưu mật khẩu.</p><p className="field-hint">Nếu host key thay đổi, kết nối sẽ bị OpenSSH chặn để bạn xử lý thủ công.</p></>,
            fields: [
                { name: "host", label: "Host / IP", value: "", hint: "Ví dụ: server.example.com hoặc 192.168.1.20" },
                { name: "user", label: "User (không bắt buộc)", value: "", required: false, hint: "Để trống để OpenSSH dùng user mặc định." },
                { name: "port", label: "Port", value: "22", inputMode: "numeric" },
            ],
            accept: `Mở ${label}`,
            submit: (values) => openRemote(protocol, values),
        });
    };
    const openAiDialog = () => {
        if (!workspace || !connected || dialog) return;
        setDialog({
            title: "Mở AI CLI",
            body: <p>Chạy CLI nguyên bản trong một terminal riêng của workspace. SLTerm không nhận hoặc sao chép token; lần đầu dùng provider có thể yêu cầu đăng nhập trong CLI.</p>,
            actions: [
                { label: "Mở Claude CLI", run: () => { openProvider("claude"); } },
                { label: "Mở Codex CLI", run: () => { openProvider("codex"); } },
            ],
        });
    };
    useEffect(() => {
        let mounted = true;
        void Promise.all([runtime.start(), preferences.load().catch((error) => { runtime.report(error); return null; })])
            .then(([environment, saved]) => {
                if (!mounted) return;
                setDefaultCwd(environment.cwd);
                if (saved && preferences.existed.current) {
                    const restored = restoreDescriptors(saved);
                    serial.current = model.workspaceIdentitySeed(restored);
                    for (const owner of restored.workspaces) for (const id of model.paneIds(owner.layout)) {
                        const pane = model.findPane(owner.layout, id);
                        const command = pane?.remote ? runtime.remoteCommand(pane.remote)
                            : pane?.provider ? runtime.providerCommand(pane.provider) : undefined;
                        runtime.restore(id, owner.cwd, pane?.runId,
                            terminalAppearance(appearanceFor(saved, owner.id)), owner.id, command);
                    }
                    setState(restored); setHydrated(true); return;
                }
                const owner = model.createWorkspace(
                    crypto.randomUUID(),
                    "Workspace",
                    environment.cwd
                );
                const paneId = nextSerial("pane");
                nextSerial("workspace");
                const runId = runtime.prepare(paneId, owner.cwd, terminalAppearance(appearanceFor(saved ?? preferences.value)), owner.id);
                setState(model.addTerminal(model.addWorkspace({ workspaces: [], activeWorkspaceId: null }, owner), owner.id, { paneId, title: `Terminal ${paneId}`, runId }));
                setHydrated(true);
            })
            .catch(runtime.report);
        return () => {
            mounted = false;
        };
    }, [runtime]);
    const descriptors = JSON.stringify(state);
    useEffect(() => {
        if (!hydrated || !preferences.writable) return;
        const timer = setTimeout(() => { void preferences.commit((value) => withDescriptors(value, state)).catch(() => {}); }, 200);
        return () => clearTimeout(timer);
    }, [descriptors, hydrated, preferences.writable]);
    useEffect(() => {
        for (const owner of state.workspaces)
            runtime.applyAppearance(model.paneIds(owner.layout), terminalAppearance(appearanceFor(preferences.value, owner.id)));
    }, [preferences.value, state.workspaces.length, runtime]);
    useEffect(() => {
        runtime.scheduleResize();
        if (!dialog && !searching && !settingsOpen && (focusOwner.current !== "editor" || !workspace || !editors.current.has(workspace.id))) runtime.focus(workspace?.activePaneId ?? null);
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
                nextSerial("workspace");
                const owner = model.createWorkspace(crypto.randomUUID(), name, directory);
                const paneId = nextSerial("pane");
                const runId = runtime.prepare(paneId, owner.cwd, terminalAppearance(appearanceFor(preferences.value, owner.id)), owner.id);
                setState((current) => model.addTerminal(model.addWorkspace(current, owner), owner.id, { paneId, title: `Terminal ${paneId}`, runId }));
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
        const dirty = editors.current.get(owner.id)?.hasUnsaved();
        const close = async () => {
            ensureEditorsIdle(owner.id);
            for (const id of ids) await closePane(owner, id);
            setState((current) => model.removeWorkspace(current, owner.id));
        };
        if (!ids.length && !dirty) {
            void close().catch(runtime.report);
            return;
        }
        setDialog({
            title: "Đóng workspace?",
            body: (
                <p>
                    Dừng {ids.length} terminal trong <strong>{owner.name}</strong> và xóa bố cục của workspace này.
                    {dirty && <> Nội dung file chưa lưu sẽ bị bỏ. Bạn có thể hủy để lưu trong editor.</>}
                </p>
            ),
            danger: true,
            accept: dirty ? "Bỏ thay đổi và đóng workspace" : "Dừng và đóng",
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
        const hasUnsaved = [...editors.current.values()].some((editor) => editor.hasUnsaved());
        const exit = () => { ensureEditorsIdle(); return force ? runtime.forceQuit() : runtime.quit(); };
        const saveAndExit = async (forced = force) => {
            ensureEditorsIdle();
            if (preferences.writable) await preferences.commit((value) => withDescriptors(value, state));
            await preferences.flush();
            await (forced ? runtime.forceQuit() : runtime.quit());
        };
        if (!dialog)
            setDialog({
                kind: "quit",
                title: force ? "Buộc dừng và thoát SLTerm?" : "Dừng và thoát SLTerm?",
                body: <><p>Tất cả terminal sẽ dừng. Bố cục và phần lịch sử đã ghi được giữ để mở lại; các process không tự khởi chạy lại.</p>
                    {hasUnsaved && <p role="alert">Có file chưa lưu trong editor. Đóng sẽ bỏ phần nội dung chưa lưu.</p>}
                    {force && <><p role="alert">{snapshot.shutdownIssue}</p><p>Buộc thoát có thể làm mất output cuối chưa nhận được.</p></>}
                    {preferences.error && <p role="alert">Chưa lưu được tùy chỉnh: {preferences.error}</p>}</>,
                actions: [
                    ...(!force && snapshot.phase !== "disconnected" ? [{ label: "Chạy nền", run: runtime.background }] : []),
                    ...(hasUnsaved ? [{ label: "Lưu mọi file rồi thoát", run: async () => {
                        for (const editor of editors.current.values()) if (!await editor.saveAll() || editor.hasUnsaved())
                            throw new Error("File chưa lưu xong hoặc có xung đột. Quay lại editor để xử lý.");
                        await saveAndExit();
                    } }] : []),
                    ...(force ? [{ label: "Thử dừng lại", run: () => saveAndExit(false) }] : []),
                    ...(preferences.error ? [{ label: force ? "Buộc thoát không lưu tùy chỉnh" : "Thoát không lưu tùy chỉnh", danger: true, run: exit }] : []),
                ],
                danger: true,
                accept: hasUnsaved ? "Bỏ thay đổi, dừng và thoát" : force ? "Buộc dừng và thoát" : "Dừng và thoát",
                submit: async () => {
                    try {
                        await saveAndExit();
                    } catch (error) {
                        // A failed native shutdown must leave the confirmation
                        // surface so the runtime error banner and the next
                        // explicit force-quit confirmation remain reachable.
                        setDialog(null);
                        throw error;
                    }
                },
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
            if (event.target instanceof HTMLElement && event.target.closest(".project-editor") &&
                ["search", "closePane", "stopPane", "fontIncrease", "fontDecrease", "fontReset"].includes(action)) return;
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
        editorController, editorChanged, editorDirty,
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
        openProvider,
        openAiDialog,
        openRemoteDialog,
        actions,
        quit,
    };
}
