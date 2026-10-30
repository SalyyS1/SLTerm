import { useState } from "react";
import type { AiProvider } from "./ai-cli";
import type { TerminalRuntime } from "./terminal-runtime";
import { Icon } from "./workspace-icons";
import "./ai-chat-panel.css";

export function AiChatPanel({ runtime, openProvider, close }: {
    runtime: TerminalRuntime;
    openProvider: (provider: AiProvider, options?: { cwd?: string; prompt?: string }) => number | undefined;
    close: () => void;
}) {
    const [provider, setProvider] = useState<AiProvider>("claude");
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const send = async () => {
        const value = prompt.trim();
        if (!value || busy) return;
        setBusy(true); setNotice(null);
        try {
            const paneId = openProvider(provider, { prompt: value });
            if (!paneId) throw new Error("Chưa có workspace hoặc terminal chưa kết nối.");
            await runtime.waitForStarted(paneId);
            setPrompt("");
            setNotice(`Đã mở ${provider === "claude" ? "Claude" : "Codex"} CLI với prompt ban đầu · Terminal ${paneId}. Output và trạng thái CLI hiển thị trong terminal mới.`);
        } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    return <aside className="ai-chat-panel" aria-label="Chat với AI CLI">
        <header className="ai-chat-header"><div><Icon name="terminal" /><strong>AI chat</strong><span>CLI chính thức</span></div><button className="icon-button" aria-label="Đóng AI chat" title="Đóng" onClick={close}><Icon name="close" /></button></header>
        <div className="ai-chat-provider" role="group" aria-label="Provider">
            <button className="button" aria-pressed={provider === "claude"} onClick={() => setProvider("claude")}>Claude</button>
            <button className="button" aria-pressed={provider === "codex"} onClick={() => setProvider("codex")}>Codex</button>
        </div>
        <p className="field-hint">Prompt được truyền làm tham số khi mở CLI chính thức trong terminal riêng. Đăng nhập, quota và quyền vẫn do provider quản lý; SLTerm không đọc token.</p>
        <textarea aria-label="Prompt cho AI" placeholder="Mô tả việc cần làm…" value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); } }} />
        {notice && <p className="ai-chat-notice" role="status">{notice}</p>}
        <div className="ai-chat-actions"><span className="field-hint">Ctrl Enter để gửi</span><button className="button button-primary" disabled={busy || !prompt.trim()} onClick={() => void send()}>{busy ? "Đang mở CLI…" : "Gửi prompt"}</button></div>
    </aside>;
}
