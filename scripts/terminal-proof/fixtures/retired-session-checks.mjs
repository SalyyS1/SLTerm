import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { waitForGone } from "../core-client.mjs";
import { assertOrderedExit, spawnFixture, startClient, waitRecord } from "./test-support.mjs";
import { sampleProcessHandleCount } from "./windows-process-tree.mjs";

async function sweepRetired(client, sessionId) {
    const deadline = Date.now() + 5000;
    do {
        assert.equal((await client.request("hello")).ok, true);
        const probe = await client.request("ack", { session_id: sessionId, sequence: 0 });
        if (probe.error_code === "SessionExited") return;
        assert.equal(probe.error_code, "InvalidAcknowledgement", JSON.stringify(probe));
        // The exit frame is emitted just before the reader publishes exited.
        // Probe the observable tombstone state instead of guessing a sleep.
        await delay(10);
    } while (Date.now() < deadline);
    assert.fail(`Session ${sessionId} did not retire after exit and hello sweeps`);
}

export async function verifyRetiredSessionResources(t) {
    const client = await startClient(t);
    let nextId = 1000;
    const runBatch = async (count) => {
        const ids = [];
        for (let index = 0; index < count; index++) {
            const id = nextId++;
            ids.push(id);
            await spawnFixture(client, id, "metadata", [`short-lived-${id}`]);
            const child = await waitRecord(client, id, "metadata");
            const exit = await client.waitFor((frame) => frame.event === "exit" && frame.session_id === id);
            assert.equal(exit.exit_code, 37);
            assertOrderedExit(client, id, exit);
            await waitForGone([child.pid]);
            // The exact child has exited; do not retain its recyclable PID as a
            // cleanup target while many subsequent processes are being created.
            client.ownedPids.delete(child.pid);
        }
        for (const id of ids) await sweepRetired(client, id);
    };

    // This lifecycle workload exposes per-session leaks; it is neither a
    // throughput benchmark nor an application/session-count limit.
    await runBatch(6);
    const baseline = await sampleProcessHandleCount(client.child.pid);
    const baselineLow = Math.min(...baseline.handles);
    const baselineHigh = Math.max(...baseline.handles);
    const noise = Math.max(1, baselineHigh - baselineLow);
    const measured = [];
    for (let batch = 0; batch < 3; batch++) {
        await runBatch(12);
        const sample = await sampleProcessHandleCount(client.child.pid);
        assert.equal(sample.createdAt, baseline.createdAt, "must measure the same core process identity");
        measured.push(sample.handles);
        const sorted = [...sample.handles].sort((left, right) => left - right);
        const median = sorted[Math.floor(sorted.length / 2)];
        assert.ok(median <= baselineHigh + noise,
            `retired sessions retained handles: baseline=${JSON.stringify(baseline.handles)}, batches=${JSON.stringify(measured)}, noise=${noise}`);
    }
    t.diagnostic(`retired-session handles: ${JSON.stringify({ warmup: 6, batchSize: 12, baseline: baseline.handles, afterBatches: measured, noiseAllowance: noise })}`);

    const duplicate = await client.request("spawn", { session_id: 1000, executable: process.execPath });
    assert.deepEqual([duplicate.ok, duplicate.error_code], [false, "DuplicateSession"]);
    for (const [method, fields] of [["input", { data: "x" }], ["resize", { cols: 120, rows: 40 }], ["ack", { sequence: 1 }]]) {
        const retired = await client.request(method, { session_id: 1000, ...fields });
        assert.deepEqual([retired.ok, retired.error_code], [false, "SessionExited"]);
    }
    assert.equal((await client.request("stop", { session_id: 1000 })).ok, true);
    assert.equal((await client.request("stop", { session_id: 1000 })).ok, true);
    client.closing = true;
    assert.equal((await client.request("shutdown")).ok, true);
    assert.equal((await client.waitClosed()).code, 0);
}
