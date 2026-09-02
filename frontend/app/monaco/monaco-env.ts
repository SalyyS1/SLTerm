// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Lazy Monaco loader — nothing here loads until the first editor component mounts.
// Returns the monaco module instance.

import type * as MonacoTypes from "monaco-editor";

// Single in-flight promise — concurrent callers share the same load.
let loadPromise: Promise<typeof MonacoTypes> | null = null;

export async function loadMonaco(): Promise<typeof MonacoTypes> {
    if (loadPromise != null) {
        return loadPromise;
    }

    loadPromise = (async () => {
        // editor.api, not the "monaco-editor" entry point. That entry is
        // editor.main, which bundles every language *service*: the TypeScript one
        // alone pulls in the whole TS compiler as a 13 MB worker, to serve an
        // editor whose semantic validation is switched off below anyway. Syntax
        // highlighting comes from a different module and is kept in full.
        //
        // Cast because editor.api's own .d.ts declares a global namespace rather
        // than exporting one. Callers keep the full monaco-editor types; the only
        // members missing at runtime are the language services dropped here, and
        // nothing outside this file touches them.
        const [monacoModule, { MonacoSchemas }] = await Promise.all([
            import("monaco-editor/esm/vs/editor/editor.api") as unknown as Promise<typeof MonacoTypes>,
            import("@/app/monaco/schemaendpoints"),
        ]);

        // Registers all ~90 basic languages behind lazy loaders, so every file type
        // keeps its highlighting and none of them cost anything until one is opened.
        await import("monaco-editor/esm/vs/basic-languages/_.contribution");
        // The one language service worth its worker: it is what validates SLTerm's
        // own config against the schemas set below.
        await import("monaco-editor/esm/vs/language/json/monaco.contribution");

        const [{ default: EditorWorker }, { default: JsonWorker }] = await Promise.all([
            import("monaco-editor/esm/vs/editor/editor.worker?worker"),
            import("monaco-editor/esm/vs/language/json/json.worker?worker"),
        ]);

        // MonacoEnvironment must be set before any monaco API call that spawns a worker.
        window.MonacoEnvironment = {
            getWorker(_, label) {
                if (label === "json") return new JsonWorker();
                // Every other language runs on the base worker: highlighting and
                // editing work, completions and diagnostics do not.
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
        monacoModule.editor.setTheme("wave-theme-dark");
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
