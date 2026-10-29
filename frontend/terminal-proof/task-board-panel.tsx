import { useMemo, useState } from "react";
import type { useWorkspacePreferences } from "./use-workspace-preferences";
import type { TerminalRuntime, RuntimeSnapshot } from "./terminal-runtime";
import { createTask, patchTask, removeTask, type WorkspaceTask } from "./workspace-tasks";
import type { AiProvider } from "./ai-cli";
import { Icon } from "./workspace-icons";
import "./task-board-panel.css";

type Preferences = ReturnType<typeof useWorkspacePreferences>;

export function TaskBoardPanel({ preferences, workspaceId, workspaceCwd, runtime, snapshot, openProvider, close }: {
    preferences: Preferences;
    workspaceId: string;
    workspaceCwd: string;
    runtime: TerminalRuntime;
    snapshot: RuntimeSnapshot;
    openProvider: (provider: AiProvider) => number | undefined;
    close: () => void;
}) {
    const [title, setTitle] = useState("");
    const [goal, setGoal] = useState("");
    const [provider, setProvider] = useState<AiProvider>("claude");
    const [maxAttempts, setMaxAttempts] = useState("1");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const tasks = useMemo(() => preferences.value.tasks.filter((task) => task.workspaceId === workspaceId), [preferences.value.tasks, workspaceId]);
    const commit = (update: (tasks: WorkspaceTask[]) => WorkspaceTask[]) => preferences.commit((value) => ({ ...value, tasks: update(value.tasks) }));
    const add = async () => {
        if (!title.trim() || !goal.trim()) return;
        const attempts = Number(maxAttempts);
        if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 100) { setError("Số lượt thử phải từ 1 đến 100."); return; }
        setBusy(true); setError(null);
        try { await commit((current) => [...current, createTask(workspaceId, title, goal, provider, attempts)]); setTitle(""); setGoal(""); }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setBusy(false); }
    };
    const run = async (task: WorkspaceTask) => {
        if (task.status === "running" || task.attempts >= task.maxAttempts) return;
        setBusy(true); setError(null);
        try {
            const paneId = openProvider(task.provider);
            if (!paneId) throw new Error("Chưa có terminal để chạy task.");
            await runtime.sendInput(paneId, `${task.goal}\r`);
            await commit((current) => patchTask(current, task.id, { status: "running", attempts: task.attempts + 1, paneId }));
        } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setBusy(false); }
    };
    const mark = async (task: WorkspaceTask, status: "completed" | "blocked") => {
        setBusy(true); setError(null);
        try { await commit((current) => patchTask(current, task.id, { status })); }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setBusy(false); }
    };
    const remove = async (task: WorkspaceTask) => {
        if (task.status === "running") return;
        setBusy(true); setError(null);
        try { await commit((current) => removeTask(current, task.id)); }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setBusy(false); }
    };
    return <aside className="task-board-panel" aria-label="Task board">
        <header className="task-board-header"><div><Icon name="grid" /><strong>Task board</strong><span title={workspaceCwd}>{workspaceCwd}</span></div><button className="icon-button" aria-label="Đóng task board" title="Đóng" onClick={close}><Icon name="close" /></button></header>
        <form className="task-create" onSubmit={(event) => { event.preventDefault(); void add(); }}><input aria-label="Tên task" placeholder="Tên task" value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /><textarea aria-label="Mục tiêu task" placeholder="Mục tiêu và tiêu chí hoàn thành…" value={goal} disabled={busy} onChange={(event) => setGoal(event.target.value)} /><div className="task-create-row"><select aria-label="Provider task" value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value as AiProvider)}><option value="claude">Claude</option><option value="codex">Codex</option></select><label>Lượt thử <input aria-label="Số lượt thử tối đa" type="number" min="1" max="100" value={maxAttempts} disabled={busy} onChange={(event) => setMaxAttempts(event.target.value)} /></label><button className="button button-primary" disabled={busy || !title.trim() || !goal.trim()}>Thêm task</button></div></form>
        <p className="task-board-note">Mỗi lần bấm Chạy là một lần duyệt mục tiêu. Budget hiện được giới hạn theo số lượt thử; quota/chi phí subscription không được SLTerm tự đoán. Task chạy trong cwd hiện tại, worktree isolation tự động sẽ nối ở bước sau.</p>
        {error && <p className="task-board-error" role="alert">{error}</p>}
        <ul className="task-list">{tasks.map((task) => { const session = task.paneId ? snapshot.sessions[task.paneId] : undefined; return <li key={task.id} className="task-card" data-status={task.status}><div className="task-card-heading"><strong>{task.title}</strong><span>{task.status}</span></div><p>{task.goal}</p><small>{task.provider} · lượt {task.attempts}/{task.maxAttempts}{session?.status ? ` · terminal ${session.status}` : ""}</small><div className="task-card-actions">{task.status === "draft" && <button className="button button-primary" disabled={busy || task.attempts >= task.maxAttempts} onClick={() => void run(task)}>Chạy (duyệt)</button>}{task.status === "running" && <><button className="button" disabled={busy} onClick={() => void mark(task, "completed")}>Đánh dấu xong</button><button className="button button-danger" disabled={busy} onClick={() => void mark(task, "blocked")}>Chặn task</button></>}{task.status !== "running" && <button className="button button-ghost" disabled={busy} onClick={() => void remove(task)}>Xóa</button>}</div></li>; })}{!tasks.length && <li className="task-board-empty">Chưa có task. Tạo task để duyệt thủ công từng lượt chạy.</li>}</ul>
    </aside>;
}
