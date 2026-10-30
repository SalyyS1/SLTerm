import type { AiProvider } from "./ai-cli";
import { isCanonicalRunId } from "./workspace-model";

export type WorkspaceTaskStatus = "draft" | "preparing" | "starting" | "running" | "stopping" | "completed" | "blocked" | "uncertain";
export type TaskWorktree = { root: string; path: string; branch: string; baseRevision?: string };
export type TaskAttempt = {
    id: string; goal: string; provider: AiProvider; root: string; path: string; branch: string; baseRevision: string; headRevision: string;
    approvedAt: number; deadlineAt: number; number: number;
};
export type WorkspaceTask = {
    id: string;
    workspaceId: string;
    title: string;
    goal: string;
    provider: AiProvider;
    maxAttempts: number;
    maxMinutes: number;
    attempts: number;
    status: WorkspaceTaskStatus;
    paneId?: number;
    createdAt: number;
    updatedAt: number;
    worktree?: TaskWorktree;
    attempt?: TaskAttempt;
    message?: string;
};

const ACTIVE_STATUSES: WorkspaceTaskStatus[] = ["preparing", "starting", "running", "stopping", "uncertain"];
const TASK_STATUSES: WorkspaceTaskStatus[] = ["draft", ...ACTIVE_STATUSES, "completed", "blocked"];
const string = (value: unknown, max: number) => typeof value === "string" && value.trim().length <= max ? value.trim() : undefined;
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
export const taskActive = (task: WorkspaceTask) => ACTIVE_STATUSES.includes(task.status);
const validRevision = (value: unknown): value is string => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);

function normalizeWorktree(value: unknown): TaskWorktree {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Task có worktree không hợp lệ.");
    const candidate = value as Record<string, unknown>;
    const root = string(candidate.root, 32767);
    const path = string(candidate.path, 32767);
    const branch = string(candidate.branch, 200);
    if (!root || !path || !branch || !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(root) || !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) || branch.startsWith("-") || branch.includes(".."))
        throw new Error("Task có worktree không hợp lệ.");
    if (candidate.baseRevision !== undefined && !validRevision(candidate.baseRevision)) throw new Error("Revision worktree không hợp lệ.");
    return { root, path, branch, ...(candidate.baseRevision ? { baseRevision: candidate.baseRevision as string } : {}) };
}

function normalizeAttempt(value: unknown, attempts: number, maxAttempts: number): TaskAttempt {
    const candidate = value as TaskAttempt;
    if (!candidate || typeof candidate !== "object" || !isCanonicalRunId(candidate.id) || !string(candidate.goal, 16000) ||
        !["claude", "codex"].includes(candidate.provider) || !validRevision(candidate.baseRevision) || !validRevision(candidate.headRevision) ||
        integer(candidate.approvedAt, 0, Number.MAX_SAFE_INTEGER) === undefined || integer(candidate.deadlineAt, candidate.approvedAt + 1, Number.MAX_SAFE_INTEGER) === undefined ||
        integer(candidate.number, 1, maxAttempts) === undefined || candidate.number !== attempts) throw new Error("Lượt chạy task không hợp lệ.");
    const { root, path, branch } = normalizeWorktree(candidate);
    return { id: candidate.id, goal: candidate.goal, provider: candidate.provider, root, path, branch,
        baseRevision: candidate.baseRevision, headRevision: candidate.headRevision,
        approvedAt: candidate.approvedAt, deadlineAt: candidate.deadlineAt, number: candidate.number };
}

export function normalizeTasks(value: unknown): WorkspaceTask[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("Danh sách task không hợp lệ.");
    const ids = new Set<string>();
    return value.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Task không hợp lệ.");
        const task = item as Record<string, unknown>;
        const id = string(task.id, 128);
        const workspaceId = string(task.workspaceId, 128);
        const title = string(task.title, 160);
        const goal = string(task.goal, 16_000);
        const provider = task.provider === "claude" || task.provider === "codex" ? task.provider : undefined;
        const status = TASK_STATUSES.includes(String(task.status) as WorkspaceTaskStatus) ? task.status as WorkspaceTaskStatus : undefined;
        const maxAttempts = integer(task.maxAttempts, 1, 100);
        const attempts = integer(task.attempts, 0, 100);
        const maxMinutes = task.maxMinutes === undefined ? 30 : integer(task.maxMinutes, 1, 10080);
        const createdAt = integer(task.createdAt, 0, Number.MAX_SAFE_INTEGER);
        const updatedAt = integer(task.updatedAt, 0, Number.MAX_SAFE_INTEGER);
        if (!id || !isCanonicalRunId(id) || !workspaceId || !title || !goal || !provider || !status || maxAttempts === undefined || maxMinutes === undefined || attempts === undefined || attempts > maxAttempts || createdAt === undefined || updatedAt === undefined || ids.has(id)) throw new Error("Task có trường hoặc định danh không hợp lệ.");
        const paneId = task.paneId === undefined ? undefined : integer(task.paneId, 1, Number.MAX_SAFE_INTEGER);
        if (task.paneId !== undefined && paneId === undefined) throw new Error("Task có paneId không hợp lệ.");
        const worktree = task.worktree === undefined ? undefined : normalizeWorktree(task.worktree);
        const attempt = task.attempt === undefined ? undefined : normalizeAttempt(task.attempt, attempts, maxAttempts);
        const message = task.message === undefined ? undefined : string(task.message, 2000);
        if (task.message !== undefined && message === undefined) throw new Error("Thông báo task không hợp lệ.");
        ids.add(id);
        return { id, workspaceId, title, goal, provider, maxAttempts, maxMinutes, attempts, status, ...(paneId === undefined ? {} : { paneId }), ...(worktree === undefined ? {} : { worktree }), ...(attempt ? { attempt } : {}), ...(message === undefined ? {} : { message }), createdAt, updatedAt };
    });
}

export function createTask(workspaceId: string, title: string, goal: string, provider: AiProvider, maxAttempts: number, maxMinutes = 30): WorkspaceTask {
    const now = Date.now();
    return normalizeTasks([{ id: crypto.randomUUID(), workspaceId, title, goal, provider, maxAttempts, maxMinutes, attempts: 0, status: "draft", createdAt: now, updatedAt: now }])[0];
}

export function patchTask(tasks: WorkspaceTask[], id: string, patch: Partial<WorkspaceTask>): WorkspaceTask[] {
    return tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task);
}

export function removeTask(tasks: WorkspaceTask[], id: string): WorkspaceTask[] { return tasks.filter((task) => task.id !== id); }

export function adjustTaskBudget(tasks: WorkspaceTask[], id: string, maxAttempts: number, maxMinutes: number): WorkspaceTask[] {
    const task = tasks.find((item) => item.id === id);
    if (!task || taskActive(task) || task.status === "completed") throw new Error("Chỉ đổi budget khi task đã dừng và process được xác nhận.");
    return normalizeTasks(patchTask(tasks, id, { maxAttempts, maxMinutes }));
}
