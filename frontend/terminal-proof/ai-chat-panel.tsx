import { useEffect, useRef, useState } from "react";
import type { AiProvider } from "./ai-cli";
import type { TerminalRuntime } from "./terminal-runtime";
import { CodexChatSession } from "./codex-chat-session";
import type { CodexRuntimeEvent } from "./codex-chat-runtime";
import { Icon } from "./workspace-icons";
import "./ai-chat-panel.css";

export function AiChatPanel({ runtime, cwd, openProvider, close }: {
    runtime: TerminalRuntime;
    openProvider: (provider: AiProvider, options?: { cwd?: string; prompt?: string }) => number | undefined;
    cwd: string;
    close: () => void;
}) {
    const [provider, setProvider] = useState<AiProvider>("claude");
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [transcript, setTranscript] = useState("");
    const [appServerUnavailable, setAppServerUnavailable] = useState(false);
    const session = useRef<CodexChatSession | null>(null);
    const providerId = useRef(Math.max(1, Date.now() % Number.MAX_SAFE_INTEGER));
    useEffect(() => () => session.current?.close(), []);
    const handleCodexEvent = (event: CodexRuntimeEvent) => {
        if (event.type === "agentMessageDelta") setTranscript((current) => current + event.delta);
        if (event.type === "turnCompleted") setBusy(false);
        if (event.type === "providerError") {
            setBusy(false);
            setNotice(event.willRetry ? "Codex sẽ thử lại lượt này." : "Codex báo lỗi; kiểm tra output hoặc mở CLI fallback.");
        }
    };
    const send = async () => {
        const value = prompt.trim();
        if (!value || busy) return;
        setBusy(true); setNotice(null);
        try {
            if (provider === "codex" && !appServerUnavailable) {
                if (!session.current) {
                    session.current = new CodexChatSession({ runtime, providerId: providerId.current, cwd, onEvent: handleCodexEvent });
                    await session.current.start();
                }
                setTranscript((current) => current ? `${current}\n\n> ${value}\n` : `> ${value}\n`);
                await session.current.sendPrompt(value);
                setPrompt("");
                return;
            }
            const paneId = openProvider(provider, { prompt: value });
            if (!paneId) throw new Error("Chưa có workspace hoặc terminal chưa kết nối.");
            await runtime.waitForStarted(paneId);
            setPrompt("");
            setNotice(`Đã mở ${provider === "claude" ? "Claude" : "Codex"} CLI với prompt ban đầu · Terminal ${paneId}. Output và trạng thái CLI hiển thị trong terminal mới.`);
        } catch (error) {
            if (provider === "codex") {
                session.current?.close(); session.current = null; setAppServerUnavailable(true);
                setNotice(`Codex app-server chưa sẵn sàng: ${error instanceof Error ? error.message : String(error)}. Bạn có thể mở Codex CLI fallback.`);
            } else setNotice(error instanceof Error ? error.message : String(error));
            setBusy(false);
        }
    };
    const cancel = async () => {
        if (!session.current) return;
        try { await session.current.cancel(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    };
    return <aside className="ai-chat-panel" aria-label="Chat với AI CLI">
        <header className="ai-chat-header"><div><Icon name="terminal" /><strong>AI chat</strong><span>CLI chính thức</span></div><button className="icon-button" aria-label="Đóng AI chat" title="Đóng" onClick={close}><Icon name="close" /></button></header>
        <div className="ai-chat-provider" role="group" aria-label="Provider">
            <button className="button" aria-pressed={provider === "claude"} onClick={() => setProvider("claude")}>Claude</button>
            <button className="button" aria-pressed={provider === "codex"} onClick={() => setProvider("codex")}>Codex</button>
        </div>
        <p className="field-hint">{provider === "codex" && !appServerUnavailable ? "Codex app-server chạy qua Zig stdio, stream delta trực tiếp trong chat." : "Prompt được truyền làm tham số khi mở CLI chính thức trong terminal riêng."} Đăng nhập, quota và quyền vẫn do provider quản lý; SLTerm không đọc token.</p>
        <textarea aria-label="Prompt cho AI" placeholder="Mô tả việc cần làm…" value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); } }} />
        {transcript && <pre className="ai-chat-transcript" aria-live="polite">{transcript}</pre>}
        {notice && <p className="ai-chat-notice" role="status">{notice}</p>}
        <div className="ai-chat-actions"><span className="field-hint">Ctrl Enter để gửi</span><div className="ai-chat-buttons">{busy && provider === "codex" && <button className="button" onClick={() => void cancel()}>Huỷ lượt</button>}{appServerUnavailable && provider === "codex" && <button className="button" onClick={() => { setAppServerUnavailable(false); setNotice(null); }}>Thử app-server lại</button>}<button className="button button-primary" disabled={busy || !prompt.trim()} onClick={() => void send()}>{busy ? "Đang chạy…" : provider === "codex" && !appServerUnavailable ? "Gửi vào Codex" : "Mở CLI với prompt"}</button></div></div>
    </aside>;
}
