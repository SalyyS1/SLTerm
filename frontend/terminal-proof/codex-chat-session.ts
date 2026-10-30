import type { TerminalRuntime, ProviderFrame } from "./terminal-runtime";
import { CodexChatRuntime, type CodexRuntimeEvent, type CodexRuntimeState } from "./codex-chat-runtime";
import { validatePinnedCodexSchema } from "./codex-chat-validator";

export type CodexChatSessionOptions = {
    runtime: TerminalRuntime;
    providerId: number;
    cwd: string;
    onEvent?: (event: CodexRuntimeEvent) => void;
    onState?: (state: CodexRuntimeState) => void;
};

/** Bridges Zig provider frames to the browser-safe Codex app-server runtime. */
export class CodexChatSession {
    private readonly runtime: TerminalRuntime;
    private readonly providerId: number;
    private readonly cwd: string;
    private readonly onEvent?: (event: CodexRuntimeEvent) => void;
    private readonly onState?: (state: CodexRuntimeState) => void;
    private readonly decoder = new TextDecoder();
    private lineBuffer = "";
    private unsubscribe?: () => void;
    private providerExited = false;
    private readonly protocol: CodexChatRuntime;

    constructor(options: CodexChatSessionOptions) {
        this.runtime = options.runtime;
        this.providerId = options.providerId;
        this.cwd = options.cwd;
        this.onEvent = options.onEvent;
        this.onState = options.onState;
        this.protocol = new CodexChatRuntime({
            validate: validatePinnedCodexSchema,
            send: (message) => this.sendFrame(message),
            onEvent: (event) => { this.onState?.(this.protocol.state); this.onEvent?.(event); },
        });
    }

    get state(): CodexRuntimeState { return this.protocol.state; }
    get conversation() { return this.protocol.conversation; }

    async start(): Promise<void> {
        if (this.protocol.state !== "new") throw new Error("Codex session đã khởi tạo.");
        this.unsubscribe = this.runtime.onProvider(this.providerId, (frame) => this.receiveProvider(frame));
        try {
            await this.runtime.startCodexProvider(this.providerId, this.cwd);
            await this.protocol.initialize({ name: "slterm", version: "0.20.0", title: "SLTerm" });
            await this.protocol.startThread({ cwd: this.cwd, ephemeral: true });
            this.onState?.(this.protocol.state);
        } catch (error) {
            this.close();
            throw error;
        }
    }

    sendPrompt(prompt: string): Promise<unknown> {
        const value = prompt.trim();
        if (!value) return Promise.reject(new Error("Prompt rỗng."));
        return this.protocol.startTurn([{ type: "text", text: value, text_elements: [] }]);
    }

    cancel(): Promise<void> { return this.protocol.cancelTurn(); }

    close(): void {
        this.protocol.close();
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        if (!this.providerExited) {
            this.providerExited = true;
            void this.runtime.stopProvider(this.providerId).catch(() => undefined);
        }
    }

    private sendFrame(message: Record<string, unknown>): Promise<void> {
        return this.runtime.sendProvider(this.providerId, JSON.stringify(message) + "\n");
    }

    private receiveProvider(frame: ProviderFrame): void {
        if (frame.event === "provider.exit") {
            this.providerExited = true;
            if (this.protocol.state !== "closed" && this.protocol.state !== "completed") this.protocol.close();
            this.onState?.(this.protocol.state);
            return;
        }
        if (frame.event !== "provider.output" || !frame.data) return;
        const bytes = Uint8Array.from(atob(frame.data), (character) => character.charCodeAt(0));
        this.lineBuffer += this.decoder.decode(bytes, { stream: true });
        let newline: number;
        while ((newline = this.lineBuffer.indexOf("\n")) >= 0) {
            const line = this.lineBuffer.slice(0, newline).replace(/\r$/, "");
            this.lineBuffer = this.lineBuffer.slice(newline + 1);
            if (!line.trim()) continue;
            try { this.protocol.receive(line); }
            catch { this.protocol.close(); this.onState?.(this.protocol.state); return; }
        }
    }
}

