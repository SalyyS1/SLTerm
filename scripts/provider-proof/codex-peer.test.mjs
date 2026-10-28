import test from "node:test";
import assert from "node:assert/strict";
import { CodexPeer } from "./codex-peer.ts";
import { codexVersion, validateCodex } from "./codex-schema.ts";

async function initialized(timeoutMs = 100) {
    const wire = [];
    const approvals = [];
    const peer = new CodexPeer(codexVersion, (bytes) => wire.push(JSON.parse(bytes)), (approval) => approvals.push(approval), timeoutMs);
    const initialization = peer.initialize();
    const init = wire.at(-1);
    peer.receive({ id: init.id, result: { userAgent: "fixture", codexHome: "C:\\fixture", platformFamily: "windows", platformOs: "windows" } });
    await initialization;
    return { peer, wire, approvals, init };
}

const start = (peer, id = "turn-1") => peer.receive({ method: "turn/started", params: {
    threadId: "thread-1", turn: { id, items: [], status: "inProgress" }
} });
const offer = (peer, id = "approval-1") => peer.receive({ id, method: "item/commandExecution/requestApproval", params: {
    itemId: "item-1", threadId: "thread-1", turnId: "turn-1", startedAtMs: 1, command: "fixture-do-not-execute"
} });
const complete = (peer, status = "interrupted") => peer.receive({ method: "turn/completed", params: {
    threadId: "thread-1", turn: { id: "turn-1", items: [], status }
} });

test("schema fixture: pinned version, initialize capabilities, IDs and reply correlation", async () => {
    assert.throws(() => new CodexPeer("wrong-version", () => {}, () => {}), /UNSUPPORTED_CODEX_VERSION/);
    const { peer, wire, init } = await initialized();
    assert.equal(init.params.capabilities.experimentalApi, false);
    assert.equal(init.params.capabilities.explicitGatewayOauth, true);
    assert.deepEqual(wire.at(-1), { method: "initialized" });
    assert.equal("jsonrpc" in init, false);
    assert.throws(() => peer.receive({ id: init.id, result: {} }), /STALE_REPLY/);
    assert.throws(() => peer.receive({ id: true, result: {} }), /INVALID_REQUEST_ID/);
    peer.close();
});

test("schema fixture: exact action approval is one use and is revoked by resolution", async () => {
    const { peer, wire, approvals } = await initialized();
    start(peer);
    offer(peer);
    peer.decide("approval-1", approvals[0].token, "accept");
    assert.deepEqual(wire.at(-1), { id: "approval-1", result: { decision: "accept" } });
    assert.throws(() => peer.decide("approval-1", approvals[0].token, "accept"), /STALE_APPROVAL/);
    assert.throws(() => offer(peer), /DUPLICATE_APPROVAL_ID/);
    offer(peer, "approval-2");
    const count = wire.length;
    peer.receive({ method: "serverRequest/resolved", params: { threadId: "thread-1", requestId: "approval-2" } });
    assert.equal(wire.length, count, "resolved requests must not receive another response");
    assert.throws(() => peer.decide("approval-2", approvals[1].token, "accept"), /STALE_APPROVAL/);
    peer.close();
});

test("schema fixture: interrupt acknowledgment is separate from terminal event; late approvals fail", async () => {
    const { peer, wire, approvals } = await initialized();
    start(peer);
    offer(peer);
    const cancellation = peer.cancel();
    assert.deepEqual(wire.at(-2), { id: "approval-1", result: { decision: "cancel" } });
    const interrupt = wire.at(-1);
    assert.equal(interrupt.method, "turn/interrupt");
    validateCodex("TurnInterruptParams", interrupt.params);
    assert.throws(() => peer.decide("approval-1", approvals[0].token, "accept"), /TURN_NOT_APPROVABLE/);
    assert.throws(() => offer(peer, "late"), /TURN_CANCELLING/);
    peer.receive({ id: interrupt.id, result: {} });
    await cancellation;
    assert.throws(() => start(peer, "new-turn"), /TURN_ALREADY_ACTIVE/);
    complete(peer);
    assert.throws(() => complete(peer), /STALE_TURN/);
    start(peer, "new-turn");
    peer.close();
});

test("schema fixture: invalid schema, unsupported requests, timeout and provider errors fail explicitly", async () => {
    const { peer, wire } = await initialized(15);
    assert.throws(() => peer.receive({ method: "turn/started", params: { threadId: "t", turn: {} } }), /PROVIDER_SCHEMA_MISMATCH/);
    peer.receive({ id: 4, method: "unknown/new-approval", params: {} });
    assert.equal(wire.at(-1).error.code, -32601);
    start(peer);
    await assert.rejects(peer.cancel(), /REQUEST_TIMEOUT/);
    assert.throws(() => peer.receive({ id: "late", result: {} }), /CONNECTION_CLOSED/);
    const failed = new CodexPeer(codexVersion, (bytes) => wire.push(JSON.parse(bytes)), () => {});
    const initialization = failed.initialize();
    failed.receive({ id: wire.at(-1).id, error: { code: -32600, message: "fixture-private-detail" } });
    await assert.rejects(initialization, (error) => error.message === "PROVIDER_RPC_ERROR_-32600");
});

test("schema fixture: malformed correlated replies fail closed and cannot be completed later", async () => {
    const wire = [];
    const second = new CodexPeer(codexVersion, (bytes) => wire.push(JSON.parse(bytes)), () => {});
    const pending = second.initialize();
    const id = wire[0].id;
    assert.throws(() => second.receive({ id, result: {}, error: {} }), /INVALID_REPLY/);
    await assert.rejects(pending, /INVALID_REPLY/);
    assert.throws(() => second.receive({ id, result: {} }), /CONNECTION_CLOSED/);
});

test("schema fixture: write failure and disconnect reject pending work without stale decisions", async () => {
    const broken = new CodexPeer(codexVersion, () => { throw new Error("private-stderr"); }, () => {});
    await assert.rejects(broken.initialize(), /TRANSPORT_WRITE_FAILED/);
    const peer = new CodexPeer(codexVersion, () => {}, () => {});
    const pending = peer.initialize();
    peer.close();
    await assert.rejects(pending, /CONNECTION_CLOSED/);
});

test("schema fixture: cancel decision immediately revokes concurrent approvals", async () => {
    const { peer, wire, approvals } = await initialized();
    start(peer);
    offer(peer, "first");
    offer(peer, "second");
    peer.decide("first", approvals[0].token, "cancel");
    assert.deepEqual(wire.slice(-2), [
        { id: "first", result: { decision: "cancel" } },
        { id: "second", result: { decision: "cancel" } },
    ]);
    assert.throws(() => peer.decide("second", approvals[1].token, "accept"), /TURN_NOT_APPROVABLE/);
    assert.throws(() => offer(peer, "third"), /TURN_CANCELLING/);
    complete(peer);
    peer.close();
});
