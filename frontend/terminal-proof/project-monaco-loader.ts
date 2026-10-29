import type * as Monaco from "monaco-editor";

let pending: Promise<typeof Monaco> | undefined;
const languageContributions = import.meta.glob("../../node_modules/monaco-editor/esm/vs/basic-languages/*/*.contribution.js");

/** Core worker and syntax languages are bundled locally; no remote worker or language service. */
export function loadProjectMonaco(): Promise<typeof Monaco> {
    return pending ??= (async () => {
        const [{ default: EditorWorker }, { default: JsonWorker }, monaco] = await Promise.all([
            import("monaco-editor/esm/vs/editor/editor.worker?worker"),
            import("monaco-editor/esm/vs/language/json/json.worker?worker"),
            import("monaco-editor/esm/vs/editor/editor.api.js") as unknown as Promise<typeof Monaco>,
        ]);
        (window as Window & { MonacoEnvironment?: Monaco.Environment }).MonacoEnvironment = {
            getWorker: (_id, label) => label === "json" ? new JsonWorker() : new EditorWorker(),
        };
        await import("monaco-editor/esm/vs/basic-languages/_.contribution.js");
        await import("monaco-editor/esm/vs/language/json/monaco.contribution.js");
        return monaco;
    })().catch((error) => { pending = undefined; throw error; });
}

export async function loadProjectLanguage(language: string) {
    // Register the selected Monarch grammar, then Monaco loads its tokenizer on demand.
    const contribution = languageContributions[`../../node_modules/monaco-editor/esm/vs/basic-languages/${language}/${language}.contribution.js`];
    if (contribution) await contribution();
}

export function projectLanguage(path: string): string {
    const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
    if (name === "dockerfile") return "dockerfile";
    const extensions: Record<string, string> = {
        js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript",
        json: "json", jsonc: "json", md: "markdown", markdown: "markdown", css: "css", scss: "scss", less: "less",
        html: "html", htm: "html", xml: "xml", svg: "xml", yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini",
        rs: "rust", go: "go", py: "python", sh: "shell", bash: "shell", ps1: "powershell", sql: "sql",
        c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", java: "java", kt: "kotlin", zig: "plaintext",
    };
    return extensions[name.split(".").at(-1) ?? ""] ?? "plaintext";
}
