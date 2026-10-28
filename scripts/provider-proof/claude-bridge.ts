import type { CanUseTool, Options, PermissionResult, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { ApprovalGate, type Approval } from "./approval-gate.ts";
import { boundedJson, check, ProofError } from "./proof-errors.ts";
import { loadPinnedClaudeSdk, type ClaudeSdk } from "./claude-sdk-loader.ts";
import { cancelableNext } from "./cancelable-next.ts";

type Configuration = {
    /** Supplied explicitly by an authorized caller. Never discovered from env, CLI, or keyring. */
    apiKey: string;
    cwd: string;
    scratchRoot: string;
    model: string;
    maxBudgetUsd: number;
    onApproval: (approval: Approval) => void;
    /** OS execution basics only; provider credentials/backend overrides are rejected. */
    processEnvironment: Record<string, string>;
    approvalTtlMs?: number;
    cancelTimeoutMs?: number;
};

const DEFAULT_CANCEL_TIMEOUT_MS = 1_000;
const ALLOWED_ENVIRONMENT_KEYS = new Set(["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"]);

/** Proof only: SDK owns its protocol. No reverse-engineered Claude CLI wire messages. */
export class ClaudeBridge {
    private query?: Query;
    private controller?: AbortController;
    private approvals: ApprovalGate;
    private decisions = new Map<string | number, (value: PermissionResult) => void>();
    private active = false;
    private cancelled = false;
    private runNonce?: string;
    private readonly cancelTimeoutMs: number;

    constructor(private readonly config: Configuration, private readonly loadSdk: () => Promise<ClaudeSdk> = loadPinnedClaudeSdk) {
        check(typeof config.apiKey === "string" && config.apiKey.length > 0, "API_AUTH_REQUIRED");
        check(isAbsolute(config.cwd) && isAbsolute(config.scratchRoot), "ABSOLUTE_PATH_REQUIRED");
        check(typeof config.model === "string" && config.model.length > 0, "MODEL_REQUIRED");
        check(Number.isFinite(config.maxBudgetUsd) && config.maxBudgetUsd > 0, "RUN_BUDGET_REQUIRED");
        check(Object.keys(config.processEnvironment).every((key) => ALLOWED_ENVIRONMENT_KEYS.has(key)), "UNSUPPORTED_ENVIRONMENT_VARIABLE");
        this.cancelTimeoutMs = config.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS;
        check(Number.isSafeInteger(this.cancelTimeoutMs) && this.cancelTimeoutMs > 0 && this.cancelTimeoutMs <= 10_000, "INVALID_CANCEL_TIMEOUT");
        this.config = { ...config, processEnvironment: Object.freeze({ ...config.processEnvironment }) };
        this.approvals = new ApprovalGate(config.approvalTtlMs);
    }

    async *run(prompt: string): AsyncGenerator<SDKMessage> {
        check(!this.active, "RUN_ALREADY_ACTIVE");
        check(typeof prompt === "string" && prompt.length > 0, "PROMPT_REQUIRED");
        boundedJson(prompt);
        this.active = true;
        this.cancelled = false;
        this.controller = new AbortController();
        const nonce = randomUUID();
        this.runNonce = nonce;
        this.approvals.begin(nonce, nonce);
        try {
            const profile = await mkdtemp(join(this.config.scratchRoot, "claude-profile-"));
            const sdk = await this.loadSdk();
            check(!this.cancelled, "RUN_CANCELLED");
            const options: Options = {
                cwd: this.config.cwd,
                model: this.config.model,
                maxBudgetUsd: this.config.maxBudgetUsd,
                abortController: this.controller,
                persistSession: false,
                settingSources: [],
                permissionMode: "default",
                env: { ...this.config.processEnvironment, HOME: profile, USERPROFILE: profile,
                    APPDATA: profile, LOCALAPPDATA: profile, CLAUDE_CONFIG_DIR: profile,
                    ANTHROPIC_API_KEY: this.config.apiKey, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
                // Ask before every tool; canUseTool alone does not intercept auto-approved calls.
                hooks: { PreToolUse: [{ hooks: [async () => ({ hookSpecificOutput: {
                    hookEventName: "PreToolUse", permissionDecision: "ask"
                } })] }] },
                canUseTool: this.permissionCallback(nonce),
            };
            async function* messages(): AsyncGenerator<SDKUserMessage> {
                yield { type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null };
            }
            this.query = sdk.query({ prompt: messages(), options });
            for (;;) {
                const next = await cancelableNext(this.query, this.controller.signal);
                if (next.done) break;
                const message = next.value;
                check(!this.cancelled && this.runNonce === nonce, "STALE_SDK_EVENT");
                boundedJson(message);
                yield message;
            }
        } catch {
            // SDK errors can include stderr, tool input, or keys. Expose a stable code only.
            throw new ProofError(this.cancelled ? "RUN_CANCELLED" : "SDK_RUN_FAILED");
        } finally {
            this.approvals.finish();
            this.controller.abort();
            const query = this.query;
            this.query = undefined;
            this.active = false;
            this.runNonce = undefined;
            try { query?.close(); } catch { /* Cleanup must not expose SDK stderr/credentials. */ }
        }
    }

    decide(requestId: string | number, token: string, allow: boolean): void {
        check(this.active && !this.cancelled, "RUN_NOT_APPROVABLE");
        check(typeof allow === "boolean", "INVALID_APPROVAL_DECISION");
        const approval = this.approvals.consume(requestId, token);
        const resolve = this.decisions.get(requestId);
        check(resolve, "STALE_APPROVAL");
        const action = JSON.parse(approval.actionJson);
        resolve(allow ? { behavior: "allow", updatedInput: action.input } : { behavior: "deny", message: "User declined" });
    }

    async cancel(): Promise<void> {
        if (!this.active || this.cancelled) return;
        this.cancelled = true;
        this.approvals.finish();
        let timer: NodeJS.Timeout | undefined;
        try {
            await Promise.race([
                this.query?.interrupt().catch(() => undefined),
                new Promise<void>((resolve) => { timer = setTimeout(resolve, this.cancelTimeoutMs); }),
            ]);
        } finally {
            clearTimeout(timer);
            this.controller?.abort();
            try { this.query?.close(); } catch { /* Abort still terminates the host wait. */ }
        }
    }

    private permissionCallback(nonce: string): CanUseTool {
        return async (toolName, input, context) => {
            if (!this.active || this.cancelled || this.runNonce !== nonce || context.signal.aborted) {
                return { behavior: "deny", message: "Inactive turn", interrupt: true };
            }
            return new Promise<PermissionResult>((resolve) => {
                const id = context.requestId;
                const finish = (result: PermissionResult) => {
                    if (this.decisions.get(id) === finish) this.decisions.delete(id);
                    context.signal.removeEventListener("abort", abort);
                    resolve(result);
                };
                const abort = () => this.approvals.revoke(id);
                let offered = false;
                try {
                    const approval = this.approvals.offer(id, { toolName, input, toolUseID: context.toolUseID },
                        () => finish({ behavior: "deny", message: "Approval expired or cancelled", interrupt: this.cancelled || context.signal.aborted }));
                    offered = true;
                    this.decisions.set(id, finish);
                    context.signal.addEventListener("abort", abort, { once: true });
                    if (context.signal.aborted) return abort();
                    this.config.onApproval(approval);
                } catch {
                    if (offered) this.approvals.revoke(id, false);
                    finish({ behavior: "deny", message: "Invalid approval request" });
                }
            });
        };
    }
}
