import type { AiProvider } from "./ai-cli";

export type WorkspaceTaskStatus = "draft" | "running" | "completed" | "blocked";
export type WorkspaceTask = {
    id: string;
    workspaceId: string;
    title: string;
    goal: string;
    provider: AiProvider;
    maxAttempts: number;
    attempts: number;
    status: WorkspaceTaskStatus;
    paneId?: number;
    createdAt: number;
    updatedAt: number;
};

const MAX_TASKS = 128;
const string = (value: unknown, max: number) => typeof value === "string" && value.trim().length <= max ? value.trim() : undefined;
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;

export function normalizeTasks(value: unknown): WorkspaceTask[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_TASKS) throw new Error("Danh sách task không hợp lệ hoặc vượt quá 128 task.");
    const ids = new Set<string>();
    return value.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Task không hợp lệ.");
        const task = item as Record<string, unknown>;
        const id = string(task.id, 128), workspaceId = string(task.workspaceId, 128), title = string(task.title, 160), goal = string(task.goal, 16_000);
        const provider = task.provider === "claude" || task.provider === "codex" ? task.provider : undefined;
        const status = ["draft", "running", "completed", "blocked"].includes(String(task.status)) ? task.status as WorkspaceTaskStatus : undefined;
        const maxAttempts = integer(task.maxAttempts, 1, 100), attempts = integer(task.attempts, 0, 100);
        const createdAt = integer(task.createdAt, 0, Number.MAX_SAFE_INTEGER), updatedAt = integer(task.updatedAt, 0, Number.MAX_SAFE_INTEGER);
        if (!id || !workspaceId || !title || !goal || !provider || !status || maxAttempts === undefined || attempts === undefined || attempts > maxAttempts || createdAt === undefined || updatedAt === undefined || ids.has(id)) throw new Error("Task có trường hoặc định danh không hợp lệ.");
        const paneId = task.paneId === undefined ? undefined : integer(task.paneId, 1, Number.MAX_SAFE_INTEGER);
        if (task.paneId !== undefined && paneId === undefined) throw new Error("Task có paneId không hợp lệ.");
        ids.add(id);
        return { id, workspaceId, title, goal, provider, maxAttempts, attempts, status, ...(paneId === undefined ? {} : { paneId }), createdAt, updatedAt };
    });
}

export function createTask(workspaceId: string, title: string, goal: string, provider: AiProvider, maxAttempts: number): WorkspaceTask {
    const now = Date.now();
    return { id: crypto.randomUUID(), workspaceId, title: title.trim().slice(0, 160), goal: goal.trim().slice(0, 16_000), provider, maxAttempts, attempts: 0, status: "draft", createdAt: now, updatedAt: now };
}

export function patchTask(tasks: WorkspaceTask[], id: string, patch: Partial<WorkspaceTask>): WorkspaceTask[] {
    return tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task);
}

export function removeTask(tasks: WorkspaceTask[], id: string): WorkspaceTask[] { return tasks.filter((task) => task.id !== id); }
