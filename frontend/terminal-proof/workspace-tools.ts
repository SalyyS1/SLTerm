import { listProjectDirectory, readProjectFile, type ProjectEntry, type ProjectRequest } from "./project-files";

export type WorkspaceToolKind = "skill" | "mcp" | "agent" | "command";
export type WorkspaceToolItem = {
    kind: WorkspaceToolKind;
    name: string;
    path: string;
    description?: string;
    content?: string;
    mcp?: { transport: "stdio" | "http" | "unknown"; fields: string[] };
};
export type WorkspaceToolsSnapshot = {
    items: WorkspaceToolItem[];
    warnings: string[];
    loadedAt: number;
};

const MAX_ITEMS = 128;
const MAX_TEXT_BYTES = 256 * 1024;
const SECRET_KEY = /(?:api.?key|token|password|secret|credential|private.?key|authorization|cookie)/i;

function addWarning(warnings: string[], message: string): void {
    if (!warnings.includes(message)) warnings.push(message);
}

function descriptionFromMarkdown(text: string): string | undefined {
    const frontMatter = text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const value = frontMatter?.[1].match(/^description\s*:\s*(.*)$/im)?.[1]?.trim();
    return value?.replace(/^(["'])(.*)\1$/, "$2").slice(0, 240) || undefined;
}

async function listAll(request: ProjectRequest, root: string, path: string, warnings: string[]): Promise<ProjectEntry[]> {
    const entries: ProjectEntry[] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
        const page = await listProjectDirectory(request, root, path, cursor);
        entries.push(...page.entries);
        if (entries.length >= MAX_ITEMS) {
            addWarning(warnings, `${path || "workspace"}: danh sách bị giới hạn ${MAX_ITEMS} mục.`);
            return entries.slice(0, MAX_ITEMS);
        }
        cursor = page.next;
    }
    return entries;
}

async function readSmall(request: ProjectRequest, root: string, entry: ProjectEntry, warnings: string[]): Promise<string | undefined> {
    if (entry.kind !== "file") return undefined;
    if (entry.total_bytes > MAX_TEXT_BYTES) {
        addWarning(warnings, `${entry.path}: quá lớn để đọc trong bảng AI.`);
        return undefined;
    }
    try { return (await readProjectFile(request, root, entry.path)).text; }
    catch (error) { addWarning(warnings, `${entry.path}: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
}

function mcpSummary(value: unknown): WorkspaceToolItem["mcp"] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { transport: "unknown", fields: [] };
    const config = value as Record<string, unknown>;
    const fields = Object.keys(config).filter((key) => !SECRET_KEY.test(key)).sort();
    const transport = typeof config.command === "string" ? "stdio" : typeof config.url === "string" ? "http" : "unknown";
    return { transport, fields };
}

function parseMcp(text: string, path: string, warnings: string[]): WorkspaceToolItem[] {
    try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP config phải là object.");
        const servers = (parsed as Record<string, unknown>).mcpServers;
        if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
            addWarning(warnings, `${path}: không có mcpServers.`);
            return [];
        }
        return Object.entries(servers).slice(0, MAX_ITEMS).map(([name, config]) => ({
            kind: "mcp", name, path, mcp: mcpSummary(config),
            description: "Chỉ hiển thị; chưa bật server và không gửi credential.",
        }));
    } catch (error) {
        addWarning(warnings, `${path}: JSON không hợp lệ (${error instanceof Error ? error.message : String(error)}).`);
        return [];
    }
}

async function collectMarkdown(request: ProjectRequest, root: string, directory: string, kind: "skill" | "agent" | "command", warnings: string[]): Promise<WorkspaceToolItem[]> {
    const entries = await listAll(request, root, directory, warnings);
    const result: WorkspaceToolItem[] = [];
    for (const entry of entries) {
        if (entry.kind === "symlink") { addWarning(warnings, `${entry.path}: symlink bị bỏ qua.`); continue; }
        if (kind === "skill" && entry.kind === "directory") {
            const skillFile = (await listAll(request, root, `${directory}/${entry.name}`, warnings)).find((item) => item.kind === "file" && item.name.toLowerCase() === "skill.md");
            if (!skillFile) { addWarning(warnings, `${entry.path}: thiếu SKILL.md.`); continue; }
            const content = await readSmall(request, root, skillFile, warnings);
            result.push({ kind, name: entry.name, path: skillFile.path, description: content ? descriptionFromMarkdown(content) : undefined, content });
        } else if (kind !== "skill" && entry.kind === "file" && /\.md$/i.test(entry.name)) {
            const content = await readSmall(request, root, entry, warnings);
            result.push({ kind, name: entry.name.replace(/\.md$/i, ""), path: entry.path, description: content ? descriptionFromMarkdown(content) : undefined, content });
        }
        if (result.length >= MAX_ITEMS) break;
    }
    return result;
}

/** Read workspace-owned AI metadata without executing or enabling it. */
export async function loadWorkspaceTools(request: ProjectRequest, root: string): Promise<WorkspaceToolsSnapshot> {
    const warnings: string[] = [];
    const items: WorkspaceToolItem[] = [];
    try {
        items.push(...await collectMarkdown(request, root, ".claude/skills", "skill", warnings));
    } catch { addWarning(warnings, "Không tìm thấy .claude/skills trong workspace."); }
    try {
        items.push(...await collectMarkdown(request, root, ".claude/agents", "agent", warnings));
    } catch { addWarning(warnings, "Không tìm thấy .claude/agents trong workspace."); }
    try {
        items.push(...await collectMarkdown(request, root, ".claude/commands", "command", warnings));
    } catch { addWarning(warnings, "Không tìm thấy .claude/commands trong workspace."); }
    try {
        const entry = (await listAll(request, root, "", warnings)).find((item) => item.kind === "file" && item.name === ".mcp.json");
        if (entry) {
            const content = await readSmall(request, root, entry, warnings);
            if (content) items.push(...parseMcp(content, entry.path, warnings));
        } else addWarning(warnings, "Workspace chưa có .mcp.json.");
    } catch { addWarning(warnings, "Không thể đọc .mcp.json; giữ cấu hình MCP hiện tại."); }
    return { items, warnings, loadedAt: Date.now() };
}
