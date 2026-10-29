import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EditorState, documentDirty } from "./editor-state";
import { ProjectExplorer } from "./project-explorer";
import { ProjectCodeEditor } from "./project-code-editor";
import type { ProjectRequest } from "./project-files";
import { Icon } from "./workspace-icons";
import "./project-editor.css";

export type ProjectEditorProps = {
    root: string;
    request: ProjectRequest;
    onClose: () => void;
    onDirtyChange?: (dirty: boolean) => void;
    onControllerReady?: (controller: EditorState | null) => void;
};
type Pending = { kind: "panel" } | { kind: "tab" | "reload"; path: string };

export function ProjectEditor({ root, request, onClose, onDirtyChange, onControllerReady }: ProjectEditorProps) {
    const requestRef = useRef(request);
    requestRef.current = request;
    const send = useCallback<ProjectRequest>((method, args) => requestRef.current(method, args), []);
    const state = useMemo(() => new EditorState(root, send), [root, send]);
    const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot);
    const [pending, setPending] = useState<Pending | null>(null);
    const [saveProblem, setSaveProblem] = useState<string | null>(null);
    const pendingRef = useRef<Pending | null>(null);
    const changePending = (value: Pending | null) => { pendingRef.current = value; setPending(value); setSaveProblem(null); };
    const [explorerVisible, setExplorerVisible] = useState(true);
    const dirty = state.hasUnsaved();
    const anySaving = snapshot.documents.some((document) => document.saving);
    const active = snapshot.documents.find((document) => document.path === snapshot.active);
    const panel = useRef<HTMLElement>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const callbacks = useRef({ onDirtyChange, onControllerReady });
    callbacks.current = { onDirtyChange, onControllerReady };
    useEffect(() => { callbacks.current.onDirtyChange?.(dirty); }, [dirty, state]);
    useEffect(() => {
        state.activate();
        callbacks.current.onControllerReady?.(state);
        return () => { state.dispose(); callbacks.current.onControllerReady?.(null); callbacks.current.onDirtyChange?.(false); };
    }, [state]);
    useEffect(() => {
        if (pending && dialog.current && !dialog.current.open) dialog.current.showModal();
        if (!pending && dialog.current?.open) dialog.current.close();
    }, [pending]);
    const finish = (intent: Pending, discard = false) => {
        if (state.getSnapshot().documents.some((document) => document.saving)) return;
        if (intent.kind === "panel") {
            if (!discard && state.hasUnsaved()) return;
            if (discard) for (const document of state.getSnapshot().documents) {
                if (documentDirty(document)) state.remove(document.path, true);
            }
            onClose();
        } else if (intent.kind === "tab") state.remove(intent.path, discard);
        else void state.reload(intent.path);
        changePending(null);
    };
    const askClose = (intent: Pending) => {
        const document = intent.kind !== "panel" ? snapshot.documents.find((item) => item.path === intent.path) : null;
        if (intent.kind === "panel" ? dirty : document && (documentDirty(document) || document.saving)) changePending(intent);
        else finish(intent);
    };
    const savePending = async () => {
        const intent = pendingRef.current;
        if (!intent || intent.kind === "reload") return;
        const saved = intent.kind === "panel" ? await state.saveAll() : await state.save(intent.path);
        if (pendingRef.current !== intent) return;
        // A later edit during an awaited write keeps this confirmation open.
        const remaining = state.getSnapshot().documents;
        if (saved && (intent.kind === "panel" ? !state.hasUnsaved() : !remaining.some((document) => document.path === intent.path && documentDirty(document)))) finish(intent);
        else {
            const unresolved = remaining.find((document) => (intent.kind === "panel" || document.path === intent.path) && (documentDirty(document) || document.saving));
            if (unresolved) state.select(unresolved.path);
            setSaveProblem(unresolved?.error ?? "Vẫn có thay đổi chưa lưu. Bộ đệm được giữ; quay lại để kiểm tra.");
        }
    };
    return <section className="project-editor" ref={panel} aria-label="Trình soạn thảo dự án" onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
            event.preventDefault(); event.stopPropagation();
            if (!pending && snapshot.active) void state.save(snapshot.active);
        }
    }}>
        <header className="project-editor-header"><div><button className="icon-button" aria-label={explorerVisible ? "Ẩn tệp dự án" : "Hiện tệp dự án"} aria-pressed={explorerVisible} onClick={() => setExplorerVisible((value) => !value)}><Icon name="sidebar" /></button><Icon name="folder" /><strong>Dự án</strong><span title={root}>{root}</span></div><button className="icon-button" aria-label="Đóng trình soạn thảo" title="Đóng trình soạn thảo" onClick={() => askClose({ kind: "panel" })}><Icon name="close" /></button></header>
        <div className="project-editor-body" data-explorer={explorerVisible}>
            {explorerVisible && <ProjectExplorer root={root} request={send} active={snapshot.active} onOpen={(path) => { void state.open(path); if ((panel.current?.clientWidth ?? 1000) <= 620) setExplorerVisible(false); }} />}
            <div className="project-editor-main">
                <div className="project-editor-tabs" aria-label="Tệp đang mở">
                    {snapshot.documents.map((document) => <div className="project-editor-tab" data-active={document.path === snapshot.active} key={document.id}>
                        <button title={document.path} aria-current={document.path === snapshot.active ? "page" : undefined} onClick={() => state.select(document.path)}><span>{document.path.split(/[\\/]/).at(-1)}</span>{(documentDirty(document) || document.saving) && <span className="project-dirty-dot" aria-label={document.saving ? "Đang lưu" : "Chưa lưu"}>●</span>}</button>
                        <button className="tab-close" aria-label={`Đóng ${document.path}`} onClick={() => askClose({ kind: "tab", path: document.path })}><Icon name="close" size={14} /></button>
                    </div>)}
                </div>
                {active ? <>
                    <div className="project-editor-toolbar"><span title={active.path}>{active.path}</span><div>
                        <button className="button button-ghost" disabled={active.loading || !active.revision} aria-pressed={active.diff} onClick={() => state.toggleDiff(active.path)}>{active.diff ? "Soạn thảo" : "So sánh thay đổi"}</button>
                        <button className="button" disabled={active.loading || active.saving} onClick={() => void state.compareDisk(active.path)}>Bản trên đĩa</button>
                        <button className="button button-primary" title="Lưu · Ctrl S" disabled={active.loading || active.saving || !active.revision || !documentDirty(active)} onClick={() => void state.save(active.path)}>{active.saving ? "Đang lưu…" : "Lưu"}</button>
                    </div></div>
                    {active.error && <div className="project-editor-error" role="alert"><span>{active.error}</span><button className="button" disabled={active.saving} onClick={() => askClose({ kind: "reload", path: active.path })}>Tải lại</button></div>}
                    {active.conflict && <div className="project-conflict" role="status"><span>Trái: bản trên đĩa · Phải: bộ đệm của bạn</span><div><button className="button" disabled={active.saving} onClick={() => state.toggleDiff(active.path)}>{active.diff ? "Ẩn so sánh" : "So sánh"}</button><button className="button" disabled={active.saving} onClick={() => askClose({ kind: "reload", path: active.path })}>Tải lại từ đĩa</button><button className="button button-danger" disabled={active.saving} onClick={() => void state.save(active.path, true)}>Ghi đè bản trên đĩa</button></div></div>}
                    {active.diff && !active.conflict && <div className="project-diff-label">Trái: bản đã mở/lưu · Phải: bộ đệm hiện tại</div>}
                    <div className="project-editor-content">
                        {snapshot.documents.map((document) => <div key={document.id} className="project-document" hidden={document.path !== snapshot.active}>
                            {document.loading ? <div className="project-editor-placeholder" role="status">Đang đọc tệp…</div> : !document.revision ? <div className="project-editor-placeholder"><p>Chưa thể mở tệp này.</p><button className="button" onClick={() => void state.reload(document.path)}>Đọc lại</button></div> : <ProjectCodeEditor path={document.path} text={document.text} original={document.conflict?.text ?? document.savedText} diff={document.diff} onChange={(text) => state.edit(document.path, text)} onSave={() => void state.save(document.path)} />}
                        </div>)}
                    </div>
                    <footer className="project-editor-status" role="status"><span>{active.saving ? "Đang lưu…" : documentDirty(active) ? "Chưa lưu" : active.revision ? "Đã lưu" : "Chưa mở được tệp"}</span><span>UTF-8</span></footer>
                </> : <div className="project-editor-placeholder"><Icon name="folder" size={28} /><h2>Mở tệp trong dự án</h2><p>Chọn tệp bên trái hoặc tìm theo tên. Ctrl S để lưu.</p></div>}
            </div>
        </div>
        <dialog className="app-dialog project-close-dialog" ref={dialog} onCancel={(event) => { event.preventDefault(); changePending(null); }}>
            <div className="dialog-heading"><h2>{pending?.kind === "reload" ? "Tải lại từ đĩa?" : "Thay đổi chưa lưu"}</h2></div>
            <div className="dialog-body"><p>{pending?.kind === "reload" ? "Tải lại sẽ thay bộ đệm hiện tại bằng nội dung mới nhất trên đĩa." : "Lưu thay đổi trước khi đóng, hoặc bỏ thay đổi trong bộ đệm."}</p>{pending && pending.kind !== "panel" && <strong>{pending.path}</strong>}{anySaving && <p role="status">Đang lưu tệp. Chờ kết quả trước khi đóng.</p>}{saveProblem && <p className="dialog-error" role="alert">{saveProblem}</p>}</div>
            <div className="dialog-actions"><button className="button" autoFocus onClick={() => changePending(null)}>Quay lại</button><button className="button button-danger" disabled={anySaving} onClick={() => pending && finish(pending, true)}>{pending?.kind === "reload" ? "Tải lại" : "Bỏ thay đổi"}</button>{pending?.kind !== "reload" && <button className="button button-primary" disabled={anySaving} onClick={() => void savePending()}>Lưu rồi đóng</button>}</div>
        </dialog>
    </section>;
}
