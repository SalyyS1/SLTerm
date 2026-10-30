import { useMemo, useRef, useState } from "react";
import type { useWorkspacePreferences } from "./use-workspace-preferences";
import type { RuntimeSnapshot } from "./terminal-runtime";
import { createTask, removeTask, taskActive, type WorkspaceTask, type WorkspaceTaskStatus } from "./workspace-tasks";
import type { AiProvider } from "./ai-cli";
import { Icon } from "./workspace-icons";
import "./task-board-panel.css";

const statusLabel: Record<WorkspaceTaskStatus, string> = {
    draft: "Nháp",
    preparing: "Chuẩn bị worktree",
    starting: "Đang mở CLI",
    running: "Đang chạy",
    stopping: "Đang dừng",
    completed: "Hoàn tất",
    blocked: "Đã dừng / cần xem lại",
    uncertain: "Chưa xác nhận process",
};

export function TaskBoardPanel({ preferences, workspaceId, workspaceCwd, snapshot, requestRun, requestStop, requestBudget, close }: {
    preferences: ReturnType<typeof useWorkspacePreferences>;
    workspaceId: string;
    workspaceCwd: string;
    snapshot: RuntimeSnapshot;
    requestRun: (task: WorkspaceTask) => Promise<void>;
    requestStop: (task: WorkspaceTask, completed?: boolean) => void;
    requestBudget: (task: WorkspaceTask) => void;
    close: () => void;
}) {
    const [title, setTitle] = useState("");
    const [goal, setGoal] = useState("");
    const [provider, setProvider] = useState<AiProvider>("claude");
    const [maxAttempts, setMaxAttempts] = useState("1");
    const [maxMinutes, setMaxMinutes] = useState("30");
    const [busy, setBusy] = useState(false);
    const working = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const tasks = useMemo(() => preferences.value.tasks.filter((task) => task.workspaceId === workspaceId), [preferences.value.tasks, workspaceId]);
    const perform = async (action: () => Promise<void>) => {
        if (working.current) return;
        working.current = true;
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            working.current = false;
            setBusy(false);
        }
    };
    const add = () => perform(async () => {
        const task = createTask(workspaceId, title, goal, provider, Number(maxAttempts), Number(maxMinutes));
        await preferences.commit((value) => ({ ...value, tasks: [...value.tasks, task] }));
        setTitle(""); setGoal("");
    });
    const remove = (task: WorkspaceTask) => perform(async () => {
        await preferences.commit((value) => {
            const current = value.tasks.find((item) => item.id === task.id);
            if (current && (taskActive(current) || current.worktree)) throw new Error("Giữ task có process hoặc worktree để không mất biên nhận.");
            return { ...value, tasks: removeTask(value.tasks, task.id) };
        });
    });
    const disabled = busy || !preferences.writable;
    return <aside className="task-board-panel" aria-label="Task board">
        <header className="task-board-header">
            <div><Icon name="grid" /><strong>Task board</strong><span title={workspaceCwd}>{workspaceCwd}</span></div>
            <button className="icon-button" aria-label="Đóng task board" title="Đóng" onClick={close}><Icon name="close" /></button>
        </header>
        <form className="task-create" onSubmit={(event) => { event.preventDefault(); void add(); }}>
            <input aria-label="Tên task" placeholder="Tên task" maxLength={160} value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} />
            <textarea aria-label="Mục tiêu task" placeholder="Mục tiêu và tiêu chí hoàn thành…" maxLength={16000} value={goal} disabled={disabled} onChange={(event) => setGoal(event.target.value)} />
            <div className="task-create-row">
                <select aria-label="Provider task" value={provider} disabled={disabled} onChange={(event) => setProvider(event.target.value as AiProvider)}>
                    <option value="claude">Claude</option><option value="codex">Codex</option>
                </select>
                <label>Lượt thử <input aria-label="Số lượt thử tối đa" type="number" min="1" max="100" value={maxAttempts} disabled={disabled} onChange={(event) => setMaxAttempts(event.target.value)} /></label>
                <label>Phút/lượt <input aria-label="Thời gian tối đa mỗi lượt" type="number" min="1" max="10080" value={maxMinutes} disabled={disabled} onChange={(event) => setMaxMinutes(event.target.value)} /></label>
            </div>
            <button className="button button-primary" disabled={disabled || !title.trim() || !goal.trim()}>Thêm task</button>
        </form>
        <p className="task-board-note">Duyệt mục tiêu, revision, thời gian và lượt thử trước khi chạy. Mỗi task dùng worktree riêng. Chi phí subscription không được tự đoán; kết quả và merge do bạn duyệt.</p>
        {error && <p className="task-board-error" role="alert">{error}</p>}
        <ul className="task-list">{tasks.map((task) => {
            const session = task.paneId ? snapshot.sessions[task.paneId] : undefined;
            return <li key={task.id} className="task-card" data-status={task.status}>
                <div className="task-card-heading"><strong>{task.title}</strong><span>{statusLabel[task.status]}</span></div>
                <p>{task.goal}</p>
                <small>{task.provider} · lượt {task.attempts}/{task.maxAttempts} · {task.maxMinutes} phút/lượt{session?.status ? ` · terminal ${session.status}` : ""}</small>
                {task.worktree && <code className="task-worktree-path" title={task.worktree.path}>{task.worktree.branch} · {task.worktree.path}</code>}
                {task.message && <p className="task-board-note" role="status">{task.message}</p>}
                <div className="task-card-actions">
                    {(task.status === "draft" || task.status === "blocked") && <button className="button button-primary" disabled={disabled || task.attempts >= task.maxAttempts} onClick={() => void perform(() => requestRun(task))}>Xem và duyệt lượt {task.attempts + 1}</button>}
                    {(task.status === "draft" || task.status === "blocked") && <button className="button" disabled={disabled} onClick={() => requestBudget(task)}>Điều chỉnh budget</button>}
                    {taskActive(task) && <button className="button button-danger" disabled={busy} onClick={() => requestStop(task)}>Dừng task</button>}
                    {task.status !== "draft" && task.status !== "completed" && <button className="button" disabled={disabled} onClick={() => requestStop(task, true)}>Xác nhận hoàn tất</button>}
                    {!taskActive(task) && !task.worktree && <button className="button button-ghost" disabled={disabled} onClick={() => void remove(task)}>Xóa task</button>}
                </div>
            </li>;
        })}{!tasks.length && <li className="task-board-empty">Tạo task, sau đó duyệt lượt chạy. Task mới không tự khởi chạy agent.</li>}</ul>
    </aside>;
}
