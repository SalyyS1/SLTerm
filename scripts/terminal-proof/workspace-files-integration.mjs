import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { promisify } from "node:util";
import { coreExecutable, CoreClient } from "./core-client.mjs";

const revision = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stages = async (root) => (await readdir(root)).filter((name) => name.startsWith(".slterm-ade-"));
const recoveryFiles = async (root) => (await readdir(root)).filter((name) => name.startsWith(".slterm-recovery-"));
const exec = promisify(execFile);

async function dacl(target, protect = false) {
    const change = protect ? "$acl = Get-Acl -LiteralPath $env:SLTERM_FILE_TEST_PATH; $acl.SetAccessRuleProtection($true, $true); Set-Acl -LiteralPath $env:SLTERM_FILE_TEST_PATH -AclObject $acl; " : "";
    const { stdout } = await exec("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `${change}(Get-Acl -LiteralPath $env:SLTERM_FILE_TEST_PATH).GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)`], {
        windowsHide: true, env: { ...process.env, SLTERM_FILE_TEST_PATH: target },
    });
    return stdout.trim();
}

async function fixture(t) {
    const root = await mkdtemp(path.join(tmpdir(), "slterm ADE Việt 日本語 "));
    const client = new CoreClient();
    t.after(async () => { await client.dispose(); await rm(root, { recursive: true, force: true }); });
    await client.waitFor((frame) => frame.event === "ready");
    const request = async (method, fields = {}) => {
        const frame = await client.request(method, { root, ...fields });
        assert.ok(Buffer.byteLength(JSON.stringify(frame)) < 64 * 1024);
        return frame;
    };
    const ok = async (method, fields) => {
        const frame = await request(method, fields);
        assert.equal(frame.ok, true, `${method}: ${frame.error_code}`);
        return frame.result;
    };
    return { root, client, request, ok };
}

async function upload(ok, file, original, content) {
    const { upload_id } = await ok("files.save.begin", { path: file, if_match: revision(original), total_bytes: content.length });
    for (let offset = 0; offset < content.length; offset += 16384) {
        await ok("files.save.chunk", { upload_id, offset, data: content.subarray(offset, offset + 16384).toString("base64") });
    }
    return upload_id;
}

describe("real Windows ADE workspace files", { concurrency: false, skip: process.platform !== "win32", timeout: 120000 }, () => {
    before(() => access(coreExecutable));

    it("lists bounded pages with Unicode relative paths and empty directories", async (t) => {
        const { root, ok } = await fixture(t);
        await mkdir(path.join(root, "trống 日本語"));
        const names = Array.from({ length: 55 }, (_, index) => `tệp-${index}-🙂.txt`);
        await Promise.all(names.map((name) => writeFile(path.join(root, name), name)));
        let cursor = 0;
        const entries = [];
        do {
            const result = await ok("files.list", { path: "", cursor });
            assert.ok(result.entries.length <= 24);
            entries.push(...result.entries);
            cursor = result.next_cursor;
        } while (cursor !== null);
        assert.equal(new Set(entries.map((entry) => entry.path)).size, 56);
        for (const name of names) assert.equal(entries.find((entry) => entry.path === name)?.kind, "file");
        assert.equal(entries.find((entry) => entry.name === "trống 日本語")?.kind, "directory");
        assert.deepEqual((await ok("files.list", { path: "trống 日本語" })).entries, []);
    });

    it("reads split UTF-8 bytes with a full-file revision and strict offsets", async (t) => {
        const { root, ok, request } = await fixture(t);
        const content = Buffer.from("Tiếng Việt 日本語 🙂\r\n".repeat(4000));
        await writeFile(path.join(root, "nội dung.txt"), content);
        const chunks = [];
        let offset = 0;
        while (true) {
            const result = await ok("files.read", { path: "nội dung.txt", offset });
            const chunk = Buffer.from(result.data, "base64");
            assert.ok(chunk.length <= 16384);
            assert.equal(result.revision, revision(content));
            assert.equal(result.total_bytes, content.length);
            assert.equal(result.offset, offset);
            chunks.push(chunk);
            offset += chunk.length;
            if (result.eof) break;
        }
        assert.deepEqual(Buffer.concat(chunks), content);
        assert.equal((await request("files.read", { path: "nội dung.txt", offset: content.length + 1 })).error_code, "InvalidReadOffset");
    });

    it("commits ordered chunks under an exclusive lock, including empty replacement", async (t) => {
        const { root, ok } = await fixture(t);
        const original = Buffer.from("ban đầu");
        const file = "biên tập 🙂.txt";
        const target = path.join(root, file);
        await writeFile(target, original);
        const content = Buffer.from("mới — 日本語 🙂\r\n".repeat(3000));
        const upload_id = await upload(ok, file, original, content);
        assert.deepEqual(await readFile(target), original, "staging cannot mutate source");
        assert.equal((await stages(root)).length, 1);
        const result = await ok("files.save.commit", { upload_id });
        assert.equal(result.revision, revision(content));
        assert.equal(result.total_bytes, content.length);
        assert.deepEqual(await readFile(target), content);
        assert.deepEqual(await stages(root), []);
        assert.deepEqual(await recoveryFiles(root), []);
        const empty = await upload(ok, file, content, Buffer.alloc(0));
        await ok("files.save.commit", { upload_id: empty });
        assert.deepEqual(await readFile(target), Buffer.alloc(0));
    });

    it("detects an external edit, preserves it and removes the conflicting stage", async (t) => {
        const { root, ok, request } = await fixture(t);
        const original = Buffer.from("original");
        await writeFile(path.join(root, "conflict.txt"), original);
        const upload_id = await upload(ok, "conflict.txt", original, Buffer.from("editor buffer"));
        await writeFile(path.join(root, "conflict.txt"), "external update");
        assert.equal((await request("files.save.commit", { upload_id })).error_code, "RevisionConflict");
        assert.equal(await readFile(path.join(root, "conflict.txt"), "utf8"), "external update");
        assert.deepEqual(await stages(root), []);
        assert.equal((await request("files.save.begin", { path: "conflict.txt", if_match: revision(original), total_bytes: 1 })).error_code, "RevisionConflict");
        const fresh = Buffer.from("external update");
        const retry = await upload(ok, "conflict.txt", fresh, Buffer.from("explicit retry"));
        await ok("files.save.commit", { upload_id: retry });
        assert.equal(await readFile(path.join(root, "conflict.txt"), "utf8"), "explicit retry");
    });

    it("detects external atomic replacement and rejects a hardlink alias before writing", async (t) => {
        const { root, ok, request } = await fixture(t);
        const original = Buffer.from("original");
        const target = path.join(root, "alias.txt");
        await writeFile(target, original);
        const upload_id = await upload(ok, "alias.txt", original, Buffer.from("editor"));
        await writeFile(path.join(root, "external.tmp"), "external atomic save");
        await rename(path.join(root, "external.tmp"), target);
        assert.equal((await request("files.save.commit", { upload_id })).error_code, "RevisionConflict");
        const outside = await mkdtemp(path.join(tmpdir(), "slterm-hardlink-outside-"));
        t.after(() => rm(outside, { recursive: true, force: true }));
        await link(target, path.join(outside, "same-file.txt"));
        const blocked = await upload(ok, "alias.txt", Buffer.from("external atomic save"), Buffer.from("must not modify"));
        assert.equal((await request("files.save.commit", { upload_id: blocked })).error_code, "HardLinkedFileBlocked");
        assert.equal(await readFile(path.join(outside, "same-file.txt"), "utf8"), "external atomic save");
        assert.deepEqual(await stages(root), []);
        assert.deepEqual(await recoveryFiles(root), []);
    });

    it("accepts a client-known upload token and rejects duplicates without replacing it", async (t) => {
        const { root, ok, request } = await fixture(t);
        await writeFile(path.join(root, "token.txt"), "a");
        const fields = { path: "token.txt", if_match: revision("a"), total_bytes: 1, upload_id: "client-known-1234" };
        assert.equal((await ok("files.save.begin", fields)).upload_id, fields.upload_id);
        assert.equal((await request("files.save.begin", fields)).error_code, "DuplicateUpload");
        assert.equal((await stages(root)).length, 1);
        await ok("files.save.chunk", { upload_id: fields.upload_id, offset: 0, data: "Yg==" });
        await ok("files.save.commit", { upload_id: fields.upload_id });
        assert.equal(await readFile(path.join(root, "token.txt"), "utf8"), "b");
        assert.equal((await request("files.save.begin", { ...fields, upload_id: "../bad" })).error_code, "InvalidUploadId");
        const reserved = await ok("files.save.begin", { ...fields, if_match: revision("b"), upload_id: "3" });
        const generated = await ok("files.save.begin", { ...fields, if_match: revision("b"), upload_id: undefined });
        assert.notEqual(generated.upload_id, reserved.upload_id);
        await ok("files.save.cancel", { upload_id: reserved.upload_id });
        await ok("files.save.cancel", { upload_id: generated.upload_id });
    });

    it("preserves a protected file DACL and identity when saving a nested Unicode path", async (t) => {
        const { root, ok } = await fixture(t);
        await mkdir(path.join(root, "thư mục"));
        const target = path.join(root, "thư mục", "bảo vệ.txt");
        await writeFile(target, "original permissions");
        const beforeAcl = await dacl(target, true);
        const beforeStat = await stat(target);
        const upload_id = await upload(ok, "thư mục/bảo vệ.txt", Buffer.from("original permissions"), Buffer.from("short"));
        const stage = (await stages(path.dirname(target)))[0];
        const stageAcl = await dacl(path.join(path.dirname(target), stage));
        // Creation clears the informational AUTO_INHERITED flag on a protected
        // copied DACL; protection and every access rule must remain identical.
        const permissions = (value) => value.replace(/^D:([A-Z]*)/, (_whole, flags) => `D:${flags.replaceAll("AI", "")}`);
        assert.ok(permissions(stageAcl) === permissions(beforeAcl), "stage protection and access rules must preserve source access");
        await ok("files.save.commit", { upload_id });
        assert.equal(await readFile(target, "utf8"), "short");
        assert.ok((await dacl(target)) === beforeAcl, "source DACL must remain identical");
        assert.equal((await stat(target)).ino, beforeStat.ino);
        assert.deepEqual(await recoveryFiles(path.dirname(target)), []);
    });

    it("rejects malformed chunks and bounds stages; cancellation and EOF clean up", async (t) => {
        const { root, client, ok, request } = await fixture(t);
        await writeFile(path.join(root, "bounded.txt"), "a");
        const { upload_id } = await ok("files.save.begin", { path: "bounded.txt", if_match: revision("a"), total_bytes: 4 });
        assert.equal((await request("files.save.chunk", { upload_id, offset: 1, data: "YQ==" })).error_code, "InvalidUploadOffset");
        assert.equal((await request("files.save.chunk", { upload_id, offset: 0, data: "??" })).error_code, "InvalidBase64");
        assert.equal((await request("files.save.chunk", { upload_id, offset: 0, data: Buffer.alloc(16385).toString("base64") })).error_code, "InvalidChunkSize");
        await ok("files.save.cancel", { upload_id });
        assert.deepEqual(await stages(root), []);
        assert.equal((await request("files.save.chunk", { upload_id, offset: 0, data: "YQ==" })).error_code, "UnknownUpload");
        const largest = await ok("files.save.begin", { path: "bounded.txt", if_match: revision("a"), total_bytes: 8 * 1024 * 1024 });
        assert.equal((await request("files.save.begin", { path: "bounded.txt", if_match: revision("a"), total_bytes: 1 })).error_code, "StagingLimit");
        await ok("files.save.cancel", { upload_id: largest.upload_id });
        await truncate(path.join(root, "bounded.txt"), 8 * 1024 * 1024 + 1);
        assert.equal((await request("files.read", { path: "bounded.txt" })).error_code, "FileTooLarge");
        await writeFile(path.join(root, "bounded.txt"), "a");
        await ok("files.save.begin", { path: "bounded.txt", if_match: revision("a"), total_bytes: 1 });
        client.endInput();
        assert.equal((await client.waitClosed()).code, 0);
        assert.deepEqual(await stages(root), []);
    });

    it("blocks traversal, device/stream aliases and reparse escapes", async (t) => {
        const { root, ok, request } = await fixture(t);
        const outside = await mkdtemp(path.join(tmpdir(), "slterm-outside-"));
        t.after(() => rm(outside, { recursive: true, force: true }));
        await writeFile(path.join(outside, "private.txt"), "outside");
        for (const name of ["../private.txt", "..\\private.txt", path.join(outside, "private.txt"), "file.txt:stream", "CON", "name. "]) {
            assert.equal((await request("files.read", { path: name })).ok, false, name);
        }
        await symlink(outside, path.join(root, "junction"), "junction");
        assert.equal((await ok("files.list", { path: "" })).entries.find((entry) => entry.name === "junction")?.kind, "symlink");
        assert.equal((await request("files.list", { path: "junction" })).error_code, "ReparsePointBlocked");
        assert.equal((await request("files.read", { path: "junction/private.txt" })).error_code, "ReparsePointBlocked");
        assert.equal((await request("files.save.begin", { path: "junction/private.txt", if_match: revision("outside"), total_bytes: 1 })).error_code, "ReparsePointBlocked");
        assert.equal(await readFile(path.join(outside, "private.txt"), "utf8"), "outside");
    });

    it("removes delete-on-close stages when its owned core is terminated", async (t) => {
        const { root, client, ok } = await fixture(t);
        await writeFile(path.join(root, "kill.txt"), "a");
        await ok("files.save.begin", { path: "kill.txt", if_match: revision("a"), total_bytes: 1 });
        assert.equal((await stages(root)).length, 1);
        client.closing = true;
        client.child.kill();
        await client.waitClosed();
        assert.deepEqual(await stages(root), []);
        assert.equal(await readFile(path.join(root, "kill.txt"), "utf8"), "a");
    });

    it("reports a failed read-only replacement and preserves source bytes", async (t) => {
        const { root, ok, request } = await fixture(t);
        const target = path.join(root, "read-only.txt");
        await writeFile(target, "original");
        const upload_id = await upload(ok, "read-only.txt", Buffer.from("original"), Buffer.from("replacement"));
        await chmod(target, 0o444);
        try {
            const result = await request("files.save.commit", { upload_id });
            assert.equal(result.ok, false);
            assert.equal(result.error_code, "AccessDenied");
            assert.equal(await readFile(target, "utf8"), "original");
            assert.deepEqual(await stages(root), []);
        } finally { await chmod(target, 0o666); }
    });
});
