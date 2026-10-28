import assert from "node:assert/strict";
// Run explicitly with node --test; the name intentionally avoids Vitest discovery.
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { coreExecutable, isAlive, waitForGone } from "./core-client.mjs";
import { assertOrderedExit, fixturePath, inputCommand, records, spawnFixture, startClient, textOutput, waitRecord } from "./fixtures/test-support.mjs";
import { waitForOwnedGone } from "./fixtures/windows-process-tree.mjs";
import { verifyRetiredSessionResources } from "./fixtures/retired-session-checks.mjs";

describe("real Windows ConPTY proof", { concurrency: false, skip: process.platform !== "win32", timeout: 300000 }, () => {
    before(async () => {
        await access(coreExecutable).catch(() => assert.fail(`Build the real Zig proof first: ${coreExecutable}`));
    });

    it("delivers raw Unicode input, split UTF-8 output, actual resize and ordered exit", { timeout: 40000 }, async (t) => {
        let callbackCount = 0;
        const client = await startClient(t, { onOutput: async () => { await delay(2); callbackCount++; } });
        await spawnFixture(client, 1, "interactive", [], { cols: 120, rows: 30 });
        const ready = await waitRecord(client, 1, "ready");
        assert.deepEqual([ready.tty, ready.cols, ready.rows], [true, 120, 30]);
        const unicode = "Tiếng Việt — 日本語 🙂";
        await inputCommand(client, 1, { op: "echo", value: unicode });
        assert.equal((await waitRecord(client, 1, "echo")).value, unicode);
        assert.equal((await client.request("resize", { session_id: 1, cols: 137, rows: 43 })).ok, true);
        const resized = await waitRecord(client, 1, "resize", (record) => record.cols === 137 && record.rows === 43);
        assert.deepEqual([resized.cols, resized.rows], [137, 43]);
        await inputCommand(client, 1, { op: "size" });
        const size = await waitRecord(client, 1, "size");
        assert.deepEqual([size.cols, size.rows], [137, 43]);
        await inputCommand(client, 1, { op: "split", value: unicode });
        await waitRecord(client, 1, "split-done");
        assert.ok(textOutput(client, 1).includes(`@proof:split:${unicode}:end`));
        assert.ok(!textOutput(client, 1).includes("\uFFFD"), "split UTF-8 must not become replacement characters");
        await inputCommand(client, 1, { op: "exit", code: 23 });
        const exit = await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 1, "child exit");
        assert.equal(exit.exit_code, 23);
        assert.ok(textOutput(client, 1).includes("@proof:final-output-before-exit"));
        assertOrderedExit(client, 1, exit);
        assert.ok(callbackCount > 1);
        await waitForGone([ready.pid]);
    });

    it("preserves Windows argv quoting, Unicode cwd and final output", { timeout: 40000 }, async (t) => {
        const client = await startClient(t);
        const cwd = await mkdtemp(path.join(tmpdir(), "slterm-proof Việt 日本語 "));
        t.after(() => rm(cwd, { recursive: true }));
        const argv = ["", "space value", 'embedded"quote', "C:\\trailing slash\\", 'backslash\\\"quote', "日本語 🙂", "& | < > ^ % !"];
        await spawnFixture(client, 2, "metadata", argv, { cwd, cols: 1024 });
        const metadata = await waitRecord(client, 2, "metadata");
        assert.deepEqual([metadata.stdinTTY, metadata.stdoutTTY], [true, true]);
        assert.equal(path.normalize(metadata.cwd), path.normalize(cwd));
        assert.deepEqual(metadata.argv, argv);
        const exit = await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 2);
        assert.equal(exit.exit_code, 37);
        assert.ok(textOutput(client, 2).includes("@proof:final-output-before-exit"));
        assertOrderedExit(client, 2, exit);
    });

    it("rejects incompatible, malformed and invalid requests without poisoning the transport", { timeout: 40000 }, async (t) => {
        const client = await startClient(t);
        for (const [method, fields, code] of [
            ["hello", { version: 2 }, "UnsupportedVersion"],
            ["resize", { session_id: 99, cols: 0 }, "InvalidDimensions"],
            ["input", { session_id: 99, data: "x" }, "UnknownSession"],
            ["spawn", { session_id: 0 }, "InvalidSessionId"],
        ]) {
            const result = await client.request(method, fields);
            assert.deepEqual([result.ok, result.error_code], [false, code]);
        }
        client.child.stdin.write("{malformed-json}\n");
        const malformed = await client.waitFor((frame) => frame.id === 0 && frame.error_code === "MalformedRequest");
        assert.equal(malformed.ok, false);
        assert.equal((await client.request("hello")).ok, true);
    });

    it("rejects duplicate sessions and invalid ACKs while keeping the original child alive", { timeout: 40000 }, async (t) => {
        const client = await startClient(t);
        await spawnFixture(client, 3);
        const ready = await waitRecord(client, 3, "ready");
        const duplicate = await client.request("spawn", { session_id: 3, executable: process.execPath, args: [fixturePath, "metadata"] });
        assert.deepEqual([duplicate.ok, duplicate.error_code], [false, "DuplicateSession"]);
        const invalid = await client.request("ack", { session_id: 3, sequence: 999 });
        assert.deepEqual([invalid.ok, invalid.error_code], [false, "InvalidAcknowledgement"]);
        client.autoAck = false;
        const sequence = client.sequences.get(3);
        const acknowledged = await client.request("ack", { session_id: 3, sequence });
        assert.ok(acknowledged.ok || acknowledged.error_code === "InvalidAcknowledgement");
        const repeated = await client.request("ack", { session_id: 3, sequence });
        assert.deepEqual([repeated.ok, repeated.error_code], [false, "InvalidAcknowledgement"]);
        const oversizedInput = await client.request("input", { session_id: 3, data: "x".repeat(4097) });
        assert.deepEqual([oversizedInput.ok, oversizedInput.error_code], [false, "InputTooLarge"]);
        assert.ok(isAlive(ready.pid));
        assert.equal((await client.request("stop", { session_id: 3 })).ok, true);
        const exit = await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 3);
        assertOrderedExit(client, 3, exit);
        await waitForGone([ready.pid]);
    });

    it("bounds stalled output and responds to stop without requiring an ACK", { timeout: 40000 }, async (t) => {
        let stalledSequence;
        const client = await startClient(t, { onOutput: (frame, _bytes, transport) => {
            const ready = records(transport, 4).find((record) => record.type === "ready");
            if (ready) {
                transport.trackPid(ready.pid);
                transport.autoAck = false;
                stalledSequence = frame.sequence;
            }
        } });
        await spawnFixture(client, 4, "flood");
        await waitRecord(client, 4, "ready");
        await delay(200);
        assert.ok(stalledSequence > 0);
        assert.equal(client.frames.filter((frame) => frame.event === "output").length, stalledSequence);
        assert.equal((await client.request("hello", {}, 2000)).ok, true);
        assert.equal((await client.request("stop", { session_id: 4 }, 2000)).ok, true);
        const exit = await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 4, "stalled child stopped", 5000);
        const gap = client.frames.find((frame) => frame.event === "gap" && frame.session_id === 4);
        assert.ok(gap?.discarded_bytes > 0, "discarded terminal output must be reported");
        assert.equal(exit.last_sequence, stalledSequence);
        assertOrderedExit(client, 4, exit);
    });

    it("keeps hello and stop responsive when a child never reads stdin", { timeout: 40000 }, async (t) => {
        const client = await startClient(t);
        await spawnFixture(client, 5, "no-read");
        const ready = await waitRecord(client, 5, "ready");
        const requests = Array.from({ length: 256 }, () => client.request("input", { session_id: 5, data: "x".repeat(4096) }, 5000));
        const responses = await Promise.all(requests);
        assert.ok(responses.some((frame) => frame.error_code === "InputBackpressure"), "bounded input queue must reject overload explicitly");
        assert.ok(responses.every((frame) => frame.ok || frame.error_code === "InputBackpressure"));
        assert.equal((await client.request("hello", {}, 2000)).ok, true);
        assert.equal((await client.request("stop", { session_id: 5 }, 2000)).ok, true);
        await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 5, "unread-input child stopped", 5000);
        const uncertain = client.frames.filter((frame) => frame.event === "input-error" && frame.session_id === 5);
        assert.ok(uncertain.length > 0, "stopping queued input must report delivery uncertainty");
        assert.ok(uncertain.every((frame) => frame.error_code === "InputDeliveryUncertain" && frame.affected_bytes > 0));
        assert.ok(uncertain.reduce((total, frame) => total + frame.affected_bytes, 0) <= responses.filter((frame) => frame.ok).length * 4096);
        await waitForGone([ready.pid]);
    });

    for (const action of ["stop", "parent exit", "stdin EOF", "core termination", "oversized frame"]) {
        it(`cleans the owned process tree after ${action}`, { timeout: 40000 }, async (t) => {
            const client = await startClient(t);
            const baseline = await client.captureProcessTree();
            const token = `owned-${process.pid}-${action.replaceAll(" ", "-")}`;
            await spawnFixture(client, 6, "tree", [token]);
            const parent = await waitRecord(client, 6, "ready");
            const descendant = await waitRecord(client, 6, "descendant");
            assert.equal(descendant.token, token);
            assert.equal(descendant.parent, parent.pid);
            assert.ok(isAlive(parent.pid) && isAlive(descendant.pid));
            const tree = await client.captureProcessTree();
            const sessionTree = tree.filter((item) => !baseline.some((initial) => item.pid === initial.pid && item.createdAt === initial.createdAt));
            assert.ok(sessionTree.some((item) => item.pid === parent.pid));
            assert.ok(sessionTree.some((item) => item.pid === descendant.pid));
            assert.ok(sessionTree.length >= 3, "session delta must include its ConPTY host and both fixture generations");
            if (action === "stop") {
                assert.equal((await client.request("stop", { session_id: 6 })).ok, true);
                await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 6);
                assert.equal((await client.request("hello")).ok, true);
            } else if (action === "parent exit") {
                await inputCommand(client, 6, { op: "exit", code: 0 });
                const exit = await client.waitFor((frame) => frame.event === "exit" && frame.session_id === 6);
                assert.equal(exit.exit_code, 0);
                assert.equal((await client.request("hello")).ok, true);
            } else if (action === "stdin EOF") {
                client.endInput();
                assert.equal((await client.waitClosed()).code, 0);
            } else if (action === "core termination") {
                client.closing = true;
                client.child.kill();
                await client.waitClosed();
            } else {
                client.closing = true;
                client.child.stdin.write("x".repeat(64 * 1024 + 1));
                const result = await client.waitFor((frame) => frame.error_code === "FrameTooLarge");
                assert.deepEqual([result.id, result.ok], [0, false]);
                await client.waitClosed();
            }
            // A live core owns a separate baseline console host. Per-session
            // stop must remove only the session tree; core shutdown removes all.
            await waitForOwnedGone(action === "stop" || action === "parent exit" ? sessionTree : tree);
        });
    }

    it("reclaims resources for retired sessions while preserving their identities", { timeout: 150000 }, verifyRetiredSessionResources);

    it("runs ten simultaneous independent terminals and closes every child", { timeout: 40000 }, async (t) => {
        const client = await startClient(t);
        const ids = Array.from({ length: 10 }, (_, index) => index + 100);
        // Ten is the comparison workload, not an implementation concurrency limit.
        const children = [];
        for (const id of ids) {
            await spawnFixture(client, id);
            children.push(await waitRecord(client, id, "ready"));
        }
        assert.equal(new Set(children.map((child) => child.pid)).size, 10);
        assert.ok(children.every((child) => isAlive(child.pid)));
        await Promise.all(ids.map((id) => inputCommand(client, id, { op: "echo", value: `session-${id}-🙂` })));
        for (const id of ids) assert.equal((await waitRecord(client, id, "echo")).value, `session-${id}-🙂`);
        await Promise.all(ids.map((id) => inputCommand(client, id, { op: "exit", code: 0 })));
        for (const id of ids) {
            const exit = await client.waitFor((frame) => frame.event === "exit" && frame.session_id === id);
            assert.equal(exit.exit_code, 0);
            assertOrderedExit(client, id, exit);
            assert.equal(records(client, id).filter((record) => record.type === "ready").length, 1);
        }
        await waitForGone(children.map((child) => child.pid));
    });
});
