/* Real coordinator + native Git IPC; provider fixtures are direct owned native children, without ConPTY. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { CoreClient, coreExecutable, repoRoot } from "./core-client.mjs";
import { createRecorder } from "./fixtures/task-native-recorder.mjs";
import { run, waitFor } from "./fixtures/task-worktree-harness.mjs";
import { snapshotProcessTree, liveOwnedProcesses, killOwnedProcesses, waitForOwnedGone } from "./fixtures/windows-process-tree.mjs";

const out = path.join(repoRoot, "proof-results", `task-worktree-integration-${Date.now()}-${process.pid}`);
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
const providers = [], operations = [], commits = [], results = [];
let client, recorder, tasks = [], coordinator, starts = [];
let commitTail = Promise.resolve(), activeGit = 0, maxActiveGit = 0, firstPreparation;
const preparing = new Promise((resolve) => { firstPreparation = resolve; });
async function git(cwd, args) {
    const { stdout } = await run(recorder.git, ["-c", "core.hooksPath=NUL", ...args], { cwd,
        env: { ...recorder.environment, GIT_CONFIG_GLOBAL: "NUL", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" }, windowsHide: true, timeout: 15000 });
    return stdout.trim();
}
async function request(method, fields) {
    const operation = { method, fields, startedAt: Date.now() }; operations.push(operation);
    activeGit++; maxActiveGit = Math.max(maxActiveGit, activeGit);
    if (method === "worktrees.prepare" && !operations.some((item) => item !== operation && item.method === method)) firstPreparation();
    try {
        const response = await client.request(method, fields, 15000);
        operation.response = response;
        assert.equal(response.ok, true, `${method}: ${response.error_code}`);
        return response.result;
    } finally { operation.finishedAt = Date.now(); activeGit--; }
}
async function setup() {
    recorder = await createRecorder(out);
    const bundled = path.join(out, "actual-task-coordinator.mjs");
    await build({ stdin: { contents: 'export { TaskRunCoordinator } from "./task-run-coordinator"; export { createTask } from "./workspace-tasks";',
        sourcefile: "task-worktree-integration-entry.ts", loader: "ts", resolveDir: path.join(repoRoot, "frontend/terminal-proof") },
        bundle: true, platform: "node", format: "esm", outfile: bundled, logLevel: "silent" });
    const { TaskRunCoordinator, createTask } = await import(pathToFileURL(bundled).href);
    const repositories = [];
    for (let index = 0; index < 2; index++) {
        const directory = path.join(out, `source repo ${index + 1}`); fs.mkdirSync(directory);
        await git(directory, ["init", "--initial-branch=main"]);
        fs.writeFileSync(path.join(directory, "fixture.txt"), `Independent source ${index + 1}.\n`);
        await git(directory, ["add", "--", "fixture.txt"]);
        await git(directory, ["-c", "user.name=SLTerm task fixture", "-c", "user.email=fixture@invalid.example", "commit", "-m", "test: initialize disposable concurrent task fixture"]);
        repositories.push({ directory, head: await git(directory, ["rev-parse", "HEAD"]) });
        tasks.push(createTask(`workspace-${index + 1}`, `Concurrent task ${index + 1}`, `Exact approved goal ${index + 1}: Tiếng Việt 😀`, "codex", 1, 2));
    }
    client = new CoreClient({ env: { ...recorder.environment, SLTERM_GIT_EXECUTABLE: recorder.git, SLTERM_ADE_DATABASE: path.join(out, "ade.db") } });
    await client.waitFor((frame) => frame.event === "ready", "native core ready");
    await client.captureProcessTree();
    // Commits follow the preference hook's serialized updater contract; this integration records them in memory.
    coordinator = new TaskRunCoordinator({ read: () => tasks, commit: (update) => {
        const operation = commitTail.then(() => { tasks = update(tasks); commits.push({ at: Date.now(), tasks: structuredClone(tasks) }); });
        commitTail = operation.catch(() => {}); return operation;
    }, inspect: (root, task_id) => request("worktrees.inspect", { root, task_id }),
        prepare: (root, task_id, base_revision, if_match) => request("worktrees.prepare", { root, task_id, base_revision, if_match }),
        open: (provider, options) => {
            assert.equal(provider, "codex");
            const paneId = providers.length + 1;
            const item = { paneId, options, status: "starting", proc: spawn(recorder.binary, ["--", options.prompt], {
                cwd: options.cwd, env: recorder.environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
            }) };
            providers.push(item); item.proc.stdout.resume(); item.proc.stderr.resume();
            item.proc.once("error", (error) => { item.error = error; });
            item.proc.once("close", (code, signal) => { item.exit = { code, signal }; item.status = "exited"; });
            return paneId;
        }, started: async (paneId) => {
            const item = providers.find((value) => value.paneId === paneId);
            await waitFor(() => { if (item.error || item.exit) throw item.error ?? new Error("Provider exited before start"); return recorder.read().some((receipt) => receipt.pid === item.proc.pid); }, "native provider receipt", 15000);
            item.owned = await snapshotProcessTree(item.proc.pid);
            assert(item.owned.some((identity) => identity.pid === item.proc.pid), "Provider identity must be captured");
            item.status = "running";
        }, close: async (paneId) => {
            const item = providers.find((value) => value.paneId === paneId);
            item.proc.stdin.end("complete\n"); await waitFor(() => item.exit, "provider graceful exit", 15000);
            assert.deepEqual(item.exit, { code: 0, signal: null }); await waitForOwnedGone(item.owned ?? []);
        }, snapshot: () => ({ sessions: Object.fromEntries(providers.map((item) => [item.paneId, { status: item.status, restored: false }])) }),
    });
    const artifacts = [import.meta.filename, coreExecutable, bundled, recorder.binary, ...["task-run-coordinator.ts", "workspace-tasks.ts"].map((file) => path.join(repoRoot, "frontend/terminal-proof", file))];
    save("artifacts.json", artifacts.map((file) => ({ file: path.relative(repoRoot, file), sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") })));
    return repositories;
}
async function scenario(repositories) {
    const approvals = [];
    for (let index = 0; index < 2; index++) approvals.push(await coordinator.review(tasks[index], repositories[index].directory));
    const calledAt = Date.now();
    starts = approvals.map((approval) => coordinator.start(approval));
    await Promise.race([preparing, Promise.all(starts)]);
    assert.equal(tasks[0].attempts, 1, "Admitted operation must persist its single attempt");
    assert.equal(tasks[1].attempts, 0, "Queued operation must not reserve an attempt before Git admission");
    await Promise.all(starts);
    assert.equal(maxActiveGit, 1, "Actual coordinator must serialize native Git requests");
    assert(operations.filter((item) => item.method === "worktrees.prepare").every((item) => item.response?.ok), "Both preparations must succeed without Busy");
    assert.equal(providers.length, 2);
    assert(tasks.every((task) => task.status === "running" && task.attempts === 1 && task.maxAttempts === 1));
    const receipts = recorder.read(); assert.equal(receipts.length, 2);
    for (let index = 0; index < 2; index++) {
        const task = tasks[index], item = providers.find((value) => value.options.taskId === task.id), receipt = receipts.find((value) => value.pid === item.proc.pid);
        assert(receipt); assert.deepEqual(receipt.args, ["--", task.goal]);
        assert.equal(path.resolve(receipt.cwd).toLowerCase(), path.resolve(task.worktree.path).toLowerCase());
        assert.equal(await git(task.worktree.path, ["rev-parse", "HEAD"]), repositories[index].head);
        assert.equal(await git(repositories[index].directory, ["status", "--porcelain"]), "");
        assert.equal((await liveOwnedProcesses(item.owned)).length, item.owned.length);
    }
    save("both-running.json", { calledAt, tasks, receipts, providers: providers.map(({ proc, ...item }) => ({ ...item, pid: proc.pid })) });
    results.push("Two actual coordinator starts overlap; Git admission reserves each one-attempt task once; both native worktree preparations succeed without Busy");
    const secondIdentity = providers.find((item) => item.options.taskId === tasks[1].id).owned;
    await coordinator.stop(tasks[0].id);
    assert.equal(tasks[0].status, "blocked"); assert.equal(tasks[1].status, "running");
    assert.equal((await liveOwnedProcesses(secondIdentity)).length, secondIdentity.length, "Second provider must remain alive after the first stops");
    await coordinator.stop(tasks[1].id, true);
    assert.equal(tasks[1].status, "completed");
    results.push("Both native providers run independently; stopping one leaves the other running; explicit completion ends the second");
    await client.captureProcessTree();
    const shutdown = await client.request("shutdown", {}, 15000); assert.equal(shutdown.ok, true);
    assert.deepEqual(await client.waitClosed(), { code: 0, signal: null });
    results.push("Native core shuts down cleanly with status 0");
}
async function main() {
    assert.equal(process.platform, "win32", "Windows-only coordinator/native integration");
    fs.mkdirSync(out, { recursive: true });
    let failure;
    try { await scenario(await setup()); } catch (error) { failure = error; }
    finally {
        await Promise.allSettled(starts);
        for (const item of providers) try {
            if (!item.owned) item.owned = await snapshotProcessTree(item.proc.pid);
            if (!item.exit) { item.proc.stdin.end("cleanup\n"); await waitFor(() => item.exit, "cleanup provider exit", 5000); }
            await waitForOwnedGone(item.owned);
        } catch (error) {
            failure ??= error;
            try { await killOwnedProcesses(item.owned ?? []); await waitForOwnedGone(item.owned ?? []); } catch (cleanupError) { failure = new AggregateError([failure, cleanupError]); }
        }
        try { await client?.dispose(); } catch (error) { failure ??= error; }
        save("result.json", { ok: !failure, results, error: failure ? String(failure.stack ?? failure) : null, tasks, operations, commits,
            maxActiveGit, requestTimeoutMs: 15000, processScope: "Real native Git IPC; native argv recorder providers are direct owned Node children, no ConPTY", core: client && { pid: client.child.pid, exit: client.exit, frames: client.frames, stderr: client.stderr },
            providers: providers.map(({ proc, ...item }) => ({ ...item, pid: proc.pid })) });
    }
    console.log(out); if (failure) throw failure;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
