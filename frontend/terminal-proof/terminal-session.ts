import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITerminalOptions, type ITheme } from "@xterm/xterm";
import { Frame, OutputOrder, ProofTransport } from "./proof-protocol";
import { installTerminalClipboard } from "./terminal-clipboard";
import { TerminalInput } from "./terminal-input";
import { replayTranscript, type TranscriptRequest } from "./terminal-transcript";

export type SessionStatus = "starting" | "running" | "closing" | "exited" | "error";
export type SessionInfo = { status: SessionStatus; exitCode?: number; message?: string; restored?: boolean; warning?: string };
export type ShellEnvironment = { executable: string; cwd: string; pid: number; args: string[] };
export type SpawnCommand = { executable: string; args: string[] };

export class TerminalSession {
    readonly surface = document.createElement("div");
    readonly terminal: Terminal;
    readonly search = new SearchAddon();
    info: SessionInfo = { status: "starting" };
    finished = false;
    private fit = new FitAddon();
    private order = new OutputOrder();
    private input: TerminalInput;
    private clipboard?: ReturnType<typeof installTerminalClipboard>;
    private opened = false;
    private spawned?: Promise<void>;
    private closing?: Promise<void>;
    private closeRequested = false;
    private disconnectedMessage?: string;
    private exitReceived = false;
    private disposed = false;
    private replayCancellation = new AbortController();
    private cols = 0;
    private rows = 0;
    private resizing = false;
    private waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
    private attachReadyResolve!: () => void;
    private attachReady = new Promise<void>((resolve) => { this.attachReadyResolve = resolve; });
    private attachReadySettled = false;

    constructor(
        readonly id: number,
        readonly cwd: string,
        private transport: ProofTransport,
        private environment: ShellEnvironment | undefined,
        private changed: (id: number, info: SessionInfo) => void,
        private fail: (error: unknown) => void,
        fontSize: number,
        theme: ITheme,
        options: Partial<ITerminalOptions> = {},
        readonly runId: string = crypto.randomUUID(),
        private replay?: { request: TranscriptRequest; runId?: string },
        readonly workspaceId?: string,
        private command?: SpawnCommand
    ) {
        if (replay) {
            this.info = { status: "exited", restored: true, message: replay.runId ? "Bản phát lại transcript; không có tiến trình đang chạy." : "Không có transcript đã lưu cho phiên terminal này." };
            this.finished = true;
        }
        this.surface.className = "terminal-surface";
        this.terminal = new Terminal({
            fontFamily: '"Cascadia Mono", Consolas, monospace',
            fontSize,
            scrollback: 5000,
            theme,
            cursorBlink: true,
            allowProposedApi: true,
            // Keep shell-selected ANSI colors readable against both light and dark backgrounds.
            minimumContrastRatio: 4.5,
            ...options,
            // Transparency must be enabled before opening a renderer; workspace backgrounds may change later.
            allowTransparency: true,
        });
        this.terminal.loadAddon(this.fit);
        this.terminal.loadAddon(this.search);
        this.input = new TerminalInput(
            (data) => this.transport.request("input", { session_id: id, data, run_id: this.runId }),
            (error, uncertain) => {
                if (uncertain && !this.finished && !this.closeRequested) {
                    this.update({
                        status: "error",
                        message: "Input delivery is uncertain; input was not replayed. " + String(error),
                    });
                    this.terminal.writeln("\r\n[input delivery uncertain: " + String(error) + "]");
                }
                this.fail(error);
            }
        );
        this.terminal.onData((data) => {
            if (!this.replay && !this.closeRequested && (this.info.status === "starting" || this.info.status === "running"))
                this.input.enqueue(data);
        });
    }

    attach(element: HTMLElement) {
        if (this.disposed || (!this.opened && (this.closeRequested || this.finished && !this.replay))) return;
        element.append(this.surface);
        if (!this.opened) {
            this.opened = true;
            this.terminal.open(this.surface);
            try {
                const renderer = new WebglAddon();
                renderer.onContextLoss(() => renderer.dispose());
                this.terminal.loadAddon(renderer);
            } catch {
                /* Xterm's default renderer stays available. */
            }
            this.clipboard = installTerminalClipboard(this.terminal, this.surface, {
                readText: () => invoke<string>("proof_clipboard_read"),
                writeText: (text) => invoke("proof_clipboard_write", { text }),
                canPaste: () => !this.closeRequested && !this.finished && this.info.status === "running",
                onError: this.fail,
            });
            this.fit.fit();
            this.cols = this.terminal.cols;
            this.rows = this.terminal.rows;
            this.spawned = this.replay ? this.restoreTranscript() : this.spawn();
            if (!this.attachReadySettled) { this.attachReadySettled = true; this.attachReadyResolve(); }
        }
        this.resize();
    }

    private update(info: SessionInfo) {
        this.info = info;
        this.changed(this.id, info);
    }

    private async spawn() {
        const environment = this.environment;
        if (!environment) throw new Error("Missing shell environment.");
        try {
            await this.transport.request("spawn", {
                session_id: this.id,
                executable: this.command?.executable ?? environment.executable,
                cwd: this.cwd,
                args: this.command?.args ?? environment.args,
                run_id: this.runId,
                workspace_id: this.workspaceId,
                cols: this.cols,
                rows: this.rows,
            });
            if (!this.finished && !this.exitReceived && !this.disconnectedMessage) {
                this.update({ status: this.closeRequested ? "closing" : "running" });
                if (!this.closeRequested) {
                    this.input.resume();
                    this.resize();
                }
            }
        } catch (error) {
            this.input.stop();
            if (!this.finished) this.update({ status: "error", message: this.disconnectedMessage ?? String(error) });
            this.terminal.writeln("\r\n[Không xác nhận được khởi chạy: " + String(error) + "]");
            this.fail(error);
        }
    }

    private async restoreTranscript() {
        if (!this.replay) return;
        try {
            if (!this.replay.runId) {
                await this.writeReplay(new TextEncoder().encode("\r\n[Phiên cũ không có lịch sử đã lưu · không có process đang chạy]\r\n"));
                return;
            }
            const metadata = await replayTranscript(this.replay.request, this.replay.runId, (bytes) => this.writeReplay(bytes), () => this.disposed);
            const warning = metadata.truncated ? `Lịch sử bị cắt: ${metadata.omitted_bytes} byte không được lưu.`
                : metadata.stream_error ? `Lịch sử thiếu dữ liệu: ${metadata.stream_error}`
                : !metadata.capture_complete ? "Lịch sử chưa hoàn tất; process không còn chạy." : undefined;
            const marker = warning ?? `Lịch sử đã lưu · process đã dừng: ${metadata.exit_code}`;
            await this.writeReplay(new TextEncoder().encode(`\x18\x1b[0m\r\n[${marker}]\r\n`));
            if (!this.disposed) this.update({ ...this.info, status: "exited", exitCode: metadata.exit_code ?? undefined, warning });
        } catch (error) {
            if (!this.disposed) { this.update({ ...this.info, status: "exited", warning: String(error), message: String(error) }); this.fail(error); }
        }
    }

    private writeReplay(bytes: Uint8Array): Promise<void> {
        return new Promise((resolve, reject) => {
            const signal = this.replayCancellation.signal;
            if (signal.aborted) { reject(new Error("Transcript replay cancelled.")); return; }
            const cancel = () => reject(new Error("Transcript replay cancelled."));
            signal.addEventListener("abort", cancel, { once: true });
            this.terminal.write(bytes, () => { signal.removeEventListener("abort", cancel); resolve(); });
        });
    }

    resize() {
        if (
            !this.opened ||
            !this.surface.isConnected ||
            this.surface.clientWidth < 20 ||
            this.surface.clientHeight < 20
        )
            return;
        this.fit.fit();
        if (this.info.status === "running" && !this.resizing) void this.flushResize();
    }

    private async flushResize() {
        this.resizing = true;
        try {
            while (this.info.status === "running") {
                const { cols, rows } = this.terminal;
                if (cols === this.cols && rows === this.rows) break;
                await this.transport.request("resize", { session_id: this.id, cols, rows });
                this.cols = cols;
                this.rows = rows;
            }
        } catch (error) {
            if (!this.finished && !this.closeRequested) this.fail(error);
        } finally {
            this.resizing = false;
        }
    }

    receive(frame: Frame) {
        if (frame.event === "output") {
            if (!frame.data) throw new Error("Empty terminal output frame");
            this.order.next(frame.sequence);
            const bytes = Uint8Array.from(atob(frame.data), (ch) => ch.charCodeAt(0));
            if (bytes.length > 4096) throw new Error("Output chunk exceeds protocol limit");
            this.terminal.write(bytes, () => {
                void this.transport.request("ack", { session_id: this.id, sequence: frame.sequence }).catch((error) => {
                    if (!this.finished) this.fail(error);
                });
            });
        } else if (frame.event === "exit") {
            this.order.finish(frame.last_sequence);
            this.exitReceived = true;
            this.input.stop();
            // Render final output and exit marker before any UI owner removes this surface.
            this.terminal.write("\r\n[process exited: " + frame.exit_code + "]\r\n", () => {
                this.confirmExit(frame.exit_code);
            });
        } else if (frame.event === "gap") {
            this.terminal.writeln("\r\n[Output bị ngắt khi dừng: " + frame.discarded_bytes + " bytes]");
        } else if (frame.event === "input-error") {
            this.input.stop();
            this.update({ status: "error", message: "Không chắc trạng thái nhập; không tự gửi lại." });
            this.terminal.writeln("\r\n[input delivery uncertain: " + frame.affected_bytes + " bytes]");
            this.fail(frame.error_code ?? "Input delivery is uncertain");
        } else if (frame.event === "archive-warning" || frame.event === "stream-error") {
            const warning = frame.message ?? frame.error_code ?? "Transcript capture warning";
            this.update({ ...this.info, warning, message: warning });
        }
    }

    private confirmExit(exitCode?: number) {
        if (this.finished) return;
        this.finished = true;
        this.update({ ...this.info, status: "exited", exitCode });
        for (const waiter of this.waiters) waiter.resolve();
        this.waiters.clear();
    }

    /** Send a one-shot prompt from the integrated chat after the CLI is ready. */
    async sendInput(data: string): Promise<void> {
        if (this.finished || this.closeRequested) throw new Error("Terminal đã dừng.");
        await this.attachReady;
        await this.spawned;
        if (this.finished || this.closeRequested || this.info.status !== "running") throw new Error("CLI chưa sẵn sàng nhận prompt.");
        await this.transport.request("input", { session_id: this.id, data, run_id: this.runId });
    }

    close(): Promise<void> {
        if (this.finished) return Promise.resolve();
        if (this.closing) return this.closing;
        this.closing = this.stopProcess().finally(() => {
            this.closing = undefined;
        });
        return this.closing;
    }

    private async stopProcess() {
        this.closeRequested = true;
        this.input.stop();
        this.update({ ...this.info, status: "closing" });
        if (!this.opened) {
            if (!this.attachReadySettled) { this.attachReadySettled = true; this.attachReadyResolve(); }
            this.confirmExit();
            return;
        }
        let cancelWaiter = () => {};
        try {
            await this.spawned;
            if (this.finished) return;
            if (this.disconnectedMessage) throw new Error(this.disconnectedMessage);
            const exited = new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    clearTimeout(timer);
                    this.waiters.delete(waiter);
                };
                const waiter = {
                    resolve: () => {
                        cleanup();
                        resolve();
                    },
                    reject: (error: Error) => {
                        cleanup();
                        reject(error);
                    },
                };
                const timer = setTimeout(() => {
                    waiter.reject(new Error("Chưa xác nhận terminal đã dừng. Giữ ô này để thử lại."));
                }, 15000);
                this.waiters.add(waiter);
                cancelWaiter = cleanup;
                // Handle stop failure immediately, while the exit promise already has its consumer below.
                void this.transport.request("stop", { session_id: this.id }).catch((error) => {
                    if (this.finished || this.exitReceived) return;
                    if (error instanceof Error && error.message === "UnknownSession") {
                        // A failed spawn has no process; still drain xterm's queued writes before release.
                        this.terminal.write("", () => this.confirmExit());
                    } else waiter.reject(error instanceof Error ? error : new Error(String(error)));
                });
            });
            await exited;
        } catch (error) {
            if (!this.finished) {
                this.update({ status: "error", message: String(error) });
                this.fail(error);
                throw error;
            }
        } finally {
            cancelWaiter();
        }
    }

    disconnected(message: string) {
        this.disconnectedMessage = message;
        this.input.stop();
        if (!this.finished) this.update({ status: "error", message });
        for (const waiter of this.waiters) waiter.reject(new Error(message));
        this.waiters.clear();
    }

    dispose() {
        if (!this.finished) throw new Error("Cannot dispose an unconfirmed process");
        if (this.disposed) return;
        this.disposed = true;
        this.replayCancellation.abort();
        this.clipboard?.dispose();
        this.terminal.dispose();
        this.surface.remove();
    }
}
