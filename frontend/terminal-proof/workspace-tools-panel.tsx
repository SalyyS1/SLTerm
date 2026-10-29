import { useEffect, useMemo, useState } from "react";
import { loadWorkspaceTools, type WorkspaceToolItem, type WorkspaceToolKind, type WorkspaceToolsSnapshot } from "./workspace-tools";
import type { ProjectRequest } from "./project-files";
import { Icon } from "./workspace-icons";
import "./workspace-tools-panel.css";

const tabs: { kind: WorkspaceToolKind; label: string }[] = [
    { kind: "skill", label: "Skills" },
    { kind: "mcp", label: "MCP" },
    { kind: "agent", label: "Agents" },
    { kind: "command", label: "Commands" },
];

export function WorkspaceToolsPanel({ root, request, close }: { root: string; request: ProjectRequest; close: () => void }) {
    const [snapshot, setSnapshot] = useState<WorkspaceToolsSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [kind, setKind] = useState<WorkspaceToolKind>("skill");
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const refresh = async () => {
        setLoading(true); setError(null);
        try { setSnapshot(await loadWorkspaceTools(request, root)); }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setLoading(false); }
    };
    useEffect(() => { void refresh(); }, [root]);
    const items = useMemo(() => snapshot?.items.filter((item) => item.kind === kind) ?? [], [snapshot, kind]);
    const selected = items.find((item) => item.path === selectedPath) ?? items[0] ?? null;
    return <aside className="workspace-tools" aria-label="Workspace AI tools">
        <header className="workspace-tools-header"><div><Icon name="terminal" /><strong>Workspace AI</strong><span title={root}>{root}</span></div><div><button className="icon-button" aria-label="Đọc lại AI tools" title="Đọc lại" disabled={loading} onClick={() => void refresh()}><Icon name="restore" /></button><button className="icon-button" aria-label="Đóng AI tools" title="Đóng" onClick={close}><Icon name="close" /></button></div></header>
        <nav className="workspace-tools-tabs" aria-label="Loại AI tools">{tabs.map((tab) => <button key={tab.kind} className="button" aria-pressed={kind === tab.kind} onClick={() => { setKind(tab.kind); setSelectedPath(null); }}>{tab.label}<span>{snapshot?.items.filter((item) => item.kind === tab.kind).length ?? 0}</span></button>)}</nav>
        {loading && <p className="workspace-tools-status" role="status">Đang đọc cấu hình workspace…</p>}
        {error && <p className="workspace-tools-error" role="alert">{error}</p>}
        {!loading && !error && <div className="workspace-tools-body">
            <ul className="workspace-tools-list" aria-label={tabs.find((tab) => tab.kind === kind)?.label}>
                {items.map((item) => <li key={`${item.kind}:${item.path}:${item.name}`}><button className="workspace-tool-row" data-active={selected?.path === item.path && selected?.name === item.name} onClick={() => setSelectedPath(item.path)}><strong>{item.name}</strong><small>{item.path}</small></button></li>)}
                {!items.length && <li className="workspace-tools-empty">Chưa có mục trong workspace.</li>}
            </ul>
            <div className="workspace-tools-detail" aria-live="polite">
                {selected ? <><h3>{selected.name}</h3><p className="field-hint">{selected.path}</p>{selected.description && <p>{selected.description}</p>}{selected.mcp && <dl><dt>Transport</dt><dd>{selected.mcp.transport}</dd><dt>Fields</dt><dd>{selected.mcp.fields.length ? selected.mcp.fields.join(", ") : "Không có field an toàn để hiển thị"}</dd></dl>}{selected.content && <pre>{selected.content.slice(0, 16_000)}</pre>}<p className="field-hint">Chỉ đọc. SLTerm không tự bật skill/MCP, không chạy command và không lấy credential từ repo.</p></> : <p className="field-hint">Chọn một mục để xem mô tả.</p>}
            </div>
        </div>}
        {snapshot?.warnings.length ? <details className="workspace-tools-warnings"><summary>Cảnh báo ({snapshot.warnings.length})</summary><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
    </aside>;
}
