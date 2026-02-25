// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Lazy Monaco loader — defers the ~300KB monaco-editor bundle and all web workers
// until the first editor component mounts. Returns the monaco module instance.
//
// Before this change every worker and language contribution loaded at app startup.
// Now they only load when an editor block is first opened.

import type * as MonacoTypes from "monaco-editor";

// Single in-flight promise — concurrent callers share the same load.
let loadPromise: Promise<typeof MonacoTypes> | null = null;

export async function loadMonaco(): Promise<typeof MonacoTypes> {
    if (loadPromise != null) {
        return loadPromise;
    }

    loadPromise = (async () => {
        // Load core monaco and language contributions in parallel with workers.
        const [monacoModule, { MonacoSchemas }, { configureMonacoYaml }] = await Promise.all([
            import("monaco-editor"),
            import("@/app/monaco/schemaendpoints"),
            import("monaco-yaml"),
        ]);

        // Language contributions must be imported (side-effect only) before workers start.
        await Promise.all([
            import("monaco-editor/esm/vs/language/css/monaco.contribution"),
            import("monaco-editor/esm/vs/language/html/monaco.contribution"),
            import("monaco-editor/esm/vs/language/json/monaco.contribution"),
            import("monaco-editor/esm/vs/language/typescript/monaco.contribution"),
        ]);

        // Lazily import worker constructors.
        const [
            { default: EditorWorker },
            { default: CssWorker },
            { default: HtmlWorker },
            { default: JsonWorker },
            { default: TsWorker },
            { default: YmlWorker },
        ] = await Promise.all([
            import("monaco-editor/esm/vs/editor/editor.worker?worker"),
            import("monaco-editor/esm/vs/language/css/css.worker?worker"),
            import("monaco-editor/esm/vs/language/html/html.worker?worker"),
            import("monaco-editor/esm/vs/language/json/json.worker?worker"),
            import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
            import("./yamlworker?worker"),
        ]);

        // MonacoEnvironment must be set before any monaco API call that spawns a worker.
        window.MonacoEnvironment = {
            getWorker(_, label) {
                if (label === "json") return new JsonWorker();
                if (label === "css" || label === "scss" || label === "less") return new CssWorker();
                if (label === "yaml" || label === "yml") return new YmlWorker();
                if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
                if (label === "typescript" || label === "javascript") return new TsWorker();
                return new EditorWorker();
            },
        };

        monacoModule.editor.defineTheme("wave-theme-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#00000000",
                "editorStickyScroll.background": "#00000055",
                "minimap.background": "#00000077",
                focusBorder: "#00000000",
            },
        });
        monacoModule.editor.defineTheme("wave-theme-light", {
            base: "vs",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#fefefe",
                focusBorder: "#00000000",
            },
        });
        configureMonacoYaml(monacoModule, {
            validate: true,
            schemas: [],
        });
        monacoModule.editor.setTheme("wave-theme-dark");
        // Disable default validation errors for typescript and javascript.
        monacoModule.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
        });
        monacoModule.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: false,
            enableSchemaRequest: true,
            schemas: MonacoSchemas,
        });

        return monacoModule;
    })();

    return loadPromise;
}
