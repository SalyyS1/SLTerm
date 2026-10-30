import { codexVersion } from "./codex-schema.ts";

// Offline payloads for the exact generated schema pin; these send no requests.
export function createChatSchemaFixtures() {
    const cwd = "C:\\slterm-fixture\\dự án 日本語";
    const thread = {
        id: "thread-fixture", sessionId: "session-fixture", projectId: null,
        cliVersion: codexVersion.replace("codex-cli ", ""), modelProvider: "openai",
        createdAt: 1, updatedAt: 1, cwd, ephemeral: true, preview: "",
        source: "appServer", status: { type: "idle" }, turns: [],
    };
    const turn = { id: "turn-fixture", items: [], status: "inProgress" };
    const identity = { threadId: thread.id, turnId: turn.id };
    const message = { type: "agentMessage", id: "message-fixture", text: "Tiếng Việt 🙂 日本語" };
    return {
        ThreadStartParams: { cwd, model: "fixture-model", ephemeral: true,
            sandbox: "read-only", approvalPolicy: "on-request", approvalsReviewer: "user" },
        ThreadStartResponse: { thread, cwd, model: "fixture-model", modelProvider: "openai",
            sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request", approvalsReviewer: "user" },
        ThreadStartedNotification: { thread },
        TurnStartParams: { threadId: thread.id, input: [{ type: "text", text: "Explain this fixture", text_elements: [] }] },
        TurnStartResponse: { turn },
        ItemStartedNotification: { ...identity, startedAtMs: 1, item: { ...message, text: "" } },
        ItemCompletedNotification: { ...identity, completedAtMs: 2, item: message },
        AgentMessageDeltaNotification: { ...identity, itemId: message.id, delta: message.text },
        ErrorNotification: { ...identity, willRetry: false,
            error: { message: "Offline fixture failure", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } }, additionalDetails: null } },
    };
}
