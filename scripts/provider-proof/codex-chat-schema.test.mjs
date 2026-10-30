import test from "node:test";
import assert from "node:assert/strict";
import { createChatSchemaFixtures } from "./codex-chat-fixtures.mjs";
import { codexSchemaNames, codexVersion, validateCodex } from "./codex-schema.ts";

const without = (value, key) => {
    const copy = structuredClone(value);
    delete copy[key];
    return copy;
};
const rejects = (name, value) => assert.throws(() => validateCodex(name, value), /PROVIDER_SCHEMA_MISMATCH/);

test("chat schema fixture: exact version and generated schema catalog", () => {
    assert.equal(codexVersion, "codex-cli 0.165.0-alpha.1.2");
    assert.equal(Object.isFrozen(codexSchemaNames), true);
    for (const name of Object.keys(createChatSchemaFixtures())) assert.ok(codexSchemaNames.includes(name), name);
    for (const name of ["missing", "constructor", "__proto__", "../ThreadStartParams"]) {
        assert.throws(() => validateCodex(name, {}), /UNPINNED_SCHEMA/);
    }
});

test("chat schema fixture: thread start accepts optional settings and rejects invalid policy types", () => {
    const { ThreadStartParams: params } = createChatSchemaFixtures();
    validateCodex("ThreadStartParams", {});
    validateCodex("ThreadStartParams", params);
    rejects("ThreadStartParams", { ...params, sandbox: "readOnly" });
    rejects("ThreadStartParams", { ...params, approvalPolicy: "accept" });
    rejects("ThreadStartParams", { ...params, ephemeral: "true" });
});

test("chat schema fixture: thread start response includes negotiated policy and thread identity", () => {
    const { ThreadStartResponse: response } = createChatSchemaFixtures();
    validateCodex("ThreadStartResponse", response);
    rejects("ThreadStartResponse", without(response, "sandbox"));
    rejects("ThreadStartResponse", { ...response, sandbox: { type: "read-only" } });
    rejects("ThreadStartResponse", { ...response, thread: without(response.thread, "sessionId") });
    rejects("ThreadStartResponse", { ...response, thread: { ...response.thread, status: { type: "active" } } });
});

test("chat schema fixture: thread started requires full generated thread metadata", () => {
    const { ThreadStartedNotification: notification } = createChatSchemaFixtures();
    validateCodex("ThreadStartedNotification", notification);
    rejects("ThreadStartedNotification", { thread: { id: notification.thread.id } });
    rejects("ThreadStartedNotification", { thread: without(notification.thread, "projectId") });
    rejects("ThreadStartedNotification", { thread: { ...notification.thread, createdAt: "1" } });
});

test("chat schema fixture: turn start routes typed input to an explicit thread", () => {
    const { TurnStartParams: params } = createChatSchemaFixtures();
    validateCodex("TurnStartParams", params);
    rejects("TurnStartParams", without(params, "threadId"));
    rejects("TurnStartParams", { ...params, input: [{ type: "text" }] });
    rejects("TurnStartParams", { ...params, input: [{ type: "text", text: "fixture", text_elements: {} }] });
    rejects("TurnStartParams", { ...params, input: [{ type: "agentMessage", text: "fixture" }] });
});

test("chat schema fixture: turn start response validates nested turn and item types", () => {
    const { TurnStartResponse: response } = createChatSchemaFixtures();
    validateCodex("TurnStartResponse", response);
    rejects("TurnStartResponse", { id: 1, result: response });
    rejects("TurnStartResponse", { turn: without(response.turn, "id") });
    rejects("TurnStartResponse", { turn: { ...response.turn, status: "done" } });
    rejects("TurnStartResponse", { turn: { ...response.turn, items: [{ type: "agentMessage", id: "message" }] } });
});

test("chat schema fixture: item started requires its timestamp and typed assistant content", () => {
    const { ItemStartedNotification: notification } = createChatSchemaFixtures();
    validateCodex("ItemStartedNotification", notification);
    rejects("ItemStartedNotification", without(notification, "startedAtMs"));
    rejects("ItemStartedNotification", { ...notification, startedAtMs: 1.5 });
    rejects("ItemStartedNotification", { ...notification, item: { ...notification.item, text: [] } });
});

test("chat schema fixture: item completion carries final text and its own completion timestamp", () => {
    const { ItemCompletedNotification: notification } = createChatSchemaFixtures();
    validateCodex("ItemCompletedNotification", notification);
    rejects("ItemCompletedNotification", without(notification, "completedAtMs"));
    rejects("ItemCompletedNotification", { ...notification, turnId: 4 });
    rejects("ItemCompletedNotification", { ...notification, item: { ...notification.item, type: "unknownItem" } });
});

test("chat schema fixture: assistant deltas require string content and routing identities", () => {
    const { AgentMessageDeltaNotification: notification } = createChatSchemaFixtures();
    validateCodex("AgentMessageDeltaNotification", notification);
    for (const key of ["threadId", "turnId", "itemId", "delta"]) rejects("AgentMessageDeltaNotification", without(notification, key));
    rejects("AgentMessageDeltaNotification", { ...notification, delta: ["text"] });
});

test("chat schema fixture: provider errors require retry state and a structured message", () => {
    const { ErrorNotification: notification } = createChatSchemaFixtures();
    validateCodex("ErrorNotification", notification);
    rejects("ErrorNotification", without(notification, "willRetry"));
    rejects("ErrorNotification", { ...notification, willRetry: "false" });
    rejects("ErrorNotification", { ...notification, error: { message: { privateDetail: "fixture" } } });
    rejects("ErrorNotification", { ...notification, error: { message: "fixture", codexErrorInfo: false } });
});

test("chat schema fixture: validators retain generated forward compatibility", () => {
    const { ThreadStartParams: params, ErrorNotification: notification } = createChatSchemaFixtures();
    // The generated schemas allow extra properties and future error details.
    // Application policy and supported-message dispatch remain separate checks.
    validateCodex("ThreadStartParams", { ...params, futureOption: true });
    validateCodex("ErrorNotification", { ...notification, error: { message: "fixture", codexErrorInfo: { futureReason: {} } } });
});
