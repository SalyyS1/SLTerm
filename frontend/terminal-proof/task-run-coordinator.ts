import type { AiProvider } from "./ai-cli";
import type { ProviderLaunchOptions, RuntimeSnapshot, WorktreeResult } from "./terminal-runtime";
import { patchTask, taskActive, type WorkspaceTask } from "./workspace-tasks";

export type TaskApproval = { task: WorkspaceTask; worktree: WorktreeResult };
export type TaskRunDependencies = {
    read: () => WorkspaceTask[];
    commit: (update: (tasks: WorkspaceTask[]) => WorkspaceTask[]) => Promise<void>;
    inspect: (root: string, taskId: string) => Promise<WorktreeResult>;
    prepare: (root: string, taskId: string, baseRevision: string, headRevision?: string) => Promise<WorktreeResult>;
    open: (provider: AiProvider, options: ProviderLaunchOptions) => number | undefined;
    started: (paneId: number) => Promise<void>;
    close: (paneId: number) => Promise<void>;
    snapshot: () => RuntimeSnapshot;
};

const fingerprint = (task: WorkspaceTask) => JSON.stringify(task);
const message = (failure: unknown) => String(failure instanceof Error ? failure.message : failure).slice(0, 2000);

/** Lives with the workspace controller, so closing a panel cannot lose an active operation. */
export class TaskRunCoordinator {
    private active = new Map<string, Promise<void>>();
    private stopping = new Map<string, Promise<void>>();
    private cancelled = new Set<string>();
    private startupCancellation = new Map<string, AbortController>();
    private worktreeTail: Promise<void> = Promise.resolve();
    constructor(private deps: TaskRunDependencies) {}

    /** Serialize Git metadata operations, never the providers that use prepared worktrees. */
    private async worktreeOperation<T>(operation: () => Promise<T>, cancellation?: AbortSignal): Promise<T> {
        const previous = this.worktreeTail;
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        this.worktreeTail = previous.then(() => held);
        try {
            if (cancellation) await this.startup(previous, cancellation);
            else await previous;
            if (cancellation?.aborted) throw new Error("Đã hủy khởi chạy task.");
            return await operation();
        } finally {
            // A cancelled waiter must not let a later operation bypass the current owner.
            void previous.then(release);
        }
    }

    async review(task: WorkspaceTask, root: string): Promise<TaskApproval> {
        if (taskActive(task) || task.status === "completed" || task.attempts >= task.maxAttempts)
            throw new Error("Task chưa thể chạy hoặc đã hết lượt thử.");
        const worktree = await this.worktreeOperation(() => this.deps.inspect(task.worktree?.root ?? root, task.id));
        if (worktree.completion_unknown || worktree.exists && !worktree.ready)
            throw new Error("Worktree chưa xác nhận hoàn tất. Kiểm tra và khôi phục worktree trước khi duyệt lượt mới.");
        return { task: structuredClone(task), worktree };
    }

    start(approval: TaskApproval): Promise<void> {
        if (this.active.has(approval.task.id) || this.stopping.has(approval.task.id))
            return Promise.reject(new Error("Task đang có thao tác chưa hoàn tất."));
        this.cancelled.delete(approval.task.id);
        const controller = new AbortController();
        this.startupCancellation.set(approval.task.id, controller);
        const timer = setTimeout(() => {
            void this.stop(approval.task.id, false, "Đã hết thời gian được duyệt.").catch(() => {});
        }, approval.task.maxMinutes * 60000);
        const operation = this.execute(approval, controller.signal).finally(() => {
            clearTimeout(timer); this.active.delete(approval.task.id); this.startupCancellation.delete(approval.task.id);
        });
        this.active.set(approval.task.id, operation);
        return operation;
    }

    private async execute({ task, worktree }: TaskApproval, cancellation: AbortSignal) {
        const attemptId = crypto.randomUUID();
        const approvedAt = Date.now();
        const deadlineAt = approvedAt + task.maxMinutes * 60000;
        let reserved = false;
        let paneId: number | undefined;
        const save = (patch: Partial<WorkspaceTask>) => this.deps.commit((tasks) => patchTask(tasks, task.id, patch));
        const checkCancelled = () => {
            if (this.cancelled.has(task.id)) throw new Error("Đã hủy khởi chạy task.");
            if (Date.now() >= deadlineAt) throw new Error("Đã hết thời gian được duyệt; không khởi chạy thêm process.");
        };
        try {
            const prepared = await this.worktreeOperation(async () => {
                checkCancelled();
                // Persist the exact approval after Git admission, before any worktree or process effect.
                await this.deps.commit((tasks) => {
                    const current = tasks.find((item) => item.id === task.id);
                    if (!current || fingerprint(current) !== fingerprint(task) || taskActive(current) || current.status === "completed" || current.attempts >= current.maxAttempts)
                        throw new Error("Task đã thay đổi; cần duyệt lại lượt chạy.");
                    const attemptNumber = current.attempts + 1;
                    return patchTask(tasks, task.id, { status: "preparing", attempts: attemptNumber, paneId: undefined, message: undefined,
                        attempt: { id: attemptId, goal: task.goal, provider: task.provider, root: worktree.root, path: worktree.path, branch: worktree.branch,
                            baseRevision: worktree.base_revision, headRevision: worktree.head_revision,
                            approvedAt, deadlineAt, number: attemptNumber } });
                });
                reserved = true;
                checkCancelled();
                return this.deps.prepare(worktree.root, task.id, worktree.base_revision, worktree.head_revision);
            }, cancellation);
            if (!prepared.ready || prepared.root !== worktree.root || prepared.path !== worktree.path || prepared.branch !== worktree.branch || prepared.base_revision !== worktree.base_revision || prepared.head_revision !== worktree.head_revision)
                throw new Error("Worktree không khớp bản đã duyệt. Không khởi chạy provider.");
            await save({ status: "starting", worktree: { root: prepared.root, path: prepared.path, branch: prepared.branch, baseRevision: prepared.base_revision } });
            checkCancelled();
            paneId = this.deps.open(task.provider, { cwd: prepared.path, prompt: task.goal, workspaceId: task.workspaceId, taskId: task.id, attemptId });
            if (paneId === undefined) throw new Error("Không mở được terminal cho task.");
            await save({ paneId });
            await this.startup(this.deps.started(paneId), cancellation);
            checkCancelled();
            await save({ status: "running" });
        } catch (failure) {
            let stopped = paneId === undefined;
            if (paneId !== undefined) {
                try { await this.deps.close(paneId); stopped = true; } catch { /* Preserve uncertainty instead of allowing another writer. */ }
            }
            if (reserved) await save({ status: stopped ? "blocked" : "uncertain", message: message(failure), ...(paneId === undefined ? {} : { paneId }) }).catch(() => {});
            throw failure;
        }
    }

    private startup(started: Promise<void>, signal: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const abort = () => reject(new Error("Đã hủy khởi chạy task."));
            if (signal.aborted) { abort(); return; }
            signal.addEventListener("abort", abort, { once: true });
            void started.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        });
    }

    stop(taskId: string, completed = false, reason = "Task đã dừng theo yêu cầu."): Promise<void> {
        const existing = this.stopping.get(taskId);
        if (existing) return existing;
        this.cancelled.add(taskId);
        this.startupCancellation.get(taskId)?.abort();
        const operation = this.stopOwned(taskId, completed, reason).finally(() => this.stopping.delete(taskId));
        this.stopping.set(taskId, operation);
        return operation;
    }

    private async stopOwned(taskId: string, completed: boolean, reason: string) {
        await this.active.get(taskId)?.catch(() => {});
        const task = this.deps.read().find((item) => item.id === taskId);
        if (!task) throw new Error("Không tìm thấy task.");
        const patch = (value: Partial<WorkspaceTask>) => this.deps.commit((tasks) => patchTask(tasks, taskId, value));
        if (task.paneId !== undefined) {
            // A restored transcript is not a live process. Only this runtime owns live panes.
            const session = this.deps.snapshot().sessions[task.paneId];
            if (session && !session.restored && session.status !== "exited") {
                await patch({ status: "stopping" }).catch(() => {});
                try { await this.deps.close(task.paneId); }
                catch (failure) { await patch({ status: "uncertain", message: message(failure) }); throw failure; }
            }
        }
        await patch({ status: completed ? "completed" : "blocked", message: reason.slice(0, 2000) });
    }

    async reconcile() {
        for (const task of this.deps.read()) {
            if (!taskActive(task) || this.active.has(task.id) || this.stopping.has(task.id)) continue;
            const session = task.paneId === undefined ? undefined : this.deps.snapshot().sessions[task.paneId];
            if (!session || session.restored || session.status === "exited") {
                await this.deps.commit((tasks) => patchTask(tasks, task.id, { status: "blocked", message: "Lượt chạy đã dừng hoặc bị gián đoạn. Kiểm tra diff trước khi duyệt lượt mới." }));
            } else if (task.attempt && Date.now() >= task.attempt.deadlineAt) {
                await this.stop(task.id, false, "Đã hết thời gian được duyệt; process đã dừng. Cần duyệt lượt mới để tiếp tục.");
            }
        }
    }
}
