import { useEffect, useRef, useState } from "react";
import { Icon } from "./workspace-icons";
import { listProjectDirectory, PROJECT_MAX_BYTES, projectError, type ProjectEntry, type ProjectRequest } from "./project-files";

type Props = { root: string; request: ProjectRequest; active: string | null; onOpen: (path: string) => void };
const sorted = (entries: ProjectEntry[]) => [...entries].sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));

export function ProjectExplorer({ root, request, active, onOpen }: Props) {
    const [path, setPath] = useState("");
    const [query, setQuery] = useState("");
    const [refresh, setRefresh] = useState(0);
    const [entries, setEntries] = useState<ProjectEntry[]>([]);
    const [next, setNext] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const generation = useRef(0);
    const search = query.trim().toLocaleLowerCase();
    useEffect(() => {
        const current = ++generation.current;
        let cancelled = false;
        setEntries([]); setNext(null); setError(null); setLoading(true);
        const cancelledNow = () => cancelled || generation.current !== current;
        const run = async () => {
            if (!search) {
                const page = await listProjectDirectory(request, root, path);
                if (!cancelledNow()) { setEntries(sorted(page.entries)); setNext(page.next); }
            } else {
                // Search real names below the project root, never following symlinks.
                const directories = [""];
                const visited = new Set<string>();
                const matches: ProjectEntry[] = [];
                while (directories.length && !cancelledNow()) {
                    const directory = directories.shift()!;
                    if (visited.has(directory)) continue;
                    visited.add(directory);
                    let cursor: number | null = 0;
                    do {
                        const page = await listProjectDirectory(request, root, directory, cursor);
                        if (cancelledNow()) return;
                        for (const entry of page.entries) {
                            if (entry.kind === "directory") directories.push(entry.path);
                            if (entry.name.toLocaleLowerCase().includes(search)) matches.push(entry);
                        }
                        setEntries(sorted(matches));
                        cursor = page.next;
                    } while (cursor !== null);
                }
            }
        };
        const timer = setTimeout(() => {
            void run().catch((reason) => { if (!cancelledNow()) setError(projectError(reason)); })
                .finally(() => { if (!cancelledNow()) setLoading(false); });
        }, search ? 200 : 0);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [root, request, path, search, refresh]);
    const more = async () => {
        if (next === null || loading) return;
        const current = generation.current;
        setLoading(true); setError(null);
        try {
            const page = await listProjectDirectory(request, root, path, next);
            if (generation.current === current) { setEntries((existing) => sorted([...existing, ...page.entries])); setNext(page.next); }
        } catch (reason) { if (generation.current === current) setError(projectError(reason)); }
        finally { if (generation.current === current) setLoading(false); }
    };
    const navigate = (target: string) => { setQuery(""); setPath(target); };
    const parts = path.split(/[\\/]/).filter(Boolean);
    return <aside className="project-explorer" aria-label="Tệp dự án">
        <div className="project-explorer-heading"><strong>Tệp dự án</strong><button className="icon-button" title="Làm mới danh sách" aria-label="Làm mới danh sách" onClick={() => setRefresh((value) => value + 1)}><Icon name="restore" /></button></div>
        <div className="project-search"><Icon name="search" /><input type="search" aria-label="Tìm tên tệp trong dự án" placeholder="Tìm tên tệp trong dự án…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <nav className="project-breadcrumbs" aria-label="Thư mục hiện tại"><button title={root} onClick={() => navigate("")}>{root.split(/[\\/]/).filter(Boolean).at(-1) ?? root}</button>{parts.map((part, index) => <span key={index}> / <button onClick={() => navigate(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}</nav>
        {!search && path && <button className="project-parent" onClick={() => navigate(parts.slice(0, -1).join("/"))}><Icon name="chevron-up" />Thư mục cha</button>}
        {error && <div className="project-explorer-error" role="alert"><span>{error}</span><button className="button" onClick={() => setRefresh((value) => value + 1)}>Thử lại</button></div>}
        <ul className="project-file-list" aria-label={search ? "Kết quả tìm tên" : "Nội dung thư mục"} aria-busy={loading}>
            {entries.map((entry) => {
                const blocked = entry.kind === "symlink" || (entry.kind === "file" && entry.total_bytes > PROJECT_MAX_BYTES);
                const note = entry.kind === "symlink" ? "Liên kết; không mở trong dự án" : blocked ? "Vượt giới hạn soạn thảo 8 MiB" : entry.kind === "directory" ? "Thư mục" : `${entry.total_bytes.toLocaleString()} byte`;
                return <li key={entry.path}><button disabled={blocked} data-active={entry.path === active} className="project-file-row" title={`${entry.path} · ${note}`} onClick={() => entry.kind === "directory" ? navigate(entry.path) : onOpen(entry.path)}>
                    {entry.kind === "directory" ? <Icon name="folder" /> : <span className="project-file-glyph" aria-hidden="true">{entry.kind === "symlink" ? "↗" : "▤"}</span>}
                    <span className="project-file-copy"><span>{entry.name}</span>{search && <small>{entry.path}</small>}</span>
                    {blocked && <small>{entry.kind === "symlink" ? "liên kết" : ">8 MiB"}</small>}
                </button></li>;
            })}
        </ul>
        <div className="project-explorer-status" role="status">{loading ? search ? `Đang tìm… ${entries.length} kết quả` : "Đang đọc thư mục…" : entries.length ? `${entries.length} ${search ? "kết quả" : "mục"}` : search ? "Không có tên phù hợp." : "Thư mục trống."}</div>
        {next !== null && !search && <button className="button project-more" disabled={loading} onClick={() => void more()}>Xem thêm</button>}
    </aside>;
}
