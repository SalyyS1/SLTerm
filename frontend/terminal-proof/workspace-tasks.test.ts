import { describe, expect, it } from "vitest";
import { adjustTaskBudget, createTask, normalizeTasks, patchTask } from "./workspace-tasks";

describe("workspace task records", () => {
    it("creates and patches a bounded approval record", () => {
        const task = createTask("workspace", "Review", "Review the diff", "codex", 2);
        expect(task).toMatchObject({ workspaceId: "workspace", provider: "codex", status: "draft", attempts: 0, maxAttempts: 2 });
        const running = patchTask([task], task.id, { status: "running", attempts: 1, paneId: 7 });
        expect(running[0]).toMatchObject({ status: "running", attempts: 1, paneId: 7 });
        expect(() => normalizeTasks([{ ...task, attempts: 3 }])).toThrow();
        expect(() => normalizeTasks([{ ...task, provider: "other" }])).toThrow();
        const withWorktree = normalizeTasks([{ ...task, worktree: { root: "C:\\repo", path: "C:\\repo.slterm-worktrees\\task", branch: "slterm/task/1" } }]);
        expect(withWorktree[0].worktree).toEqual({ root: "C:\\repo", path: "C:\\repo.slterm-worktrees\\task", branch: "slterm/task/1" });
        expect(() => normalizeTasks([{ ...task, worktree: { root: "relative", path: "C:\\task", branch: "main" } }])).toThrow();
    });
    it("retains more than 128 tasks without a task or agent count ceiling", () => {
        const tasks = Array.from({ length: 150 }, (_, index) => createTask("workspace", `Task ${index}`, "Review", "codex", 1));
        expect(normalizeTasks(tasks)).toHaveLength(150);
    });
    it("round trips exact approval paths and revisions and rejects incomplete receipts", () => {
        const task = createTask("workspace", "Review", "Review", "codex", 2);
        const attempt = { id: crypto.randomUUID(), goal: task.goal, provider: task.provider, root: "C:/repo", path: "C:/repo.slterm-worktrees/task", branch: "slterm/task/1",
            baseRevision: "a".repeat(40), headRevision: "b".repeat(40), approvedAt: 1, deadlineAt: 60001, number: 1 };
        const saved = { ...task, attempts: 1, attempt };
        expect(normalizeTasks(JSON.parse(JSON.stringify([saved])))[0].attempt).toEqual(attempt);
        for (const patch of [{ path: undefined }, { branch: undefined }, { headRevision: undefined }, { path: "relative" }, { headRevision: "main" }])
            expect(() => normalizeTasks([{ ...saved, attempt: { ...attempt, ...patch } }])).toThrow();
    });
    it("migrates older records and rejects malformed budgets or approvals", () => {
        const task = createTask("workspace", "Review", "Review", "codex", 2);
        const { maxMinutes: _, ...legacy } = task;
        expect(normalizeTasks([legacy])[0].maxMinutes).toBe(30);
        expect(() => normalizeTasks([{ ...task, maxMinutes: 0 }])).toThrow();
        expect(() => normalizeTasks([{ ...task, attempt: { id: "not-a-uuid" } }])).toThrow();
        expect(() => normalizeTasks([task, task])).toThrow();
    });
    it("replenishes a stopped task budget without resetting consumed attempts or auto starting it", () => {
        const task = { ...createTask("workspace", "Review", "Review", "codex", 1), attempts: 1, status: "blocked" as const };
        expect(adjustTaskBudget([task], task.id, 3, 45)[0]).toMatchObject({ attempts: 1, maxAttempts: 3, maxMinutes: 45, status: "blocked" });
        for (const status of ["running", "preparing", "uncertain", "completed"] as const)
            expect(() => adjustTaskBudget([{ ...task, status }], task.id, 3, 45)).toThrow();
        for (const [attempts, minutes] of [[0, 45], [101, 45], [3, 0], [3, 10081]])
            expect(() => adjustTaskBudget([task], task.id, attempts, minutes)).toThrow();
    });
});
