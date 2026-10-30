import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { promisify } from "node:util";
import { coreExecutable, CoreClient } from "./core-client.mjs";

const exec = promisify(execFile);
let gitExecutable = process.env.SLTERM_GIT_EXECUTABLE;
const ids = ["76dfa41a-5824-4530-9fc1-05037f0d4240", "ef7156b3-ed90-449e-8b74-917b99248e2c", "d78c4ff2-c21f-4e23-92a8-33356a2fa2bc"];
const git = async (cwd, ...args) => (await exec(gitExecutable, args, { cwd, windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 })).stdout.trim();

async function fixture(t, { longPath = false } = {}) {
    const scratch = await mkdtemp(path.join(tmpdir(), "slterm worktrees Việt 日本語 "));
    const root = path.join(scratch, `${longPath ? "nested checkout destination ".repeat(4) : ""}dự án 日本語`);
    await mkdir(root);
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.name", "SLTerm fixture");
    await git(root, "config", "user.email", "fixture@invalid.example");
    await writeFile(path.join(root, "Tiếng Việt 日本語.txt"), "original\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fixture initial");
    const clients = [];
    const connect = async () => {
        const client = new CoreClient({ env: { ...process.env, SLTERM_GIT_EXECUTABLE: gitExecutable } });
        clients.push(client);
        await client.waitFor((frame) => frame.event === "ready");
        return client;
    };
    t.after(async () => {
        try { for (const client of clients.reverse()) await client.dispose(); }
        finally { await rm(scratch, { recursive: true, force: true }); }
    });
    const client = await connect();
    const request = (method, fields = {}, target = client) => target.request(method, { root, task_id: ids[0], ...fields });
    const ok = async (method, fields, target) => {
        const frame = await request(method, fields, target);
        assert.equal(frame.ok, true, `${method}: ${frame.error_code}`);
        return frame.result;
    };
    const inspect = (task_id = ids[0], target) => ok("worktrees.inspect", { task_id }, target);
    const prepare = (snapshot, target) => ok("worktrees.prepare", {
        task_id: snapshot.branch.slice("slterm/task/".length), base_revision: snapshot.base_revision, if_match: snapshot.head_revision,
    }, target);
    return { scratch, root, client, connect, request, ok, inspect, prepare };
}

describe("real Zig-owned Windows Git task worktrees", { concurrency: false, skip: process.platform !== "win32", timeout: 120000 }, () => {
    before(async () => {
        await access(coreExecutable);
        if (!gitExecutable) {
            const located = await exec(path.join(process.env.SystemRoot ?? "C:/Windows", "System32/where.exe"), ["git.exe"], { windowsHide: true });
            gitExecutable = located.stdout.split(/\r?\n/).find((candidate) => path.isAbsolute(candidate) && path.basename(candidate).toLowerCase() === "git.exe");
        }
        assert.ok(gitExecutable, "set SLTERM_GIT_EXECUTABLE to an installed Git executable");
        await access(gitExecutable);
    });

    it("creates distinct Unicode worktrees from HEAD and preserves the main checkout", async (t) => {
        const f = await fixture(t);
        const mainHead = await git(f.root, "rev-parse", "HEAD");
        const firstPlan = await f.inspect();
        await assert.rejects(access(`${f.root}.slterm-worktrees`), { code: "ENOENT" });
        await assert.rejects(access(path.join(f.root, ".git/slterm-tasks")), { code: "ENOENT" });
        assert.equal(firstPlan.exists, false);
        assert.equal(firstPlan.ready, false);
        assert.equal(firstPlan.base_revision, mainHead);
        assert.equal(path.normalize(firstPlan.path), path.normalize(`${f.root}.slterm-worktrees/${ids[0]}`));
        const first = await f.prepare(firstPlan);
        const second = await f.prepare(await f.inspect(ids[1]));
        assert.equal(first.ready, true);
        assert.equal(second.ready, true);
        assert.notEqual(first.path, second.path);
        assert.equal(await git(first.path, "branch", "--show-current"), first.branch);
        assert.equal(await git(second.path, "status", "--porcelain"), "");
        await writeFile(path.join(first.path, "Tiếng Việt 日本語.txt"), "task edit\n");
        assert.equal(await readFile(path.join(f.root, "Tiếng Việt 日本語.txt"), "utf8"), "original\n");
        assert.equal(await readFile(path.join(second.path, "Tiếng Việt 日本語.txt"), "utf8"), "original\n");
        assert.equal(await git(f.root, "status", "--porcelain"), "");
        assert.equal(await git(f.root, "rev-parse", "HEAD"), mainHead);
    });

    it("reconciles duplicates across core restart and rejects changed base/current head", async (t) => {
        const f = await fixture(t);
        const snapshot = await f.inspect();
        const created = await f.prepare(snapshot);
        const receipt = path.join(f.root, ".git/slterm-tasks", `${ids[0]}.json`);
        const before = await stat(receipt);
        assert.deepEqual(await f.prepare(snapshot), created);
        await f.client.dispose();
        const restarted = await f.connect();
        assert.deepEqual(await f.inspect(ids[0], restarted), created);
        assert.deepEqual(await f.prepare(snapshot, restarted), created);
        assert.equal((await stat(receipt)).mtimeMs, before.mtimeMs);
        assert.equal((await git(f.root, "worktree", "list", "--porcelain")).match(/^worktree /gm).length, 2);
        await writeFile(path.join(created.path, "new.txt"), "new commit\n");
        await git(created.path, "add", ".");
        await git(created.path, "commit", "-m", "task progresses");
        const stale = await f.request("worktrees.prepare", { base_revision: snapshot.base_revision, if_match: snapshot.head_revision }, restarted);
        assert.equal(stale.error_code, "WorktreeRevisionChanged");
        const fresh = await f.inspect(ids[0], restarted);
        assert.equal(fresh.base_revision, snapshot.base_revision);
        assert.notEqual(fresh.head_revision, snapshot.head_revision);
        assert.equal((await f.prepare(fresh, restarted)).head_revision, fresh.head_revision);
        assert.equal((await f.request("worktrees.prepare", { base_revision: "0".repeat(40), if_match: fresh.head_revision }, restarted)).error_code, "BaseRevisionChanged");
    });

    it("creates the approved absolute worktree when Git's internal directory string exceeds its Windows limit", async (t) => {
        const f = await fixture(t, { longPath: true });
        const mainHead = await git(f.root, "rev-parse", "HEAD");
        const snapshot = await f.inspect();
        assert.ok(Buffer.byteLength(`${snapshot.path}/.git`, "utf8") > 220);
        const created = await f.prepare(snapshot);
        assert.equal(created.ready, true);
        assert.equal(created.path, snapshot.path);
        assert.equal(created.base_revision, mainHead);
        assert.equal(created.head_revision, mainHead);
        assert.equal(await readFile(path.join(created.path, "Tiếng Việt 日本語.txt"), "utf8"), "original\n");
        assert.deepEqual(await f.inspect(), created);
        assert.equal(await git(f.root, "rev-parse", "HEAD"), mainHead);
        assert.equal(await git(f.root, "status", "--porcelain"), "");
    });

    it("rejects stale first-create approval, path/branch collisions and task path fragments", async (t) => {
        const f = await fixture(t);
        const old = await f.inspect();
        await writeFile(path.join(f.root, "later.txt"), "main advances\n");
        await git(f.root, "add", ".");
        await git(f.root, "commit", "-m", "main advances");
        assert.equal((await f.request("worktrees.prepare", { base_revision: old.base_revision })).error_code, "BaseRevisionChanged");
        for (const task_id of ["../outside", "a/../../b", "--malicious", `${ids[0]}\\escape`, "x".repeat(500)]) {
            assert.equal((await f.request("worktrees.inspect", { task_id })).error_code, "InvalidTaskId");
        }
        const planned = await f.inspect();
        await mkdir(planned.path, { recursive: true });
        await writeFile(path.join(planned.path, "retain.txt"), "user content");
        assert.equal((await f.request("worktrees.prepare", { base_revision: planned.base_revision })).error_code, "WorktreePathCollision");
        assert.equal(await readFile(path.join(planned.path, "retain.txt"), "utf8"), "user content");
        await git(f.root, "branch", `slterm/task/${ids[1]}`);
        assert.equal((await f.request("worktrees.inspect", { task_id: ids[1] })).error_code, "WorktreeBranchCollision");
        assert.equal((await f.inspect(ids[2].toUpperCase())).branch, `slterm/task/${ids[2]}`);
        const nested = path.join(f.root, "nested");
        await mkdir(nested);
        assert.equal((await f.request("worktrees.inspect", { root: nested, task_id: ids[2] })).error_code, "RepositoryRootRequired");
        const unsafeGit = path.join(f.root, "git.exe");
        await writeFile(unsafeGit, "repository-controlled executable must never run");
        const unsafeClient = new CoreClient({ env: { ...process.env, SLTERM_GIT_EXECUTABLE: unsafeGit } });
        try {
            await unsafeClient.waitFor((frame) => frame.event === "ready");
            assert.equal((await f.request("worktrees.inspect", { task_id: ids[2] }, unsafeClient)).error_code, "UntrustedGitExecutable");
        } finally { await unsafeClient.dispose(); }
    });

    it("disables hooks and refuses repository checkout filters and conditional includes", async (t) => {
        const f = await fixture(t);
        const hooks = path.join(f.scratch, "custom hooks");
        const marker = path.join(f.scratch, "HOOK-RAN");
        await mkdir(hooks);
        await writeFile(path.join(hooks, "post-checkout"), `#!/bin/sh\nprintf unsafe > '${marker.replaceAll("\\", "/")}'\n`);
        await git(f.root, "config", "core.hooksPath", hooks);
        await f.prepare(await f.inspect());
        await assert.rejects(access(marker), { code: "ENOENT" });
        await git(f.root, "config", "filter.untrusted.smudge", "powershell.exe -NoProfile -Command throw");
        const filtered = await f.inspect(ids[1]);
        assert.equal((await f.request("worktrees.prepare", { task_id: ids[1], base_revision: filtered.base_revision })).error_code, "UnsafeGitCheckoutConfiguration");
        await git(f.root, "config", "--unset", "filter.untrusted.smudge");
        const included = path.join(f.scratch, "included config");
        await writeFile(included, "[filter \"untrusted\"]\n\tsmudge = echo unsafe\n");
        await git(f.root, "config", "include.path", included);
        assert.equal((await f.request("worktrees.prepare", { task_id: ids[1], base_revision: filtered.base_revision })).error_code, "UnsafeGitCheckoutConfiguration");
        await assert.rejects(access(marker), { code: "ENOENT" });
    });

    it("keeps interrupted ownership unknown and rejects a sibling junction escape", async (t) => {
        const f = await fixture(t);
        const snapshot = await f.inspect();
        const receipts = path.join(f.root, ".git/slterm-tasks");
        await mkdir(receipts);
        await writeFile(path.join(receipts, `${ids[0]}.json`), JSON.stringify({ version: 1, root: snapshot.root, path: snapshot.path, branch: snapshot.branch, base_revision: snapshot.base_revision }));
        const unknown = await f.inspect();
        assert.equal(unknown.completion_unknown, true);
        assert.equal(unknown.ready, false);
        assert.equal((await f.request("worktrees.prepare", { base_revision: unknown.base_revision })).error_code, "WorktreeCompletionUnknown");
        await mkdir(snapshot.path, { recursive: true });
        const reserved = await f.inspect();
        assert.equal(reserved.exists, true);
        assert.equal(reserved.ready, false);
        assert.equal(reserved.completion_unknown, true);
        assert.equal((await f.request("worktrees.prepare", { base_revision: reserved.base_revision })).error_code, "WorktreeCompletionUnknown");
        await rm(`${f.root}.slterm-worktrees`, { recursive: true });
        const outside = path.join(f.scratch, "outside");
        await mkdir(outside);
        await symlink(outside, `${f.root}.slterm-worktrees`, "junction");
        assert.equal((await f.request("worktrees.inspect", { task_id: ids[1] })).error_code, "ReparsePointBlocked");
        await assert.rejects(access(path.join(outside, ids[1])), { code: "ENOENT" });
    });

    it("keeps terminal control responsive while the worker executes Git", async (t) => {
        const f = await fixture(t);
        const snapshot = await f.inspect();
        const preparing = f.prepare(snapshot);
        const start = Date.now();
        const hello = await f.client.request("hello");
        assert.equal(hello.ok, true);
        assert.ok(Date.now() - start < 1500, "main protocol loop must stay responsive");
        await preparing;
    });

    it("requires a complete receipt even when Git metadata exists and preserves interrupted checkout edits", async (t) => {
        const f = await fixture(t);
        const created = await f.prepare(await f.inspect());
        const receipt = path.join(f.root, ".git/slterm-tasks", `${ids[0]}.json`);
        const original = JSON.parse(await readFile(receipt, "utf8"));
        assert.equal(original.complete, true);
        const sentinel = path.join(created.path, "Tiếng Việt 日本語.txt");
        await writeFile(sentinel, "external edit after interrupted checkout\n");
        const incomplete = JSON.stringify({ ...original, complete: false });
        await writeFile(receipt, incomplete);
        const interrupted = await f.inspect();
        assert.equal(interrupted.exists, true);
        assert.equal(interrupted.ready, false);
        assert.equal(interrupted.completion_unknown, true);
        assert.equal((await f.request("worktrees.prepare", { base_revision: created.base_revision, if_match: created.head_revision })).error_code, "WorktreeCompletionUnknown");
        const restarted = await f.connect();
        assert.deepEqual(await f.inspect(ids[0], restarted), interrupted);
        assert.equal(await readFile(receipt, "utf8"), incomplete);
        assert.equal(await readFile(sentinel, "utf8"), "external edit after interrupted checkout\n");
        await writeFile(receipt, '{"version":1,"complete":tr');
        assert.equal((await f.request("worktrees.inspect")).error_code, "InvalidWorktreeReceipt");
        assert.equal((await f.request("worktrees.prepare", { base_revision: created.base_revision, if_match: created.head_revision })).error_code, "InvalidWorktreeReceipt");
        assert.equal(await readFile(sentinel, "utf8"), "external edit after interrupted checkout\n");
    });

    it("publishes every admitted worktree outcome before shutdown acknowledgement", async (t) => {
        const f = await fixture(t);
        const snapshot = await f.inspect();
        const preparing = f.prepare(snapshot);
        const shutdown = f.client.request("shutdown");
        const [result, stopped] = await Promise.all([preparing, shutdown]);
        assert.equal(result.ready, true);
        assert.equal(stopped.ok, true);
        const resultIndex = f.client.frames.findIndex((frame) => frame.result?.path === result.path && frame.result?.ready);
        assert.ok(resultIndex >= 0 && resultIndex < f.client.frames.indexOf(stopped));
        assert.deepEqual(await f.client.waitClosed(), { code: 0, signal: null });
    });
});
