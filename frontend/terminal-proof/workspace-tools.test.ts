import { describe, expect, it } from "vitest";
import { loadWorkspaceTools } from "./workspace-tools";

type Entry = { name: string; path: string; kind: "file" | "directory" | "symlink"; total_bytes: number };
const files: Record<string, string> = {
    ".claude/skills/review/SKILL.md": "---\ndescription: Review code safely\n---\n# Review",
    ".claude/agents/reviewer.md": "---\ndescription: A reviewer\n---\n# Agent",
    ".claude/commands/check.md": "# Check",
    ".mcp.json": JSON.stringify({ mcpServers: {
        docs: { command: "node", args: ["server.js"], env: { API_TOKEN: "never show" } },
        remote: { url: "https://mcp.example.test", headers: { Authorization: "secret" } },
    } }),
};
const directories = new Set(["", ".claude", ".claude/skills", ".claude/skills/review", ".claude/agents", ".claude/commands"]);
const entries = (): Entry[] => [
    ...[...directories].map((path) => ({ name: path.split("/").at(-1) || ".", path, kind: "directory" as const, total_bytes: 0 })),
    ...Object.keys(files).map((path) => ({ name: path.split("/").at(-1)!, path, kind: "file" as const, total_bytes: new TextEncoder().encode(files[path]).length })),
    { name: "unsafe", path: ".claude/skills/unsafe", kind: "symlink", total_bytes: 0 },
];

function request(method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (method === "files.list") {
        const path = String(args.path ?? "");
        const result = entries().filter((entry) => {
            if (path === "") return !entry.path.includes("/") || entry.path.startsWith(".claude");
            const prefix = `${path}/`;
            return entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes("/");
        });
        return Promise.resolve({ entries: result, next_cursor: null });
    }
    if (method === "files.read") {
        const path = String(args.path);
        const text = files[path];
        if (text === undefined) return Promise.reject(new Error("not found"));
        return Promise.resolve({ data: btoa(text), offset: 0, total_bytes: new TextEncoder().encode(text).length, revision: "r1", eof: true });
    }
    return Promise.reject(new Error(`unexpected ${method}`));
}

describe("workspace AI metadata browser", () => {
    it("reads workspace skills and markdown tools without executing them", async () => {
        const snapshot = await loadWorkspaceTools(request, "C:/repo");
        expect(snapshot.items.find((item) => item.kind === "skill")).toMatchObject({ name: "review", description: "Review code safely" });
        expect(snapshot.items.find((item) => item.kind === "agent")).toMatchObject({ name: "reviewer" });
        expect(snapshot.items.find((item) => item.kind === "command")).toMatchObject({ name: "check" });
        expect(snapshot.items.some((item) => item.path.includes("unsafe"))).toBe(false);
    });

    it("summarizes MCP transport and never exposes secret values", async () => {
        const snapshot = await loadWorkspaceTools(request, "C:/repo");
        expect(snapshot.items.find((item) => item.name === "docs")).toMatchObject({ mcp: { transport: "stdio", fields: ["args", "command", "env"] } });
        expect(snapshot.items.find((item) => item.name === "remote")).toMatchObject({ mcp: { transport: "http", fields: ["headers", "url"] } });
        expect(JSON.stringify(snapshot)).not.toContain("never show");
        expect(JSON.stringify(snapshot)).not.toContain("secret");
    });
});
