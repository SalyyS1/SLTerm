import test from "node:test";
import assert from "node:assert/strict";
import { NdjsonReader, encodeFrame } from "./ndjson.ts";
import { ApprovalGate } from "./approval-gate.ts";

test("fixture: JSONL survives every UTF-8 split and coalesced frames", () => {
    const frame = encodeFrame({ method: "fixture", params: { text: "Tiếng Việt 🐈" } });
    for (let split = 0; split <= frame.length; split++) {
        const received = [];
        const reader = new NdjsonReader();
        reader.push(frame.subarray(0, split), (message) => received.push(message));
        reader.push(Buffer.concat([frame.subarray(split), frame]), (message) => received.push(message));
        reader.end();
        assert.equal(received.length, 2);
        assert.equal(received[0].params.text, "Tiếng Việt 🐈");
    }
});

test("fixture: framing bounds bytes, rejects malformed UTF-8, arrays and truncated EOF", () => {
    assert.throws(() => new NdjsonReader(4).push(Buffer.from("12345"), () => {}), /FRAME_TOO_LARGE/);
    assert.throws(() => encodeFrame({ text: "🐈" }, 4), /FRAME_TOO_LARGE/);
    for (const bytes of [Buffer.from("{bad}\n"), Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125, 10]), Buffer.from("[]\n"), Buffer.from("\n")]) {
        assert.throws(() => new NdjsonReader().push(bytes, () => {}));
    }
    const reader = new NdjsonReader();
    reader.push(Buffer.from('{"id":1}'), () => {});
    assert.throws(() => reader.end(), /TRUNCATED_FRAME/);
    assert.throws(() => reader.push(Buffer.from("{}\n"), () => {}), /READER_CLOSED/);
});

test("fixture: approval binds snapshot, ID type, action, turn and single use", () => {
    const gate = new ApprovalGate();
    gate.begin("thread", "turn");
    const action = { command: "fixture-only", cwd: "fixture" };
    const numeric = gate.offer(7, action);
    action.command = "mutated";
    const string = gate.offer("7", { command: "other" });
    assert.throws(() => gate.consume(7, string.token), /APPROVAL_ACTION_MISMATCH/);
    assert.equal(JSON.parse(gate.consume(7, numeric.token).actionJson).command, "fixture-only");
    assert.throws(() => gate.consume(7, numeric.token), /STALE_APPROVAL/);
    assert.throws(() => gate.offer(7, action), /DUPLICATE_APPROVAL_ID/);
    gate.finish();
    gate.begin("thread", "turn");
    const next = gate.offer(7, action);
    assert.throws(() => gate.consume(7, numeric.token), /APPROVAL_ACTION_MISMATCH/);
    assert.notEqual(next.token, numeric.token);
    gate.finish();
});

test("fixture: expiration and completion revoke approvals; pending storage is bounded", () => {
    let now = 1;
    let expired = 0;
    const gate = new ApprovalGate(10, () => now);
    gate.begin("thread", "turn");
    const approval = gate.offer("request", {}, () => expired++);
    now = 11;
    assert.throws(() => gate.consume("request", approval.token), /EXPIRED_APPROVAL/);
    assert.equal(expired, 1);
    for (let i = 0; i < 64; i++) gate.offer(i, {});
    assert.throws(() => gate.offer(64, {}), /APPROVAL_BACKPRESSURE/);
    gate.finish();
    assert.throws(() => gate.consume(0, "bad"), /STALE_APPROVAL/);
});
