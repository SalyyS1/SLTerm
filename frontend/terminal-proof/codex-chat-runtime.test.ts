import { describe, expect, it, vi } from "vitest";
import { CodexChatRuntime, type CodexMessage, type CodexRuntimeEvent } from "./codex-chat-runtime";

function harness(validate = () => {}) {
    const sent: CodexMessage[] = [];
    const events: CodexRuntimeEvent[] = [];
    const runtime = new CodexChatRuntime({ send: (message) => { sent.push(message); }, onEvent: (event) => { events.push(event); }, validate });
    return { runtime, sent, events };
}

async function initialize(runtime: CodexChatRuntime, sent: CodexMessage[]) {
    const pending = runtime.initialize({ name: "slterm", version: "0.1.0" });
    const request = sent.at(-1)!;
    runtime.receive({ id: request.id, result: { codexHome: "C:\\codex", platformFamily: "windows", platformOs: "windows", userAgent: "fixture" } });
    await pending;
}

async function startThread(runtime: CodexChatRuntime, sent: CodexMessage[]) {
    const pending = runtime.startThread({ cwd: "C:\\workspace", ephemeral: true });
    const request = sent.at(-1)!;
    runtime.receive({ id: request.id, result: { thread: { id: "thread-1" } } });
    await pending;
}

async function startTurn(runtime: CodexChatRuntime, sent: CodexMessage[]) {
    const pending = runtime.startTurn([{ type: "text", text: "hello", text_elements: [] }]);
    const request = sent.at(-1)!;
    runtime.receive({ id: request.id, result: { turn: { id: "turn-1", status: "inProgress" } } });
    await pending;
}

describe("browser-safe Codex chat runtime", () => {
    it("initializes, starts a thread and turn, streams only agent deltas, then completes", async () => {
        const { runtime, sent, events } = harness();
        await initialize(runtime, sent);
        expect(runtime.state).toBe("ready");
        await startThread(runtime, sent);
        expect(runtime.state).toBe("idle");
        await startTurn(runtime, sent);
        runtime.receive({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Xin chào" } });
        runtime.receive({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
        expect(runtime.state).toBe("completed");
        expect(events.map((event) => event.type)).toEqual(["initialized", "threadStarted", "agentMessageDelta", "turnCompleted"]);
    });

    it("fails closed when no browser validator is supplied", async () => {
        const sent: CodexMessage[] = [];
        const runtime = new CodexChatRuntime({ send: (message) => { sent.push(message); } });
        await expect(runtime.initialize({ name: "slterm", version: "0.1.0" })).rejects.toMatchObject({ code: "SCHEMA_VALIDATOR_UNAVAILABLE" });
        expect(runtime.state).toBe("new");
        expect(sent).toHaveLength(0);
    });

    it("rejects stale identities and provider errors distinguish retry from failure", async () => {
        const { runtime, sent } = harness();
        await initialize(runtime, sent); await startThread(runtime, sent); await startTurn(runtime, sent);
        expect(() => runtime.receive({ method: "item/agentMessage/delta", params: { threadId: "other", turnId: "turn-1", itemId: "x", delta: "stale" } })).toThrow("STALE_THREAD");
        runtime.receive({ method: "error", params: { threadId: "thread-1", turnId: "turn-1", willRetry: true, error: { message: "retry" } } });
        expect(runtime.state).toBe("retrying");
        runtime.receive({ method: "error", params: { threadId: "thread-1", turnId: "turn-1", willRetry: false, error: { message: "failed" } } });
        expect(runtime.state).toBe("failed");
    });

    it("keeps interrupt acknowledgement non-terminal until matching completion", async () => {
        const { runtime, sent, events } = harness();
        await initialize(runtime, sent); await startThread(runtime, sent); await startTurn(runtime, sent);
        const cancel = runtime.cancelTurn();
        const request = sent.at(-1)!;
        expect(request.method).toBe("turn/interrupt");
        runtime.receive({ id: request.id, result: {} });
        await cancel;
        expect(runtime.state).toBe("cancelling");
        expect(events.at(-1)?.type).toBe("turnInterruptAcknowledged");
        runtime.receive({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted" } } });
        expect(runtime.state).toBe("completed");
    });

    it("surfaces exact command approvals and answers the correlated server request once", async () => {
        const { runtime, sent, events } = harness();
        await initialize(runtime, sent); await startThread(runtime, sent); await startTurn(runtime, sent);
        runtime.receive({ id: "approval-1", method: "item/commandExecution/requestApproval", params: {
            threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: 1,
            command: "git status", cwd: "C:\\repo", reason: "Needs repository access",
        } });
        const approval = events.find((event) => event.type === "approvalRequest");
        expect(approval).toMatchObject({ type: "approvalRequest", requestId: "approval-1", command: "git status" });
        await runtime.respondApproval("approval-1", "accept");
        expect(sent.at(-1)).toEqual({ id: "approval-1", result: { decision: "accept" } });
        await expect(runtime.respondApproval("approval-1", "accept")).rejects.toMatchObject({ code: "UNKNOWN_APPROVAL" });
    });

    it("rejects duplicate turns, oversized frames, malformed replies and closes pending work", async () => {
        const { runtime, sent } = harness();
        await initialize(runtime, sent); await startThread(runtime, sent); await startTurn(runtime, sent);
        await expect(runtime.startTurn([{ type: "text", text: "second", text_elements: [] }])).rejects.toMatchObject({ code: "TURN_ALREADY_ACTIVE" });
        expect(() => runtime.receive({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-2", status: "completed" } } })).toThrow("STALE_TURN");

        const pending = new CodexChatRuntime({ send: () => {}, validate: () => {}, maxFrameBytes: 128 });
        await expect(pending.initialize({ name: "slterm", version: "x" })).rejects.toMatchObject({ code: "FRAME_TOO_LARGE" });

        const limited = new CodexChatRuntime({ send: () => {}, validate: () => {}, maxPendingRequests: 1 });
        const request = (limited as unknown as { request(method: string, params: unknown): Promise<unknown> }).request("fixture", {});
        expect(() => (limited as unknown as { request(method: string, params: unknown): Promise<unknown> }).request("fixture", {})).toThrow("REQUEST_BACKPRESSURE");
        limited.close();
        await expect(request).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });

        const closing = harness();
        const waiting = closing.runtime.initialize({ name: "slterm", version: "x" });
        closing.runtime.close();
        await expect(waiting).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
        expect(() => closing.runtime.receive({ id: "slterm-1", result: {} })).toThrow("CONNECTION_CLOSED");
    });
});
