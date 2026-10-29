import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access } from "node:fs/promises";
import { join } from "node:path";
import { CoreClient, repoRoot } from "./core-client.mjs";

const root = await mkdtemp(join(repoRoot, "proof-results/preferences-rpc-"));
const database = join(root, "hồ-sơ.sqlite3");
const open = () => new CoreClient({ env: { ...process.env, SLTERM_ADE_DATABASE: database } });
async function request(client, method, args = {}) {
    const frame = await client.request(method, args);
    assert.equal(frame.ok, true, `${method}: ${frame.error_code}; ${client.stderr}`);
    return frame.result;
}
async function read(client) {
    const chunks = []; let offset = 0, revision;
    while (true) {
        const result = await request(client, "preferences.load", { offset });
        revision ??= result.revision;
        assert.equal(result.revision, revision); assert.equal(result.offset, offset);
        const chunk = Buffer.from(result.data, "base64"); chunks.push(chunk); offset += chunk.length;
        if (result.eof) { assert.equal(offset, result.total_bytes); break; }
        assert.ok(chunk.length > 0 && chunk.length <= 16384);
    }
    return { revision, json: Buffer.concat(chunks).toString("utf8") };
}
async function write(client, value, revision) {
    const bytes = Buffer.from(JSON.stringify(value));
    const { upload_id } = await request(client, "preferences.save.begin", { total_bytes: bytes.length, expected_revision: revision });
    for (let offset = 0; offset < bytes.length; offset += 16384) {
        const chunk = bytes.subarray(offset, offset + 16384);
        const result = await request(client, "preferences.save.chunk", { upload_id, offset, data: chunk.toString("base64") });
        assert.equal(result.received_bytes, offset + chunk.length);
    }
    return { upload_id, frame: await client.request("preferences.save.commit", { upload_id }) };
}
async function close(client) {
    const frame = await client.request("shutdown"); assert.equal(frame.ok, true);
    assert.deepEqual(await client.closed, { code: 0, signal: null });
}

test("chunked SQLite preferences survive restart, enforce CAS and retain backup", async () => {
    let client = open();
    try {
        assert.deepEqual(await read(client), { revision: 0, json: "" });
        const value = { version: 1, name: "Tiếng Việt 🙂".repeat(10000) };
        const saved = await write(client, value, 0);
        assert.equal(saved.frame.ok, true); assert.equal(saved.frame.result.revision, 1);
        assert.deepEqual(JSON.parse((await read(client)).json), value);
        await close(client); client = open();
        assert.deepEqual(JSON.parse((await read(client)).json), value);
        const stale = await write(client, { version: 1, wrong: true }, 0);
        assert.equal(stale.frame.ok, false); assert.equal(stale.frame.error_code, "RevisionConflict");
        await request(client, "preferences.save.cancel", { upload_id: stale.upload_id });
        assert.deepEqual(JSON.parse((await read(client)).json), value);
        const next = await write(client, { version: 1, name: "updated" }, 1);
        assert.equal(next.frame.ok, true); assert.equal(next.frame.result.revision, 2);
        await access(database + ".previous");
        await close(client);
    } finally { await client.dispose(); }
});

test("invalid offsets, incomplete documents and cancelled uploads never commit", async () => {
    const client = open();
    try {
        const before = await read(client);
        const { upload_id } = await request(client, "preferences.save.begin", { total_bytes: 20, expected_revision: before.revision });
        const invalid = await client.request("preferences.save.chunk", { upload_id, offset: 1, data: "eA==" });
        assert.equal(invalid.error_code, "InvalidOffset");
        const incomplete = await client.request("preferences.save.commit", { upload_id });
        assert.equal(incomplete.error_code, "IncompleteUpload");
        await request(client, "preferences.save.cancel", { upload_id });
        assert.equal((await client.request("preferences.save.commit", { upload_id })).error_code, "UnknownUpload");
        const bad = await write(client, { version: 1, name: "valid" }, before.revision);
        assert.equal(bad.frame.ok, true);
        assert.equal((await read(client)).revision, before.revision + 1);
        await close(client);
    } finally { await client.dispose(); }
});

test("a known upload identity permits cancellation after a missing begin response", async () => {
    const client = open();
    try {
        const before = await read(client);
        const upload_id = "client-knows-this-id";
        assert.equal((await request(client, "preferences.save.begin", { upload_id, total_bytes: 2, expected_revision: before.revision })).upload_id, upload_id);
        // A consumer that timed out can send the same identity without needing
        // any data from the original begin acknowledgement.
        await request(client, "preferences.save.cancel", { upload_id });
        const next = await write(client, { version: 1, recovered: true }, before.revision);
        assert.equal(next.frame.ok, true);
        await close(client);
    } finally { await client.dispose(); }
});
