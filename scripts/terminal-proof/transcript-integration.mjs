import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "./core-client.mjs";
import { fixturePath, inputCommand, spawnFixture, startClient, waitRecord } from "./fixtures/test-support.mjs";
import { snapshotProcessTree, waitForOwnedGone } from "./fixtures/windows-process-tree.mjs";

async function fixture() {
    const directory = await mkdtemp(join(repoRoot, "proof-results/transcript-rpc-"));
    return { env: { ...process.env, SLTERM_ADE_DATABASE: join(directory, "hồ-sơ.sqlite3") } };
}
async function request(client, method, fields) {
    const frame = await client.request(method, fields);
    assert.equal(frame.ok, true, `${method}: ${frame.error_code}; ${client.stderr}`);
    return frame.result;
}
async function replay(client, run_id) {
    const metadata = await request(client, "transcripts.metadata", { run_id });
    let offset = 0, sequence = 0;
    const chunks = [];
    while (true) {
        const part = await request(client, "transcripts.read", { run_id, offset });
        const bytes = Buffer.from(part.data, "base64");
        assert.equal(part.offset, offset);
        assert.equal(part.next_offset, offset + bytes.length);
        assert(bytes.length <= 16384);
        if (bytes.length) { assert.equal(part.sequence, sequence + 1); assert.equal(part.chunk_offset, 0); sequence++; }
        chunks.push(bytes); offset = part.next_offset;
        if (part.eof) break;
        assert(bytes.length > 0);
    }
    assert.equal(offset, metadata.recorded_bytes);
    assert.equal(sequence, metadata.recorded_sequence);
    return { metadata, bytes: Buffer.concat(chunks) };
}
async function shutdown(client) {
    assert.equal((await client.request("shutdown")).ok, true);
    assert.deepEqual(await client.closed, { code: 0, signal: null });
}

test("real ConPTY archives exact split Unicode and final output before exit, then replays without processes", { timeout: 60000 }, async (t) => {
    const options = await fixture(), run_id = randomUUID();
    const first = await startClient(t, options);
    await spawnFixture(first, 1, "interactive", [], { run_id });
    await waitRecord(first, 1, "ready");
    await inputCommand(first, 1, { op: "split", value: "Tiếng Việt 🙂 日本語" });
    await waitRecord(first, 1, "split-done");
    await inputCommand(first, 1, { op: "exit", code: 23 });
    await first.waitFor((frame) => frame.event === "exit" && frame.session_id === 1);
    const saved = await replay(first, run_id);
    assert.deepEqual(saved.bytes, first.output(1));
    assert(saved.bytes.includes(Buffer.from("@proof:split:Tiếng Việt 🙂 日本語:end")), "archive must retain split Unicode marker");
    assert(saved.bytes.includes(Buffer.from("@proof:final-output-before-exit")), "archive must retain bytes written before process exit");
    assert.deepEqual([saved.metadata.finished, saved.metadata.process_eof, saved.metadata.capture_complete, saved.metadata.exit_code], [true, true, true, 23]);
    const identity = JSON.parse(saved.metadata.identity_json);
    assert.deepEqual([identity.attempt_id, identity.execution_host, identity.provider, identity.protocol_version], [run_id, "windows-local", "shell", 1]);
    await shutdown(first);
    const reopened = await startClient(t, options);
    const beforeReplay = await snapshotProcessTree(reopened.child.pid);
    assert.deepEqual(await replay(reopened, run_id), saved);
    assert.equal(reopened.outputs.size, 0, "archive RPC must not emit live terminal output");
    assert.equal(reopened.spawnedSessions.size, 0);
    const afterReplay = await snapshotProcessTree(reopened.child.pid);
    assert.deepEqual(afterReplay, beforeReplay, "replay must not create child processes");
    await shutdown(reopened);
});

test("a killed core retains committed prefix as interrupted and never manufactures EOF", { timeout: 60000 }, async (t) => {
    const options = await fixture(), run_id = randomUUID();
    const first = await startClient(t, options);
    await spawnFixture(first, 1, "interactive", [], { run_id });
    await waitRecord(first, 1, "ready");
    await inputCommand(first, 1, { op: "echo", value: "Durable before crash 🙂" });
    await waitRecord(first, 1, "echo");
    const before = await replay(first, run_id);
    assert.equal(before.metadata.finished, false);
    await first.captureProcessTree();
    const owned = [...first.processIdentities.values()];
    first.child.kill(); // Uses this launch's retained ChildProcess handle.
    await first.closed;
    await waitForOwnedGone(owned);
    const reopened = await startClient(t, options);
    const after = await replay(reopened, run_id);
    assert.deepEqual(after.bytes, before.bytes);
    assert.deepEqual([after.metadata.finished, after.metadata.process_eof, after.metadata.capture_complete, after.metadata.exit_code], [false, false, false, null]);
    assert.equal(reopened.outputs.size, 0);
    await shutdown(reopened);
});

test("run identity cannot be reused and malformed archive requests do not poison RPC", { timeout: 40000 }, async (t) => {
    const options = await fixture(), run_id = randomUUID();
    const client = await startClient(t, options);
    await spawnFixture(client, 1, "metadata", [], { run_id });
    await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 1);
    const before = await replay(client, run_id);
    const duplicate = await client.request("spawn", { session_id: 2, run_id, executable: process.execPath, args: [fixturePath, "metadata"], cwd: repoRoot });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error_code, "RunAlreadyExists");
    assert.deepEqual(await replay(client, run_id), before);
    const malformed = await client.request("transcripts.metadata", { run_id: "../not-a-run" });
    assert.equal(malformed.error_code, "InvalidRunId");
    assert.equal((await client.request("transcripts.read", { run_id, offset: before.bytes.length + 1 })).ok, false);
    assert.equal((await client.request("hello")).ok, true);
    await shutdown(client);
});
