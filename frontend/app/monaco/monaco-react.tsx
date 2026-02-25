// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// React components that host Monaco editor instances.
// Monaco is loaded lazily via loadMonaco() — no eager import of monaco-editor at startup.

import { loadMonaco } from "@/app/monaco/monaco-env";
import type * as MonacoTypes from "monaco-editor";
import { useEffect, useRef } from "react";
import { debounce } from "throttle-debounce";

type CodeEditorProps = {
    text: string;
    readonly: boolean;
    language?: string;
    onChange?: (text: string) => void;
    onMount?: (editor: MonacoTypes.editor.IStandaloneCodeEditor, monacoApi: typeof MonacoTypes) => () => void;
    path: string;
    options: MonacoTypes.editor.IEditorOptions;
};

export function MonacoCodeEditor({
    text,
    readonly,
    language,
    onChange,
    onMount,
    path,
    options,
}: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
    const onUnmountRef = useRef<(() => void) | null>(null);
    const applyingFromProps = useRef(false);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const monaco = await loadMonaco();
            if (cancelled) return;

            const el = divRef.current;
            if (!el) return;

            const uri = monaco.Uri.parse(`wave://editor/${encodeURIComponent(path)}`);
            const model = monaco.editor.createModel(text, language, uri);
            console.log("[monaco] CREATE MODEL", path, model);

            const editor = monaco.editor.create(el, {
                ...options,
                readOnly: readonly,
                model,
            });
            editorRef.current = editor;

            const sub = model.onDidChangeContent(() => {
                if (applyingFromProps.current) return;
                onChange?.(model.getValue());
            });

            if (onMount) {
                onUnmountRef.current = onMount(editor, monaco);
            }
        })();

        return () => {
            cancelled = true;
            if (onUnmountRef.current) onUnmountRef.current();
            editorRef.current?.dispose();
            editorRef.current = null;
        };
        // mount/unmount only
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        const el = divRef.current;
        if (!editor || !el) return;

        const debouncedLayout = debounce(100, () => {
            editor.layout();
        });
        const resizeObserver = new ResizeObserver(debouncedLayout);
        resizeObserver.observe(el);

        return () => {
            resizeObserver.disconnect();
            debouncedLayout.cancel();
        };
    }, []);

    // Keep model value in sync with props.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;

        const current = model.getValue();
        if (current === text) return;

        applyingFromProps.current = true;
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
        applyingFromProps.current = false;
    }, [text]);

    // Keep options in sync.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.updateOptions({ ...options, readOnly: readonly });
    }, [options, readonly]);

    // Keep language in sync.
    useEffect(() => {
        (async () => {
            const editor = editorRef.current;
            if (!editor || !language) return;
            const model = editor.getModel();
            if (!model) return;
            const monaco = await loadMonaco();
            monaco.editor.setModelLanguage(model, language);
        })();
    }, [language]);

    return <div className="flex flex-col h-full w-full" ref={divRef} />;
}

type DiffViewerProps = {
    original: string;
    modified: string;
    language?: string;
    path: string;
    options: MonacoTypes.editor.IDiffEditorOptions;
};

export function MonacoDiffViewer({ original, modified, language, path, options }: DiffViewerProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const diffRef = useRef<MonacoTypes.editor.IStandaloneDiffEditor | null>(null);

    // Create once.
    useEffect(() => {
        let cancelled = false;

        (async () => {
            const monaco = await loadMonaco();
            if (cancelled) return;

            const el = divRef.current;
            if (!el) return;

            const origUri = monaco.Uri.parse(`wave://diff/${encodeURIComponent(path)}.orig`);
            const modUri = monaco.Uri.parse(`wave://diff/${encodeURIComponent(path)}.mod`);

            const originalModel = monaco.editor.createModel(original, language, origUri);
            const modifiedModel = monaco.editor.createModel(modified, language, modUri);

            const diff = monaco.editor.createDiffEditor(el, options);
            diffRef.current = diff;

            diff.setModel({ original: originalModel, modified: modifiedModel });
        })();

        return () => {
            cancelled = true;
            diffRef.current?.dispose();
            diffRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const diff = diffRef.current;
        const el = divRef.current;
        if (!diff || !el) return;

        const debouncedLayout = debounce(100, () => {
            diff.layout();
        });
        const resizeObserver = new ResizeObserver(debouncedLayout);
        resizeObserver.observe(el);

        return () => {
            resizeObserver.disconnect();
            debouncedLayout.cancel();
        };
    }, []);

    // Update models on prop change.
    useEffect(() => {
        const diff = diffRef.current;
        if (!diff) return;
        const model = diff.getModel();
        if (!model) return;

        if (model.original.getValue() !== original) model.original.setValue(original);
        if (model.modified.getValue() !== modified) model.modified.setValue(modified);

        if (language) {
            (async () => {
                const monaco = await loadMonaco();
                monaco.editor.setModelLanguage(model.original, language);
                monaco.editor.setModelLanguage(model.modified, language);
            })();
        }
    }, [original, modified, language]);

    useEffect(() => {
        const diff = diffRef.current;
        if (!diff) return;
        diff.updateOptions(options);
    }, [options]);

    return <div className="flex flex-col h-full w-full" ref={divRef} />;
}
