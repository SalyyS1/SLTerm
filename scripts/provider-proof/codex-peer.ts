import { randomUUID } from "node:crypto";
import { ApprovalGate, type Approval } from "./approval-gate.ts";
import { codexVersion, validateCodex } from "./codex-schema.ts";
import { encodeFrame } from "./ndjson.ts";
import { check, ProofError, requestKey } from "./proof-errors.ts";

type Message = Record<string, any>;
type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** In-memory proof adapter. The caller owns process launch, stdio, and byte backpressure. */
export class CodexPeer {
    readonly approvals: ApprovalGate;
    private pending = new Map<string, Pending>();
    private state: "new" | "initializing" | "ready" | "closed" = "new";
    private turn?: { threadId: string; turnId: string; cancelling: boolean };
    private sequence = 0;
    private readonly connection = randomUUID();

    constructor(
        version: string,
        private readonly write: (bytes: Buffer) => void,
        private readonly onApproval: (approval: Approval) => void,
        private readonly timeoutMs = 5_000,
        approvalTtlMs = 30_000
    ) {
        check(version === codexVersion, "UNSUPPORTED_CODEX_VERSION");
        check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, "INVALID_TIMEOUT");
        this.approvals = new ApprovalGate(approvalTtlMs);
    }

    async initialize(): Promise<unknown> {
        check(this.state === "new", "INVALID_INITIALIZE_STATE");
        this.state = "initializing";
        const params = { clientInfo: { name: "slterm_provider_proof", version: "0.1.0" },
            capabilities: { experimentalApi: false, explicitGatewayOauth: true } };
        validateCodex("InitializeParams", params);
        try {
            const result = await this.request("initialize", params);
            validateCodex("InitializeResponse", result);
            this.send({ method: "initialized" });
            this.state = "ready";
            return result;
        } catch (error) {
            this.close();
            throw error;
        }
    }

    receive(message: Message): void {
        check(this.state !== "closed", "CONNECTION_CLOSED");
        check(message && typeof message === "object" && !Array.isArray(message), "INVALID_ENVELOPE");
        check(!("jsonrpc" in message), "UNSUPPORTED_RPC_HEADER");
        if (!message.method) {
            const key = requestKey(message.id);
            const pending = this.pending.get(key);
            check(pending, "STALE_REPLY");
            if (("result" in message) === ("error" in message)) {
                this.rejectMalformedReply(key, pending, "INVALID_REPLY");
            }
            if ("error" in message && (!Number.isInteger(message.error?.code) || typeof message.error?.message !== "string")) {
                this.rejectMalformedReply(key, pending, "INVALID_RPC_ERROR");
            }
            this.pending.delete(key);
            clearTimeout(pending.timer);
            if ("error" in message) {
                pending.reject(new ProofError(`PROVIDER_RPC_ERROR_${message.error.code}`));
            } else pending.resolve(message.result);
            return;
        }
        check(this.state === "ready", "NOT_INITIALIZED");
        if (message.method === "turn/started") {
            validateCodex("TurnStartedNotification", message.params);
            check(!this.turn && message.params.turn.status === "inProgress", "TURN_ALREADY_ACTIVE");
            this.turn = { threadId: message.params.threadId, turnId: message.params.turn.id, cancelling: false };
            this.approvals.begin(this.turn.threadId, this.turn.turnId);
        } else if (message.method === "turn/completed") {
            validateCodex("TurnCompletedNotification", message.params);
            this.assertTurn(message.params.threadId, message.params.turn.id);
            check(message.params.turn.status !== "inProgress", "INVALID_TERMINAL_STATUS");
            this.approvals.finish(false);
            this.turn = undefined;
        } else if (message.method === "serverRequest/resolved") {
            validateCodex("ServerRequestResolvedNotification", message.params);
            check(this.turn?.threadId === message.params.threadId, "STALE_TURN");
            this.approvals.revoke(message.params.requestId, false);
        } else if (message.method === "item/commandExecution/requestApproval") {
            validateCodex("CommandExecutionRequestApprovalParams", message.params);
            this.assertTurn(message.params.threadId, message.params.turnId);
            check(!this.turn!.cancelling, "TURN_CANCELLING");
            const id = message.id;
            requestKey(id);
            this.onApproval(this.approvals.offer(id, message.params, () => {
                try {
                    this.send({ id, result: { decision: "cancel" } });
                    if (this.turn && !this.turn.cancelling) {
                        this.turn.cancelling = true;
                        this.approvals.finish();
                    }
                } catch { this.close(); }
            }));
        } else if ("id" in message) {
            requestKey(message.id);
            // Unknown server requests fail closed; never infer an approval.
            this.send({ id: message.id, error: { code: -32601, message: "Unsupported server request" } });
        }
    }

    decide(requestId: string | number, token: string, decision: "accept" | "decline" | "cancel"): void {
        check(this.state === "ready" && !this.turn?.cancelling, "TURN_NOT_APPROVABLE");
        check(["accept", "decline", "cancel"].includes(decision), "UNSUPPORTED_APPROVAL_DECISION");
        const result = { decision };
        validateCodex("CommandExecutionRequestApprovalResponse", result);
        this.approvals.consume(requestId, token);
        if (decision === "cancel") this.turn!.cancelling = true;
        this.send({ id: requestId, result });
        if (decision === "cancel") this.approvals.finish();
    }

    async cancel(): Promise<void> {
        check(this.state === "ready" && this.turn && !this.turn.cancelling, "NO_CANCELLABLE_TURN");
        this.turn.cancelling = true;
        this.approvals.finish();
        const params = { threadId: this.turn.threadId, turnId: this.turn.turnId };
        validateCodex("TurnInterruptParams", params);
        try {
            const result = await this.request("turn/interrupt", params);
            validateCodex("TurnInterruptResponse", result);
            // An interrupt reply acknowledges the request. Only turn/completed is terminal.
        } catch (error) {
            this.close();
            throw error;
        }
    }

    close(): void {
        if (this.state === "closed") return;
        this.state = "closed";
        this.approvals.finish(false);
        this.turn = undefined;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new ProofError("CONNECTION_CLOSED"));
        }
        this.pending.clear();
    }

    private assertTurn(threadId: string, turnId: string): void {
        check(this.turn?.threadId === threadId && this.turn.turnId === turnId, "STALE_TURN");
    }

    private rejectMalformedReply(key: string, pending: Pending, code: "INVALID_REPLY" | "INVALID_RPC_ERROR"): never {
        this.pending.delete(key);
        clearTimeout(pending.timer);
        const error = new ProofError(code);
        pending.reject(error);
        this.close();
        throw error;
    }

    private send(message: Message): void {
        try { this.write(encodeFrame(message)); }
        catch {
            for (const pending of this.pending.values()) pending.reject(new ProofError("TRANSPORT_WRITE_FAILED"));
            this.close();
            throw new ProofError("TRANSPORT_WRITE_FAILED");
        }
    }

    private request(method: string, params: unknown): Promise<unknown> {
        check(this.pending.size < 64, "REQUEST_BACKPRESSURE");
        const id = `${this.connection}:${++this.sequence}`;
        return new Promise((resolve, reject) => {
            const key = requestKey(id);
            const timer = setTimeout(() => {
                this.pending.delete(key);
                reject(new ProofError("REQUEST_TIMEOUT"));
            }, this.timeoutMs);
            this.pending.set(key, { resolve, reject, timer });
            try { this.send({ id, method, params }); }
            catch (error) {
                clearTimeout(timer);
                this.pending.delete(key);
                reject(error);
            }
        });
    }
}
