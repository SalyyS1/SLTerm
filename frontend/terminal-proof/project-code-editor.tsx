import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { loadProjectLanguage, loadProjectMonaco, projectLanguage } from "./project-monaco-loader";
import { projectError } from "./project-files";

type Props = { path: string; text: string; original: string; diff: boolean; onChange: (text: string) => void; onSave: () => void };
type Live = {
    modified: Monaco.editor.ITextModel;
    original: Monaco.editor.ITextModel;
    editor: Monaco.editor.IStandaloneCodeEditor | Monaco.editor.IStandaloneDiffEditor;
    monaco: typeof Monaco;
};

export function ProjectCodeEditor(props: Props) {
    const container = useRef<HTMLDivElement>(null);
    const latest = useRef(props);
    latest.current = props;
    const live = useRef<Live | null>(null);
    const applying = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        let cleanup: (() => void) | undefined;
        setReady(false);
        setError(null);
        void loadProjectMonaco().then(async (monaco) => {
            if (cancelled || !container.current) return;
            const current = latest.current;
            const language = projectLanguage(current.path);
            await loadProjectLanguage(language);
            if (cancelled || !container.current) return;
            const modified = monaco.editor.createModel(current.text, language);
            const original = monaco.editor.createModel(current.original, language);
            const resources: { dispose: () => void }[] = [modified, original];
            cleanup = () => {
                for (const resource of resources.reverse()) resource.dispose();
                live.current = null;
            };
            const token = (name: string, fallback: string) => getComputedStyle(container.current!).getPropertyValue(name).trim() || fallback;
            const updateTheme = () => {
                if (!container.current) return;
                monaco.editor.defineTheme("slterm-project", {
                    base: document.body.dataset.theme === "light" ? "vs" : "vs-dark", inherit: true, rules: [],
                    colors: { "editor.background": token("--surface", "#10161e"), "editor.foreground": token("--text", "#d4dce9"),
                        "editorLineNumber.foreground": token("--text-dim", "#7f90a5"), "editorCursor.foreground": token("--accent", "#7bc4ba"),
                        "editor.selectionBackground": token("--selection-bg", "#284c4d"), "focusBorder": "#00000000" },
                });
                monaco.editor.setTheme("slterm-project");
            };
            updateTheme();
            const options: Monaco.editor.IStandaloneEditorConstructionOptions = {
                automaticLayout: true, fontFamily: token("--font-mono", "Consolas, monospace"),
                fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 12 },
                ariaLabel: current.path, renderWhitespace: "selection", tabSize: 4,
                // This editor has syntax grammars only. Monaco's semantic
                // highlighter leaves an unhandled delayed cancellation on view disposal.
                occurrencesHighlight: "off",
            };
            const editor = current.diff ? monaco.editor.createDiffEditor(container.current, {
                ...options, originalEditable: false, readOnly: false, renderSideBySide: true,
                useInlineViewWhenSpaceIsLimited: true, enableSplitViewResizing: true,
            }) : monaco.editor.create(container.current, { ...options, model: modified });
            resources.push(editor);
            if (current.diff) (editor as Monaco.editor.IStandaloneDiffEditor).setModel({ original, modified });
            live.current = { editor, modified, original, monaco };
            const changed = modified.onDidChangeContent(() => {
                if (!applying.current) latest.current.onChange(modified.getValue(undefined, true));
            });
            resources.push(changed);
            const saveAction = (current.diff ? (editor as Monaco.editor.IStandaloneDiffEditor).getModifiedEditor() : editor as Monaco.editor.IStandaloneCodeEditor).addAction({
                id: "slterm.save-project-file", label: "Lưu tệp", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
                run: () => latest.current.onSave(),
            });
            resources.push(saveAction);
            const observer = new MutationObserver(updateTheme);
            resources.push({ dispose: () => observer.disconnect() });
            observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme", "style"] });
            setReady(true);
        }).catch((reason) => {
            cleanup?.(); cleanup = undefined;
            if (!cancelled) setError(projectError(reason));
        });
        return () => { cancelled = true; cleanup?.(); };
    }, [props.path, props.diff, attempt]);
    useEffect(() => {
        const current = live.current;
        if (!current) return;
        applying.current = true;
        try {
            if (current.modified.getValue(undefined, true) !== props.text) current.modified.setValue(props.text);
            if (current.original.getValue(undefined, true) !== props.original) current.original.setValue(props.original);
        } finally { applying.current = false; }
    }, [props.text, props.original]);
    return <div className="project-monaco-shell">
        <div ref={container} className="project-monaco" />
        {!ready && <div className="project-editor-placeholder" role={error ? "alert" : "status"}>
            {error ? <><p>Không tải được trình soạn thảo: {error}</p><button className="button" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></> : "Đang tải trình soạn thảo…"}
        </div>}
    </div>;
}
