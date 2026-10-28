import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import "./resource-monitor.css";

type ProcessUsage = { pid: number; name: string; category: string; working_bytes: number; private_bytes: number };
type ResourceSample = { version: 1; scope: "owned-descendants"; items: ProcessUsage[]; missing: number; cpu_percent: number | null; logical_cpus: number; interval_ms: number | null };
const labels: Record<string, string> = { application: "SLTerm", backend: "Zig core", webview: "WebView", console: "Console", shell: "Shell", provider: "AI CLI", other: "Khác" };
const mib = (bytes: number) => (bytes / 1048576).toLocaleString("vi-VN", { maximumFractionDigits: 1 });

/** Sample only while the user has opened the panel; there is no idle polling. */
export function ResourceMonitor() {
    const [open, setOpen] = useState(false);
    const [sample, setSample] = useState<ResourceSample | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        let disposed = false;
        let timer: ReturnType<typeof setTimeout>;
        const collect = async () => {
            if (!document.hidden) {
                setPending(true);
                try {
                    const next = await invoke<ResourceSample>("proof_resources");
                    if (!disposed) { setSample(next); setError(null); }
                } catch (issue) { if (!disposed) setError(String(issue)); }
                finally { if (!disposed) setPending(false); }
            }
            if (!disposed) timer = setTimeout(() => { void collect(); }, 2000);
        };
        void collect();
        const dismiss = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
        const key = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.stopPropagation(); setOpen(false); button.current?.focus(); }
        };
        document.addEventListener("pointerdown", dismiss);
        document.addEventListener("keydown", key, true);
        return () => { disposed = true; clearTimeout(timer); document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", key, true); };
    }, [open]);
    const grouped = new Map<string, { count: number; working: number; private: number }>();
    for (const item of sample?.items ?? []) {
        const value = grouped.get(item.category) ?? { count: 0, working: 0, private: 0 };
        value.count++; value.working += item.working_bytes; value.private += item.private_bytes;
        grouped.set(item.category, value);
    }
    const total = [...grouped.values()].reduce((sum, group) => ({ count: sum.count + group.count, working: sum.working + group.working, private: sum.private + group.private }), { count: 0, working: 0, private: 0 });
    return <div className="resource-monitor" ref={container}>
        <button ref={button} className="icon-button resource-toggle" aria-label="Tài nguyên tiến trình" title="Tài nguyên tiến trình" aria-expanded={open} aria-controls="resource-panel" onClick={() => setOpen(!open)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Tài nguyên</span>
        </button>
        {open && <section className="resource-panel" id="resource-panel" aria-label="Tài nguyên tiến trình" aria-busy={pending}>
            <header><strong>Tài nguyên</strong><span>{pending ? "Đang đo…" : "Cập nhật mỗi 2 giây"}</span></header>
            {error && <p className="resource-error" role="alert">Không đo được: {error}. Đang thử lại.</p>}
            {!sample ? !error && <p>Đang đọc tiến trình của SLTerm…</p> : <>
                <div className="resource-summary"><strong>{sample.cpu_percent === null ? "Đang lấy mẫu CPU" : `${sample.cpu_percent.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% CPU`}</strong><span>{total.count} tiến trình · {sample.logical_cpus} CPU logic</span></div>
                <div className="resource-table-wrap"><table><thead><tr><th>Thành phần</th><th title="Tổng working set; có thể đếm lặp trang chia sẻ">Working set</th><th title="Private commit; khác với RAM vật lý đang dùng">Private commit</th></tr></thead><tbody>
                    {[...grouped].map(([name, value]) => <tr key={name}><th scope="row">{labels[name] ?? "Khác"}<small> × {value.count}</small></th><td>{mib(value.working)} MiB</td><td>{mib(value.private)} MiB</td></tr>)}
                    <tr className="resource-total"><th scope="row">Tổng đo được</th><td>{mib(total.working)} MiB</td><td>{mib(total.private)} MiB</td></tr>
                </tbody></table></div>
                {sample.missing > 0 && <p className="resource-error" role="status">Chưa đọc được {sample.missing} tiến trình con; tổng hiện tại chưa đầy đủ.</p>}
                <p className="resource-note">Chỉ cây tiến trình SLTerm. WSL, AI/MCP hoặc dịch vụ chạy ngoài cây này chưa được tính. Working set có thể đếm lặp vùng nhớ chia sẻ; private commit không phải RAM vật lý.</p>
                <p className="resource-note">CPU tính từ các tiến trình có trong cả hai mẫu, theo toàn máy. Không áp trần số terminal hoặc agent.</p>
            </>}
        </section>}
    </div>;
}
