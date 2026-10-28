import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ITerminalOptions } from "@xterm/xterm";
import { Frame, ProofTransport } from "./proof-protocol";
import { DEFAULT_FONT_SIZE, nextFontSize } from "./terminal-font";
import { TerminalSession, type SessionInfo, type ShellEnvironment } from "./terminal-session";

export type RuntimeSnapshot = {
    phase: "starting" | "connected" | "stopping" | "disconnected";
    error: string | null;
    fontSize: number;
    theme: "dark" | "light";
    sessions: Record<number, SessionInfo>;
    closeRequested: boolean;
    shutdownIssue: string | null;
};

/** Owns live terminal identity independently of React tabs or split-tree positions. */
export class TerminalRuntime {
    private sessions = new Map<number, TerminalSession>();
    private subscribers = new Set<() => void>();
    private snapshot: RuntimeSnapshot = {
        phase: "starting",
        error: null,
        fontSize: DEFAULT_FONT_SIZE,
        theme: "dark",
        sessions: {},
        closeRequested: false,
        shutdownIssue: null,
    };
    private transport = new ProofTransport((request) => invoke("proof_request", { request }));
    private environment?: ShellEnvironment;
    private starting?: Promise<ShellEnvironment>;
    private observer = new ResizeObserver(() => this.scheduleResize());
    private resizeTimer?: ReturnType<typeof setTimeout>;
    subscribe = (listener: () => void) => {
        this.subscribers.add(listener);
        return () => {
            this.subscribers.delete(listener);
        };
    };
    getSnapshot = () => this.snapshot;
    private update(patch: Partial<RuntimeSnapshot>) {
        this.snapshot = { ...this.snapshot, ...patch };
        for (const listener of this.subscribers) listener();
    }
    report = (error: unknown) => this.update({ error: String(error) });
    clearError = () => this.update({ error: null });
    consumeCloseRequest = () => this.update({ closeRequested: false });

    start() {
        return (this.starting ??= (async () => {
            await listen<Frame>("proof-event", ({ payload }) => this.receive(payload));
            this.environment = await invoke<ShellEnvironment>("proof_start");
            await this.transport.request("hello");
            this.update({ phase: "connected" });
            return this.environment;
        })().catch((error) => {
            this.update({ phase: "disconnected", error: String(error) });
            throw error;
        }));
    }

    private palette() {
        const styles = getComputedStyle(document.body);
        const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
        return {
            background: token("--terminal-bg", "#12161d"),
            foreground: token("--terminal-fg", "#d4dce9"),
            cursor: token("--accent", "#7bc4ba"),
            selectionBackground: token("--selection-bg", "#345c60"),
        };
    }

    prepare(id: number, cwd: string, options: Partial<ITerminalOptions> = {}) {
        if (!this.environment || this.snapshot.phase !== "connected") throw new Error("Terminal chưa kết nối.");
        if (this.sessions.has(id)) throw new Error("Duplicate terminal identity");
        const session = new TerminalSession(
            id,
            cwd,
            this.transport,
            this.environment,
            (paneId, info) => {
                this.update({ sessions: { ...this.snapshot.sessions, [paneId]: info } });
            },
            this.report,
            this.snapshot.fontSize,
            this.palette(),
            options
        );
        this.sessions.set(id, session);
        this.update({ sessions: { ...this.snapshot.sessions, [id]: session.info } });
    }

    attach(id: number, element: HTMLElement) {
        const session = this.sessions.get(id);
        if (!session) return () => {};
        session.attach(element);
        this.observer.observe(element);
        this.scheduleResize();
        return () => {
            this.observer.unobserve(element);
        };
    }
    focus(id: number | null) {
        if (id !== null) this.sessions.get(id)?.terminal.focus();
    }
    scheduleResize() {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
            for (const session of this.sessions.values()) session.resize();
        }, 60);
    }
    /** Update existing renderers, including hidden/stopped transcripts, without replacing sessions. */
    applyAppearance(ids: number[], options: Partial<ITerminalOptions>) {
        for (const id of ids) {
            const session = this.sessions.get(id);
            if (session) session.terminal.options = { ...options };
        }
        this.scheduleResize();
    }
    font(delta: number | "reset") {
        const fontSize = nextFontSize(this.snapshot.fontSize, delta);
        for (const session of this.sessions.values()) session.terminal.options.fontSize = fontSize;
        this.update({ fontSize });
        this.scheduleResize();
    }
    theme(theme: "dark" | "light") {
        document.body.dataset.theme = theme;
        for (const session of this.sessions.values()) session.terminal.options.theme = this.palette();
        this.update({ theme });
    }
    search(id: number, query: string, previous = false, caseSensitive = false) {
        const session = this.sessions.get(id);
        if (!session) return false;
        if (!query) {
            session.search.clearDecorations();
            return false;
        }
        const options = {
            caseSensitive,
            decorations: {
                matchBackground: "#345c60",
                matchOverviewRuler: "#7bc4ba",
                activeMatchBackground: "#785b2c",
                activeMatchColorOverviewRuler: "#f2c87c",
            },
        };
        return previous ? session.search.findPrevious(query, options) : session.search.findNext(query, options);
    }
    clearSearch(id: number) {
        this.sessions.get(id)?.search.clearDecorations();
    }

    async close(id: number) {
        await this.sessions.get(id)?.close();
    }
    release(id: number) {
        this.sessions.get(id)?.dispose();
        this.sessions.delete(id);
        const sessions = { ...this.snapshot.sessions };
        delete sessions[id];
        this.update({ sessions });
    }
    async quit() {
        const phase = this.snapshot.phase;
        this.update({ phase: "stopping" });
        try {
            await invoke("proof_quit");
        } catch (error) {
            this.update({ phase, shutdownIssue: String(error) });
            this.report(error);
            throw error;
        }
    }

    async forceQuit() {
        if (!this.snapshot.shutdownIssue) throw new Error("Chưa có shutdown lỗi để buộc thoát.");
        const phase = this.snapshot.phase;
        this.update({ phase: "stopping" });
        try { await invoke("proof_force_quit"); }
        catch (error) {
            this.update({ phase });
            this.report(error);
            throw error;
        }
    }

    private receive(frame: Frame) {
        try {
            if (this.transport.receive(frame)) return;
            if (frame.session_id !== undefined) {
                const session = this.sessions.get(frame.session_id);
                if (!session) throw new Error("Frame for unknown terminal " + frame.session_id);
                session.receive(frame);
                return;
            }
            if (frame.event === "transport_closed" || frame.event === "transport_error") {
                const message = frame.message ?? "Backend đã ngắt kết nối.";
                this.transport.close(message);
                for (const session of this.sessions.values()) session.disconnected(message);
                this.update({ phase: "disconnected", error: this.snapshot.phase === "stopping" ? null : message });
            } else if (frame.event === "close_requested") this.update({ closeRequested: true });
            else if (frame.event === "shutdown_started") this.update({ phase: "stopping" });
            else if (frame.event === "shutdown_stalled")
                this.update({ phase: this.snapshot.phase === "disconnected" ? "disconnected" : "connected", error: frame.message ?? "Chưa xác nhận được dừng. Thử lại.",
                    shutdownIssue: frame.message ?? "Chưa xác nhận được dừng. Thử lại." });
        } catch (error) {
            this.report(error);
        }
    }
}
