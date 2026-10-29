import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { isAlive, waitForGone } from "../core-client.mjs";
import { assertOrderedExit, spawnFixture, startClient, waitRecord } from "./test-support.mjs";

export async function verifyStalledStdoutShutdown(t) {
    const client = await startClient(t);
    const sessions = [40, 42, 43];
    const children = [];
    for (const id of sessions) {
        await spawnFixture(client, id, "no-read");
        children.push(await waitRecord(client, id, "ready"));
    }
    await client.captureProcessTree();
    const hello = await client.request("hello");
    // Capabilities make handshake replies larger than empty acknowledgements.
    // Saturate the OS/Node pipe while keeping this graceful-drain workload
    // below the writer's byte budget; overload has its own separate fixture.
    const frameBytes = Buffer.byteLength(JSON.stringify({ ...hello, id: 9999999 })) + 5;
    const requestCount = Math.floor((192 * 1024) / frameBytes);
    client.child.stdout.pause();
    t.after(() => client.child.stdout.resume());
    const replies = Array.from({ length: requestCount }, () => client.request("hello", {}, 20000).catch((error) => error));
    await delay(500);
    assert.ok(client.child.stdout.readableLength >= client.child.stdout.readableHighWaterMark,
        "paused stdout must fill the Node read buffer before shutdown");
    const buffered = client.child.stdout.readableLength;
    await delay(200);
    assert.equal(client.child.stdout.readableLength, buffered, "stdout must remain stalled");
    client.closing = true;
    const shutdown = client.request("shutdown", {}, 20000).catch((error) => error);
    // Acknowledgement cannot arrive until the peer reads again. Job termination
    // must still happen before resuming stdout, without killing the core.
    let stopError;
    try { await waitForGone(children.map((child) => child.pid), 3000); }
    catch (error) { stopError = error; }
    assert.ok(isAlive(client.child.pid), "core must retain undelivered ordered frames");
    await delay(1100);
    assert.match(client.stderr, /TransportDrainPending.*unconfirmed/);
    client.child.stdout.resume();
    assert.equal((await shutdown).ok, true);
    assert.ok((await Promise.all(replies)).every((reply) => reply.ok), "every accepted hello needs its reply");
    assert.equal((await client.waitClosed()).code, 0);
    for (const id of sessions) {
        const exit = client.frames.find((frame) => frame.event === "exit" && frame.session_id === id);
        assert.ok(exit);
        assertOrderedExit(client, id, exit);
    }
    if (stopError) throw stopError;
}

export async function verifyStalledStdoutOverload(t) {
    const client = await startClient(t);
    await spawnFixture(client, 41, "no-read");
    const ready = await waitRecord(client, 41, "ready");
    await client.captureProcessTree();
    client.closing = true;
    client.child.stdout.pause();
    t.after(() => client.child.stdout.resume());
    // More replies than the OS pipe, Node read buffer, and 256 KiB writer
    // budget combined. This must produce an explicit transport failure.
    const firstId = client.nextId;
    const replies = Array.from({ length: 30000 }, () => client.request("hello", {}, 20000).catch((error) => error));
    await waitForGone([ready.pid], 5000);
    assert.ok(isAlive(client.child.pid), "queued output must survive transport overload until stdout resumes");
    assert.match(client.stderr, /TransportBackpressure.*unconfirmed/);
    assert.ok(client.child.stdout.readableLength >= client.child.stdout.readableHighWaterMark);
    client.child.stdout.resume();
    assert.equal((await client.waitClosed()).code, 1);
    const outcomes = await Promise.all(replies);
    const failure = client.frames.find((frame) => frame.event === "transport_error");
    assert.deepEqual([failure?.error_code, failure?.pending_requests_unprocessed], ["TransportBackpressure", true]);
    assert.match(failure.message, /output transport is full.*Pending requests were not processed.*unconfirmed/);
    assert.equal(client.frames.filter((frame) => frame.error_code === "TransportBackpressure" && frame.id).length, 1);
    const responses = client.frames.filter((frame) => frame.id >= firstId && frame.id < firstId + replies.length);
    const cutoff = responses.at(-1);
    assert.ok(responses.length > 1, "a successful request prefix must drain before close");
    assert.deepEqual(responses.map((frame) => frame.id), Array.from({ length: cutoff.id - firstId + 1 }, (_, index) => firstId + index));
    assert.ok(responses.slice(0, -1).every((frame) => frame.ok === true), "all requests before the cutoff need one ordered success");
    assert.deepEqual([cutoff.ok, cutoff.error_code], [false, "TransportBackpressure"]);
    assert.ok(client.frames.indexOf(failure) > client.frames.indexOf(cutoff), "transport error must identify the unprocessed suffix after the cutoff response");
    assert.deepEqual(outcomes.slice(0, responses.length), responses);
    assert.ok(outcomes.length > responses.length, "overload workload must include an unprocessed request suffix");
    assert.ok(outcomes.slice(responses.length).every((outcome) => outcome instanceof Error), "unprocessed requests must never receive responses");
    const exit = client.frames.find((frame) => frame.event === "exit" && frame.session_id === 41);
    assert.ok(exit);
    assertOrderedExit(client, 41, exit);
}

export async function verifyClosedStdoutShutdown(t) {
    const client = await startClient(t);
    await spawnFixture(client, 44, "no-read");
    const ready = await waitRecord(client, 44, "ready");
    await client.captureProcessTree();
    assert.equal((await client.request("hello")).ok, true);
    client.closing = true;
    const stdoutClosed = once(client.child.stdout, "close");
    client.child.stdout.destroy();
    await stdoutClosed;
    const shutdownId = client.nextId;
    const outcome = client.request("shutdown", {}, 5000).catch((error) => error);
    assert.equal((await client.waitClosed(5000)).code, 1, "stdout write failure must prevent successful process exit");
    assert.ok((await outcome) instanceof Error, "closed stdout cannot confirm shutdown acknowledgement");
    assert.equal(client.frames.some((frame) => frame.id === shutdownId && frame.ok), false);
    assert.match(client.stderr, /TransportWriteFailed.*unconfirmed/);
    await waitForGone([ready.pid]);
}
