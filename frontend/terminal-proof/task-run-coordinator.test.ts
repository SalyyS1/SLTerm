import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskRunCoordinator, type TaskRunDependencies } from "./task-run-coordinator";
import { createTask, normalizeTasks, type WorkspaceTask } from "./workspace-tasks";
import type { RuntimeSnapshot } from "./terminal-runtime";

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
};
function fixture() {
    let tasks = [createTask("workspace", "Review", "Review $(Get-ChildItem)\nTiếng Việt", "codex", 3)];
    const snapshot: RuntimeSnapshot = { phase: "connected", error: null, fontSize: 14, theme: "dark", closeRequested: false, shutdownIssue: null, sessions: {} };
    const worktree = { root: "C:/repo", path: "C:/repo.slterm-worktrees/task", branch: "slterm/task/1", base_revision: "a".repeat(40), head_revision: "a".repeat(40), exists: false, ready: true };
    const deps: TaskRunDependencies = {
        read: () => tasks,
        commit: vi.fn(async (update) => { tasks = normalizeTasks(update(tasks)); }),
        inspect: vi.fn(async () => worktree), prepare: vi.fn(async () => worktree),
        open: vi.fn(() => { snapshot.sessions[1] = { status: "running" }; return 1; }),
        started: vi.fn(async () => {}),
        close: vi.fn(async (id) => { snapshot.sessions[id] = { status: "exited", exitCode: 1 }; }),
        snapshot: () => snapshot,
    };
    return { coordinator: new TaskRunCoordinator(deps), deps, worktree, snapshot, tasks: () => tasks, update: (update: (tasks: WorkspaceTask[]) => WorkspaceTask[]) => { tasks = update(tasks); } };
}
afterEach(() => vi.useRealTimers());

describe("approved task lifecycle", () => {
    it("persists approval and attempt before worktree/process and supplies goal only as a launch argument", async () => {
        const f = fixture();
        const approval = await f.coordinator.review(f.tasks()[0], "C:/repo");
        vi.mocked(f.deps.prepare).mockImplementation(async () => {
            expect(f.tasks()[0]).toMatchObject({ status: "preparing", attempts: 1, attempt: { goal: approval.task.goal, number: 1,
                root: "C:/repo", path: f.worktree.path, branch: f.worktree.branch, baseRevision: f.worktree.base_revision, headRevision: f.worktree.head_revision } });
            return f.worktree;
        });
        await f.coordinator.start(approval);
        expect(f.tasks()[0]).toMatchObject({ status: "running", attempts: 1, paneId: 1, worktree: { path: f.worktree.path } });
        expect(f.deps.open).toHaveBeenCalledWith("codex", expect.objectContaining({ cwd: f.worktree.path, prompt: approval.task.goal, attemptId: f.tasks()[0].attempt!.id }));
    });
    it("retains the approved retry HEAD separately from the original base and rejects a changed checkout", async () => {
        const f = fixture();
        f.worktree.head_revision = "b".repeat(40); f.worktree.exists = true;
        const approval = await f.coordinator.review(f.tasks()[0], "C:/repo");
        vi.mocked(f.deps.prepare).mockImplementation(async () => {
            expect(f.tasks()[0].attempt).toMatchObject({ headRevision: "b".repeat(40), baseRevision: "a".repeat(40) });
            return { ...f.worktree, head_revision: "c".repeat(40) };
        });
        await expect(f.coordinator.start(approval)).rejects.toThrow("không khớp");
        expect(f.deps.prepare).toHaveBeenCalledWith(f.worktree.root, approval.task.id, "a".repeat(40), "b".repeat(40));
        expect(f.deps.open).not.toHaveBeenCalled();
    });
    it("starts nothing when saving the approval fails", async () => {
        const f = fixture(), approval = await f.coordinator.review(f.tasks()[0], "C:/repo");
        vi.mocked(f.deps.commit).mockRejectedValue(new Error("Disk full"));
        await expect(f.coordinator.start(approval)).rejects.toThrow("Disk full");
        expect(f.deps.prepare).not.toHaveBeenCalled(); expect(f.deps.open).not.toHaveBeenCalled();
    });
    it("does not offer another approval or consume attempts for an already known partial worktree", async () => {
        const f = fixture();
        vi.mocked(f.deps.inspect).mockResolvedValue({ ...f.worktree, completion_unknown: true, exists: true, ready: false });
        await expect(f.coordinator.review(f.tasks()[0], "C:/repo")).rejects.toThrow("khôi phục worktree");
        expect(f.tasks()[0].attempts).toBe(0); expect(f.deps.commit).not.toHaveBeenCalled(); expect(f.deps.open).not.toHaveBeenCalled();
    });
    it("invalidates an approval when the goal or budget changes", async () => {
        const f = fixture(), approval = await f.coordinator.review(f.tasks()[0], "C:/repo");
        f.update((tasks) => tasks.map((task) => ({ ...task, goal: "Deploy something else" })));
        await expect(f.coordinator.start(approval)).rejects.toThrow("duyệt lại");
        expect(f.deps.prepare).not.toHaveBeenCalled();
    });
    it("rejects a duplicate click and never replays an unknown worktree outcome", async () => {
        const f = fixture(), pending = deferred(), approval = await f.coordinator.review(f.tasks()[0], "C:/repo");
        vi.mocked(f.deps.prepare).mockImplementation(async () => { await pending.promise; throw new Error("completion unknown"); });
        const first = f.coordinator.start(approval);
        await expect(f.coordinator.start(approval)).rejects.toThrow("chưa hoàn tất");
        pending.resolve(); await expect(first).rejects.toThrow("unknown");
        expect(f.deps.prepare).toHaveBeenCalledTimes(1); expect(f.deps.open).not.toHaveBeenCalled();
        expect(f.tasks()[0]).toMatchObject({ attempts: 1, status: "blocked" });
    });
    it("cancels a pending startup before opening a provider", async () => {
        const f = fixture(), gate = deferred(), entered = deferred(), approval = await f.coordinator.review(f.tasks()[0], "C:/repo");
        vi.mocked(f.deps.prepare).mockImplementation(async () => { entered.resolve(); await gate.promise; return f.worktree; });
        const run = f.coordinator.start(approval);
        const outcome = expect(run).rejects.toThrow("hủy");
        await entered.promise;
        const stop = f.coordinator.stop(approval.task.id);
        gate.resolve(); await outcome; await stop;
        expect(f.deps.open).not.toHaveBeenCalled(); expect(f.tasks()[0].status).toBe("blocked");
    });
    it("closes a process if persisting its pane fails", async () => {
        const f = fixture(), approval = await f.coordinator.review(f.tasks()[0], "C:/repo");
        const commit = f.deps.commit;
        let calls = 0;
        f.deps.commit = async (update) => { if (++calls === 3) throw new Error("Disk full"); return commit(update); };
        await expect(f.coordinator.start(approval)).rejects.toThrow("Disk full");
        expect(f.deps.close).toHaveBeenCalledWith(1);
        expect(f.tasks()[0]).toMatchObject({ status: "blocked", attempts: 1, paneId: 1 });
    });
    it("cancels a startup whose ready signal never arrives", async () => {
        const f = fixture(), entered = deferred();
        vi.mocked(f.deps.started).mockImplementation(() => { entered.resolve(); return new Promise(() => {}); });
        const run = f.coordinator.start(await f.coordinator.review(f.tasks()[0], "C:/repo"));
        const outcome = expect(run).rejects.toThrow("hủy");
        await entered.promise;
        await f.coordinator.stop(f.tasks()[0].id); await outcome;
        expect(f.deps.close).toHaveBeenCalledWith(1); expect(f.tasks()[0].status).toBe("blocked");
    });
    it("expires an approved attempt even while its startup is pending", async () => {
        vi.useFakeTimers();
        const f = fixture(), entered = deferred();
        vi.mocked(f.deps.started).mockImplementation(() => { entered.resolve(); return new Promise(() => {}); });
        const run = f.coordinator.start(await f.coordinator.review(f.tasks()[0], "C:/repo"));
        const outcome = expect(run).rejects.toThrow("hủy");
        await entered.promise;
        await vi.advanceTimersByTimeAsync(30 * 60000); await outcome;
        expect(f.deps.close).toHaveBeenCalledWith(1); expect(f.tasks()[0].status).toBe("blocked");
    });
    it("keeps an unconfirmed stop ineligible for retry", async () => {
        const f = fixture(); await f.coordinator.start(await f.coordinator.review(f.tasks()[0], "C:/repo"));
        vi.mocked(f.deps.close).mockRejectedValue(new Error("Unconfirmed stop"));
        await expect(f.coordinator.stop(f.tasks()[0].id)).rejects.toThrow("Unconfirmed");
        expect(f.tasks()[0].status).toBe("uncertain");
        await expect(f.coordinator.review(f.tasks()[0], "C:/repo")).rejects.toThrow();
    });
    it("stops the process even when storage is temporarily unavailable", async () => {
        const f = fixture(); await f.coordinator.start(await f.coordinator.review(f.tasks()[0], "C:/repo"));
        vi.mocked(f.deps.commit).mockRejectedValue(new Error("Disk full"));
        await expect(f.coordinator.stop(f.tasks()[0].id)).rejects.toThrow("Disk full");
        expect(f.deps.close).toHaveBeenCalledWith(1); expect(f.snapshot.sessions[1].status).toBe("exited");
    });
    it("requires confirmed process exit before manual completion", async () => {
        const f = fixture(); await f.coordinator.start(await f.coordinator.review(f.tasks()[0], "C:/repo"));
        const gate = deferred();
        vi.mocked(f.deps.close).mockImplementation(async () => { await gate.promise; f.snapshot.sessions[1] = { status: "exited" }; });
        const stop = f.coordinator.stop(f.tasks()[0].id, true);
        await Promise.resolve(); await Promise.resolve();
        expect(f.tasks()[0].status).not.toBe("completed");
        gate.resolve(); await stop; expect(f.tasks()[0].status).toBe("completed");
    });
    it("enforces elapsed time and restores history as interrupted work, never completed work", async () => {
        const f = fixture(); await f.coordinator.start(await f.coordinator.review(f.tasks()[0], "C:/repo"));
        vi.useFakeTimers(); vi.setSystemTime(f.tasks()[0].attempt!.deadlineAt + 1);
        await f.coordinator.reconcile();
        expect(f.deps.close).toHaveBeenCalledWith(1); expect(f.tasks()[0].status).toBe("blocked");
        f.update((tasks) => tasks.map((task) => ({ ...task, status: "running" })));
        f.snapshot.sessions[1] = { status: "exited", restored: true };
        await f.coordinator.reconcile(); expect(f.tasks()[0].status).toBe("blocked");
    });
    it("serializes worktree preparation before reserving the next attempt", async () => {
        const f = fixture(), gate = deferred(), entered = deferred();
        f.update((tasks) => [...tasks, createTask("workspace", "Other", "Other goal", "claude", 1)]);
        let busy = false, calls = 0;
        vi.mocked(f.deps.prepare).mockImplementation(async () => {
            if (busy) throw new Error("WorktreeOperationBusy");
            busy = true;
            try { if (++calls === 1) { entered.resolve(); await gate.promise; } return f.worktree; }
            finally { busy = false; }
        });
        const approvals = await Promise.all(f.tasks().map((task) => f.coordinator.review(task, "C:/repo")));
        const first = f.coordinator.start(approvals[0]); await entered.promise;
        const second = f.coordinator.start(approvals[1]);
        await Promise.resolve(); await Promise.resolve();
        expect(f.tasks()[1]).toMatchObject({ attempts: 0, status: "draft" });
        gate.resolve(); await Promise.all([first, second]);
        expect(f.tasks().map((task) => [task.status, task.attempts])).toEqual([["running", 1], ["running", 1]]);
    });
    it("cancels a waiting preparation without consuming its attempt or bypassing the Git owner", async () => {
        const f = fixture(), gate = deferred(), entered = deferred();
        f.update((tasks) => [...tasks, createTask("workspace", "Second", "Second", "claude", 1), createTask("workspace", "Third", "Third", "codex", 1)]);
        let calls = 0;
        vi.mocked(f.deps.prepare).mockImplementation(async () => { if (++calls === 1) { entered.resolve(); await gate.promise; } return f.worktree; });
        const approvals = await Promise.all(f.tasks().map((task) => f.coordinator.review(task, "C:/repo")));
        const first = f.coordinator.start(approvals[0]); await entered.promise;
        const second = f.coordinator.start(approvals[1]);
        const cancelled = expect(second).rejects.toThrow("hủy");
        const third = f.coordinator.start(approvals[2]);
        await f.coordinator.stop(approvals[1].task.id); await cancelled;
        expect(f.tasks()[1].attempts).toBe(0); expect(f.deps.prepare).toHaveBeenCalledTimes(1);
        gate.resolve(); await Promise.all([first, third]);
        expect(f.deps.prepare).toHaveBeenCalledTimes(2); expect(f.tasks()[2].status).toBe("running");
    });
    it("runs providers independently while another provider is still starting", async () => {
        const f = fixture(), gate = deferred(), entered = deferred();
        f.update((tasks) => [...tasks, createTask("workspace", "Other", "Other", "claude", 1)]);
        let calls = 0;
        vi.mocked(f.deps.started).mockImplementation(async () => { if (++calls === 1) { entered.resolve(); await gate.promise; } });
        const approvals = await Promise.all(f.tasks().map((task) => f.coordinator.review(task, "C:/repo")));
        const first = f.coordinator.start(approvals[0]); await entered.promise;
        await f.coordinator.start(approvals[1]); expect(f.tasks()[1].status).toBe("running");
        gate.resolve(); await first; expect(f.tasks()[0].status).toBe("running");
    });
});
