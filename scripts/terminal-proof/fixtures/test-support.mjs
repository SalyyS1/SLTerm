import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";
import { CoreClient, repoRoot } from "../core-client.mjs";

export const fixturePath = fileURLToPath(new URL("terminal-child.mjs", import.meta.url));
export const textOutput = (client, sessionId) => stripVTControlCharacters(client.output(sessionId).toString("utf8")).replaceAll("\r", "");

export function records(client, sessionId) {
    const output = textOutput(client, sessionId);
    const result = [];
    // ConPTY may render a newline as cursor movement, so records cannot depend
    // on literal LF bytes surviving the console's VT rendering.
    for (const marker of output.matchAll(/@proof:\{/g)) {
        const start = marker.index + "@proof:".length;
        for (let end = output.indexOf("}", start); end !== -1; end = output.indexOf("}", end + 1)) {
            try { result.push(JSON.parse(output.slice(start, end + 1))); break; }
            catch { /* A record may be split across arbitrary output chunks. */ }
        }
    }
    return result;
}

export async function startClient(t, options) {
    const client = new CoreClient(options);
    t.after(() => client.dispose());
    const ready = await client.waitFor((frame) => frame.event === "ready", "core ready");
    assert.equal(ready.engine, "zig-conpty-proof");
    assert.equal(ready.pid, client.child.pid);
    return client;
}

export async function spawnFixture(client, sessionId, mode = "interactive", args = [], extra = {}) {
    const result = await client.request("spawn", {
        session_id: sessionId, executable: process.execPath,
        args: [fixturePath, mode, ...args], cwd: repoRoot, cols: 512, rows: 40, ...extra,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
}

export async function waitRecord(client, sessionId, type, predicate = () => true) {
    const record = await client.waitUntil(() => {
        const found = records(client, sessionId);
        const failure = found.find((item) => item.type === "fixture-error");
        assert.equal(failure, undefined, failure?.error);
        return found.find((item) => item.type === type && predicate(item));
    }, `session ${sessionId} ${type}`).catch((error) => {
        throw new Error(`${error.message}; terminal output=${JSON.stringify(textOutput(client, sessionId).slice(-4000))}`, { cause: error });
    });
    if (record.pid) client.trackPid(record.pid);
    if (record.child) client.trackPid(record.child);
    return record;
}

export async function inputCommand(client, sessionId, command) {
    const result = await client.request("input", { session_id: sessionId, data: `${JSON.stringify(command)}\r` });
    assert.equal(result.ok, true, JSON.stringify(result));
}

export function assertOrderedExit(client, sessionId, exit) {
    const frames = client.frames.filter((frame) => frame.session_id === sessionId);
    assert.equal(frames.at(-1), exit, "exit must follow all session output");
    const output = frames.filter((frame) => frame.event === "output");
    assert.ok(output.length > 0, "real child output required");
    assert.deepEqual(output.map((frame) => frame.sequence), output.map((_, index) => index + 1));
    assert.equal(exit.last_sequence, output.length);
}
