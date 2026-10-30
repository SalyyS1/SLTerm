/** Browser-safe Codex app-server conversation state machine.
 *
 * The generated provider schemas are intentionally not imported here: they
 * depend on Node/Ajv. Callers must inject a validator for the exact pinned
 * schema names. Without one, every protocol operation fails closed.
 */

export type CodexRuntimeState =
    | "new"
    | "initializing"
    | "ready"
    | "thread-starting"
    | "idle"
    | "running"
    | "retrying"
    | "cancelling"
    | "completed"
    | "failed"
    | "closed";

export type CodexMessage = Record<string, unknown>;
export type CodexSchemaValidator = (schema: string, value: unknown) => void | boolean;
export type CodexSend = (message: CodexMessage) => void | Promise<void>;

export type CodexRuntimeEvent =
    | { type: "initialized"; result: unknown }
    | { type: "threadStarted"; threadId: string; result: unknown }
    | { type: "turnStarted"; threadId: string; turnId: string }
    | { type: "agentMessageDelta"; threadId: string; turnId: string; itemId: string; delta: string }
    | { type: "turnInterruptAcknowledged"; threadId: string; turnId: string }
    | { type: "turnCompleted"; threadId: string; turnId: string; status: string; result: unknown }
    | { type: "providerError"; threadId: string; turnId: string; willRetry: boolean; error: unknown };

export type CodexChatRuntimeOptions = {
    send: CodexSend;
    onEvent?: (event: CodexRuntimeEvent) => void;
    event?: (event: CodexRuntimeEvent) => void;
    validate?: CodexSchemaValidator;
    validator?: CodexSchemaValidator;
    maxPendingRequests?: number;
    maxFrameBytes?: number;
};

type Pending = {
    schema?: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
};

export const MAX_PENDING_REQUESTS = 64;
export const MAX_FRAME_BYTES = 256 * 1024;

export class CodexChatRuntimeError extends Error {
    constructor(public readonly code: string, message = code) {
        super(message);
        this.name = "CodexChatRuntimeError";
    }
}

/** One conversation. It never stores credentials or provider tokens. */
export class CodexChatRuntime {
    private readonly sendMessage: CodexSend;
    private readonly emitEvent?: (event: CodexRuntimeEvent) => void;
    private readonly validate?: CodexSchemaValidator;
    private readonly requestLimit: number;
    private readonly frameLimit: number;
    private readonly pending = new Map<string | number, Pending>();
    private sequence = 0;
    private _state: CodexRuntimeState = "new";
    private threadId?: string;
    private turnId?: string;

    constructor(options: CodexChatRuntimeOptions);
    constructor(send: CodexSend, onEvent?: (event: CodexRuntimeEvent) => void, validate?: CodexSchemaValidator);
    constructor(
        optionsOrSend: CodexChatRuntimeOptions | CodexSend,
        onEvent?: (event: CodexRuntimeEvent) => void,
        validate?: CodexSchemaValidator,
    ) {
        const options = typeof optionsOrSend === "function"
            ? { send: optionsOrSend, onEvent, validate }
            : optionsOrSend;
        if (typeof options.send !== "function") throw new CodexChatRuntimeError("INVALID_TRANSPORT");
        this.sendMessage = options.send;
        this.emitEvent = options.onEvent ?? options.event;
        this.validate = options.validate ?? options.validator;
        this.requestLimit = options.maxPendingRequests ?? MAX_PENDING_REQUESTS;
        this.frameLimit = options.maxFrameBytes ?? MAX_FRAME_BYTES;
        if (!Number.isSafeInteger(this.requestLimit) || this.requestLimit < 1 || this.requestLimit > MAX_PENDING_REQUESTS)
            throw new CodexChatRuntimeError("INVALID_REQUEST_LIMIT");
        if (!Number.isSafeInteger(this.frameLimit) || this.frameLimit < 1 || this.frameLimit > MAX_FRAME_BYTES)
            throw new CodexChatRuntimeError("INVALID_FRAME_LIMIT");
    }

    get state(): CodexRuntimeState { return this._state; }
    getState(): CodexRuntimeState { return this._state; }
    get conversation(): { threadId?: string; turnId?: string } {
        return { threadId: this.threadId, turnId: this.turnId };
    }

    async initialize(clientInfo: { name: string; version: string; title?: string | null }): Promise<unknown> {
        this.requireState("new");
        const params = {
            clientInfo,
            capabilities: { experimentalApi: false, explicitGatewayOauth: true },
        };
        this.assertSchema("InitializeParams", params);
        this._state = "initializing";
        try {
            const result = await this.request("initialize", params, "InitializeResponse");
            await this.send({ method: "initialized" });
            this._state = "ready";
            this.emit({ type: "initialized", result });
            return result;
        } catch (error) {
            this.fail(error);
            throw error;
        }
    }

    async startThread(params: Record<string, unknown>): Promise<unknown> {
        this.requireState("ready");
        this.assertSchema("ThreadStartParams", params);
        this._state = "thread-starting";
        try {
            const result = await this.request("thread/start", params, "ThreadStartResponse");
            const id = this.stringAt(this.objectAt(result, "thread"), "id");
            this.threadId = id;
            this.turnId = undefined;
            this._state = "idle";
            this.emit({ type: "threadStarted", threadId: id, result });
            return result;
        } catch (error) {
            this.fail(error);
            throw error;
        }
    }

    async startTurn(input: unknown): Promise<unknown> {
        if (this._state !== "idle" && this._state !== "completed")
            throw new CodexChatRuntimeError("TURN_ALREADY_ACTIVE", "A turn is already active");
        if (!this.threadId) throw new CodexChatRuntimeError("THREAD_NOT_STARTED");
        const params = this.turnParams(input);
        this.assertSchema("TurnStartParams", params);
        this._state = "running";
        try {
            const result = await this.request("turn/start", params, "TurnStartResponse");
            const turn = this.objectAt(result, "turn");
            const id = this.stringAt(turn, "id");
            const status = turn.status;
            if (status !== "inProgress" && status !== "completed" && status !== "interrupted" && status !== "failed")
                throw new CodexChatRuntimeError("INVALID_TURN_STATUS");
            this.turnId = id;
            if (status === "inProgress") this._state = "running";
            else { this._state = "completed"; this.emit({ type: "turnCompleted", threadId: this.threadId, turnId: id, status, result }); }
            return result;
        } catch (error) {
            this.fail(error);
            throw error;
        }
    }

    async cancelTurn(): Promise<void> {
        if ((this._state !== "running" && this._state !== "retrying") || !this.threadId || !this.turnId)
            throw new CodexChatRuntimeError("NO_CANCELLABLE_TURN");
        const threadId = this.threadId;
        const turnId = this.turnId;
        this._state = "cancelling";
        const params = { threadId, turnId };
        this.assertSchema("TurnInterruptParams", params);
        try {
            await this.request("turn/interrupt", params, "TurnInterruptResponse");
            // An interrupt acknowledgement is deliberately not terminal.
            this.emit({ type: "turnInterruptAcknowledged", threadId, turnId });
        } catch (error) {
            this.fail(error);
            throw error;
        }
    }

    receive(raw: unknown): void {
        if (this._state === "closed") throw new CodexChatRuntimeError("CONNECTION_CLOSED");
        const message = this.decode(raw);
        if (typeof message.method === "string") {
            this.receiveMethod(message);
            return;
        }
        this.receiveReply(message);
    }

    close(): void {
        if (this._state === "closed") return;
        this._state = "closed";
        const error = new CodexChatRuntimeError("CONNECTION_CLOSED");
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        this.threadId = undefined;
        this.turnId = undefined;
    }

    private receiveReply(message: CodexMessage): void {
        const id = this.requestId(message.id);
        const pending = this.pending.get(id);
        if (!pending) throw this.protocol("STALE_REPLY");
        if (("result" in message) === ("error" in message)) {
            this.pending.delete(id);
            const failure = this.protocol("INVALID_REPLY");
            pending.reject(failure);
            this.fail(failure);
            throw failure;
        }
        this.pending.delete(id);
        if ("error" in message) {
            const error = message.error;
            if (!this.isRpcError(error)) {
                const failure = this.protocol("INVALID_RPC_ERROR");
                pending.reject(failure);
                this.fail(failure);
                throw failure;
            }
            const failure = new CodexChatRuntimeError(`PROVIDER_RPC_ERROR_${error.code}`, error.message);
            pending.reject(failure);
            if (this._state !== "closed") this._state = "failed";
            return;
        }
        try {
            if (pending.schema) this.assertSchema(pending.schema, message.result);
            pending.resolve(message.result);
        } catch (error) {
            pending.reject(error instanceof Error ? error : this.protocol("PROVIDER_SCHEMA_MISMATCH"));
            this.fail(error);
            throw error;
        }
    }

    private receiveMethod(message: CodexMessage): void {
        if (this._state === "new" || this._state === "initializing") throw this.protocol("NOT_INITIALIZED");
        const method = message.method as string;
        const params = message.params;
        if (method === "turn/started") {
            this.assertSchema("TurnStartedNotification", params);
            const value = this.object(params);
            const threadId = this.stringAt(value, "threadId");
            const turn = this.objectAt(value, "turn");
            const turnId = this.stringAt(turn, "id");
            this.assertIdentity(threadId, this.threadId, "STALE_THREAD");
            if (this.turnId && turnId !== this.turnId) throw this.protocol("STALE_TURN");
            if (turn.status !== "inProgress") throw this.protocol("INVALID_TURN_STATUS");
            this.turnId = turnId;
            this._state = "running";
            this.emit({ type: "turnStarted", threadId, turnId });
            return;
        }
        if (method === "turn/completed") {
            this.assertSchema("TurnCompletedNotification", params);
            const value = this.object(params);
            const threadId = this.stringAt(value, "threadId");
            const turn = this.objectAt(value, "turn");
            const turnId = this.stringAt(turn, "id");
            this.assertIdentity(threadId, this.threadId, "STALE_THREAD");
            this.assertIdentity(turnId, this.turnId, "STALE_TURN");
            if (!["completed", "interrupted", "failed"].includes(String(turn.status)))
                throw this.protocol("INVALID_TERMINAL_STATUS");
            this._state = "completed";
            this.emit({ type: "turnCompleted", threadId, turnId, status: String(turn.status), result: params });
            return;
        }
        if (method === "item/agentMessage/delta") {
            this.assertSchema("AgentMessageDeltaNotification", params);
            const value = this.object(params);
            const threadId = this.stringAt(value, "threadId");
            const turnId = this.stringAt(value, "turnId");
            const itemId = this.stringAt(value, "itemId");
            this.assertIdentity(threadId, this.threadId, "STALE_THREAD");
            this.assertIdentity(turnId, this.turnId, "STALE_TURN");
            if (typeof value.delta !== "string") throw this.protocol("INVALID_DELTA");
            if (this._state === "retrying") this._state = "running";
            if (this._state !== "running" && this._state !== "cancelling") throw this.protocol("TURN_NOT_ACTIVE");
            this.emit({ type: "agentMessageDelta", threadId, turnId, itemId, delta: value.delta });
            return;
        }
        if (method === "error") {
            this.assertSchema("ErrorNotification", params);
            const value = this.object(params);
            const threadId = this.stringAt(value, "threadId");
            const turnId = this.stringAt(value, "turnId");
            this.assertIdentity(threadId, this.threadId, "STALE_THREAD");
            this.assertIdentity(turnId, this.turnId, "STALE_TURN");
            const willRetry = value.willRetry;
            if (typeof willRetry !== "boolean") throw this.protocol("INVALID_PROVIDER_ERROR");
            this._state = willRetry ? "retrying" : "failed";
            this.emit({ type: "providerError", threadId, turnId, willRetry, error: value.error });
            return;
        }
        if (method === "thread/started") {
            this.assertSchema("ThreadStartedNotification", params);
            const thread = this.objectAt(this.object(params), "thread");
            const id = this.stringAt(thread, "id");
            if (this.threadId && id !== this.threadId) throw this.protocol("STALE_THREAD");
            return;
        }
        if (method === "item/started" || method === "item/completed") {
            this.assertSchema(method === "item/started" ? "ItemStartedNotification" : "ItemCompletedNotification", params);
            const value = this.object(params);
            this.assertIdentity(this.stringAt(value, "threadId"), this.threadId, "STALE_THREAD");
            this.assertIdentity(this.stringAt(value, "turnId"), this.turnId, "STALE_TURN");
            return;
        }
        throw this.protocol("UNPINNED_MESSAGE");
    }

    private request(method: string, params: unknown, schema?: string): Promise<unknown> {
        if (this.pending.size >= this.requestLimit) throw this.protocol("REQUEST_BACKPRESSURE");
        const id = this.nextRequestId();
        const message: CodexMessage = { id, method, params };
        this.assertFrame(message);
        return new Promise((resolve, reject) => {
            this.pending.set(id, { schema: schema ?? "", resolve, reject });
            try {
                const result = this.sendMessage(message);
                if (result && typeof (result as Promise<void>).then === "function")
                    void (result as Promise<void>).catch((error) => this.failPending(id, error));
            } catch (error) { this.failPending(id, error); }
        });
    }

    private async send(message: CodexMessage): Promise<void> {
        this.assertFrame(message);
        try { await this.sendMessage(message); }
        catch (error) { this.fail(error); throw error; }
    }

    private failPending(id: string | number, error: unknown): void {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        const failure = error instanceof Error ? error : new CodexChatRuntimeError("TRANSPORT_WRITE_FAILED", String(error));
        pending.reject(failure);
        this.fail(failure);
    }

    private turnParams(input: unknown): Record<string, unknown> {
        if (Array.isArray(input)) return { threadId: this.threadId, input };
        if (!input || typeof input !== "object") throw this.protocol("INVALID_TURN_INPUT");
        return { ...(input as Record<string, unknown>), threadId: this.threadId };
    }

    private assertSchema(schema: string, value: unknown): void {
        if (!this.validate) throw this.protocol("SCHEMA_VALIDATOR_UNAVAILABLE");
        try {
            if (this.validate(schema, value) === false) throw this.protocol("PROVIDER_SCHEMA_MISMATCH");
        } catch (error) {
            if (error instanceof CodexChatRuntimeError) throw error;
            throw new CodexChatRuntimeError("PROVIDER_SCHEMA_MISMATCH", error instanceof Error ? error.message : String(error));
        }
    }

    private assertFrame(value: unknown): void {
        let bytes: number;
        try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; }
        catch { throw this.protocol("MALFORMED_FRAME"); }
        if (bytes > this.frameLimit) throw this.protocol("FRAME_TOO_LARGE");
    }

    private decode(raw: unknown): CodexMessage {
        let value: unknown = raw;
        if (typeof raw === "string") {
            this.assertFrame(raw);
            try { value = JSON.parse(raw); } catch { throw this.protocol("MALFORMED_FRAME"); }
        } else this.assertFrame(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw this.protocol("INVALID_ENVELOPE");
        if ("jsonrpc" in (value as object)) throw this.protocol("UNSUPPORTED_RPC_HEADER");
        return value as CodexMessage;
    }

    private nextRequestId(): string {
        this.sequence += 1;
        return `slterm-${this.sequence}`;
    }

    private requestId(value: unknown): string | number {
        if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isSafeInteger(value)))
            throw this.protocol("INVALID_REQUEST_ID");
        return value;
    }

    private object(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw this.protocol("INVALID_PAYLOAD");
        return value as Record<string, unknown>;
    }

    private objectAt(value: unknown, path: string): Record<string, unknown> {
        const result = this.object(value);
        const child = result[path];
        return this.object(child);
    }

    private stringAt(value: unknown, path: string): string {
        const result = this.object(value);
        const child = result[path];
        if (typeof child !== "string" || !child) throw this.protocol("INVALID_IDENTITY");
        return child;
    }

    private assertIdentity(actual: string, expected: string | undefined, code = "STALE_IDENTITY"): void {
        if (!expected || actual !== expected) throw this.protocol(code);
    }

    private isRpcError(value: unknown): value is { code: number; message: string } {
        return !!value && typeof value === "object" && Number.isInteger((value as Record<string, unknown>).code)
            && typeof (value as Record<string, unknown>).message === "string";
    }

    private requireState(state: CodexRuntimeState): void {
        if (this._state !== state) throw this.protocol("INVALID_STATE", `Expected ${state}, got ${this._state}`);
    }

    private protocol(code: string, message = code): CodexChatRuntimeError {
        return new CodexChatRuntimeError(code, message);
    }

    private fail(error: unknown): void {
        if (this._state === "closed") return;
        this._state = "failed";
        if (error instanceof CodexChatRuntimeError && error.code === "CONNECTION_CLOSED") return;
    }

    private emit(event: CodexRuntimeEvent): void {
        this.assertFrame(event);
        this.emitEvent?.(event);
    }
}

export {
    CodexChatRuntime as CodexAppServerRuntime,
    CodexChatRuntime as CodexRuntime,
};
