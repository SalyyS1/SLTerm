/* Windows GUI proof with a disposable native argv recorder, never a live AI provider. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHarness, run, waitFor } from "./fixtures/task-worktree-harness.mjs";
import { createRecorder } from "./fixtures/task-native-recorder.mjs";
import { liveOwnedProcesses, waitForOwnedGone } from "./fixtures/windows-process-tree.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, "proof-results", `task-worktree-smoke-${Date.now()}-${process.pid}`);
const profile = path.join(out, "webview");
const repository = path.join(out, "source repo");
const sentinel = path.join(out, "SHELL_EXECUTED.txt");
const title = "Task argv stop and completion";
const interruptedTitle = "Task interrupted by graceful quit";
const prompt = [
    `--dangerously-skip-permissions "quoted"; [IO.File]::WriteAllText('${sentinel.replaceAll("'", "''")}', 'SHELL_EXECUTED')`,
    `$(Write-Output injected) & echo SHOULD_NOT_RUN > "${sentinel}"`,
    '`backtick` %PATH% !PATH! Tiếng Việt 😀 \\\"end\\\\',
].join("\n");
const interruptedPrompt = "Persist this approved task as stopped history after quit. Tiếng Việt 😀";
const results = [];
let harness, recorder, baseRevision;
const samePath = (actual, expected) => assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
const card = (name) => `[...document.querySelectorAll('.task-card')].find(x => x.querySelector('strong')?.textContent === ${JSON.stringify(name)})`;
const taskState = (name) => `(() => { const c = ${card(name)}; return c && { status: c.dataset.status, text: c.textContent, worktree: c.querySelector('.task-worktree-path')?.title, goal: c.querySelector('p')?.textContent }; })()`;
function persistedTask(name) {
    const database = new DatabaseSync(path.join(profile, "ade-profile/profile.sqlite3"), { readOnly: true });
    try {
        const row = database.prepare("SELECT document FROM ade_settings WHERE id=1").get();
        const task = JSON.parse(row.document).tasks.find((item) => item.title === name);
        assert(task, "Task must exist in the native SQLite preferences document");
        return task;
    } finally { database.close(); }
}
async function git(cwd, args) {
    const { stdout } = await run(recorder.git, ["-c", "core.hooksPath=NUL", ...args], {
        cwd, env: { ...recorder.environment, GIT_CONFIG_GLOBAL: "NUL", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
        windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
}
async function prepare() {
    recorder = await createRecorder(out);
    harness = createHarness({ root, out, profile, environment: recorder.environment });
    fs.mkdirSync(repository);
    await git(repository, ["init", "--initial-branch=main"]);
    fs.writeFileSync(path.join(repository, "fixture.txt"), "Disposable GUI task fixture.\n");
    await git(repository, ["add", "--", "fixture.txt"]);
    await git(repository, ["-c", "user.name=SLTerm GUI Fixture", "-c", "user.email=fixture@invalid.example", "commit", "-m", "test: initial disposable task fixture"]);
    baseRevision = await git(repository, ["rev-parse", "HEAD"]);
    harness.save("fixture.json", { repository, baseRevision, provider: recorder.binary, profile, port: 19232, prompt, interruptedPrompt,
        hostEnvironmentKeys: Object.keys(recorder.environment).sort(), noLiveProvider: true });
    const artifacts = [harness.host, path.join(root, "native-core/zig-out/bin/slterm-core-proof.exe"), import.meta.filename,
        ...["cdp-client.mjs", "fixtures/task-worktree-harness.mjs", "fixtures/task-native-recorder.mjs", "fixtures/windows-process-tree.mjs"].map((file) => path.join(root, "scripts/terminal-proof", file)), recorder.binary];
    harness.save("artifacts.json", artifacts.map((file) => ({ file: path.relative(root, file), sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") })));
}
async function dialog(app, expected) {
    await app.wait(`document.querySelector('dialog h2')?.textContent === ${JSON.stringify(expected)}`);
}
async function accept(app) {
    await app.evaluate("document.querySelector('dialog form').requestSubmit()");
    await app.wait("!document.querySelector('dialog')");
}
async function createTask(app, name, goal, attempts) {
    await app.fill('.task-create [aria-label="Tên task"]', name);
    await app.fill('.task-create [aria-label="Mục tiêu task"]', goal);
    await app.fill('.task-create [aria-label="Provider task"]', "codex");
    await app.fill('.task-create [aria-label="Số lượt thử tối đa"]', String(attempts));
    await app.fill('.task-create [aria-label="Thời gian tối đa mỗi lượt"]', "2");
    await app.click("Thêm task", "document.querySelector('.task-create')");
    await app.wait(`(${card(name)})?.dataset.status === 'draft'`);
    assert.equal((await app.evaluate(taskState(name))).goal, goal, "Task goal must preserve multiline Unicode text");
}
async function review(app, name, number, minutes = 2) {
    await app.click(`Xem và duyệt lượt ${number}`, `(${card(name)})`);
    await dialog(app, "Duyệt lượt chạy task");
    const text = await app.evaluate("document.querySelector('dialog .dialog-body').innerText");
    assert(text.includes(name) && text.includes("codex") && text.includes(`tối đa ${minutes} phút`), "Approval must show task, provider and duration");
    assert(text.includes(`Base: ${baseRevision}`) && text.includes(`HEAD: ${baseRevision}`), "Approval must show exact Git revisions");
    assert(text.includes("slterm/task/") && text.includes(".slterm-worktrees"), "Approval must show worktree path and branch");
    return text;
}
async function verifyTranscript(app, pid) {
    await app.click("Tìm trong terminal · Ctrl F");
    await app.fill('.search-bar [aria-label="Tìm trong terminal"]', "SLTERM_TASK_RECORDER_DELIBERATELY_ABSENT");
    await app.wait("document.querySelector('.search-result')?.textContent === 'Không thấy'");
    await app.fill('.search-bar [aria-label="Tìm trong terminal"]', `SLTERM_TASK_RECORDER_READY ${pid}`);
    await app.wait("document.querySelector('.search-result')?.textContent === ''");
    await app.click("Đóng tìm kiếm");
}
async function replenishBudget(app) {
    const before = await app.evaluate(taskState(interruptedTitle));
    const savedBefore = persistedTask(interruptedTitle);
    assert(before.text.includes("lượt 1/1") && before.text.includes("2 phút/lượt"));
    await app.click("Điều chỉnh budget", `(${card(interruptedTitle)})`); await dialog(app, "Điều chỉnh budget task");
    await app.fill('dialog input[name="attempts"]', "2"); await app.fill('dialog input[name="minutes"]', "3");
    await app.click("Hủy", "document.querySelector('dialog')"); await app.wait("!document.querySelector('dialog')");
    assert.deepEqual(await app.evaluate(taskState(interruptedTitle)), before, "Cancelled budget edit must preserve consumed attempts and budget");
    await app.click("Điều chỉnh budget", `(${card(interruptedTitle)})`); await dialog(app, "Điều chỉnh budget task");
    await app.fill('dialog input[name="attempts"]', "2"); await app.fill('dialog input[name="minutes"]', "3"); await accept(app);
    const after = await app.evaluate(taskState(interruptedTitle));
    const savedAfter = persistedTask(interruptedTitle);
    assert.deepEqual(savedAfter.attempt, savedBefore.attempt, "Budget edits must preserve the exact persisted approval receipt");
    assert.equal(savedAfter.attempts, savedBefore.attempts); assert.equal(savedAfter.maxAttempts, 2); assert.equal(savedAfter.maxMinutes, 3);
    assert.equal(after.status, "blocked"); assert.equal(after.goal, interruptedPrompt); samePath(after.worktree, before.worktree);
    assert(after.text.includes("lượt 1/2") && after.text.includes("3 phút/lượt"), "Budget edit must keep consumed attempt and apply the reviewed new limits");
    assert(!(await app.evaluate(taskState(title))).text.includes("Điều chỉnh budget"), "Completed task must not offer a budget change");
    const freshReview = await review(app, interruptedTitle, 2, 3);
    await harness.screenshot(app, "05-budget-needs-fresh-review.png");
    await app.click("Hủy", "document.querySelector('dialog')"); await app.wait("!document.querySelector('dialog')");
    assert.deepEqual(await app.evaluate(taskState(interruptedTitle)), after, "Fresh review alone must not reserve another attempt");
    assert.equal(recorder.read().length, 3, "Budget edits and fresh review must never invoke a provider");
    const processes = await harness.coreDetails(app);
    assert(processes.processes.every((item) => item.ProcessId === processes.core.pid || item.Name?.toLowerCase() === "conhost.exe"), "Budget edits must not spawn a shell or provider");
    harness.save("budget-replenishment.json", { before, after, savedBefore, savedAfter, freshReview, providerReceiptCount: 3, processes });
    results.push("Stopped task budget can be cancelled or increased; consumed attempt stays 1, task stays blocked, and a fresh review is required without provider spawn");
}
async function running(app, name, number, goal, previousCount) {
    const approval = await review(app, name, number);
    harness.save(`approval-${previousCount + 1}.json`, { name, number, text: approval });
    await accept(app);
    await app.wait(`(${card(name)})?.dataset.status === 'running'`);
    const state = await app.evaluate(taskState(name));
    assert(state.text.includes(`lượt ${number}/`) && state.text.includes("terminal running"), "Task must show the running terminal and reserved attempt");
    await waitFor(() => recorder.read().length === previousCount + 1, "one new native provider argv receipt");
    const receipts = recorder.read();
    const receipt = receipts.find((item) => item.args[1] === goal && !verifiedPids.has(item.pid));
    assert(receipt, "Expected native receipt for the exact approved task");
    verifiedPids.add(receipt.pid);
    assert.deepEqual(receipt.args, ["--", goal], "Prompt must be exactly one native argument after the option terminator");
    samePath(receipt.cwd, state.worktree);
    const shellProfile = path.dirname(receipt.home);
    samePath(path.dirname(shellProfile), path.join(root, "proof-results"));
    assert.match(path.basename(shellProfile), new RegExp(`^host-${app.proc.pid}-[0-9]+$`), "Shell profile must belong to this owned host launch");
    const shellDirectory = fs.lstatSync(shellProfile);
    assert(shellDirectory.isDirectory() && !shellDirectory.isSymbolicLink() && shellDirectory.birthtimeMs >= app.startedAt - 2000, "Shell state directory must be created by this launch");
    samePath(receipt.home, path.join(shellProfile, "home")); samePath(receipt.profile, receipt.home);
    if (app.shellProfile) samePath(app.shellProfile, shellProfile); else app.shellProfile = shellProfile;
    assert(!fs.existsSync(sentinel), "Prompt shell syntax must never execute");
    const id = path.basename(state.worktree);
    assert.match(id, /^[0-9a-f-]{36}$/);
    const branch = `slterm/task/${id}`;
    samePath(state.worktree, path.join(`${repository}.slterm-worktrees`, id));
    assert.equal(await git(state.worktree, ["branch", "--show-current"]), branch);
    assert.equal(await git(state.worktree, ["rev-parse", "HEAD"]), baseRevision);
    assert.equal(fs.readFileSync(path.join(state.worktree, "fixture.txt"), "utf8"), "Disposable GUI task fixture.\n");
    const ownership = JSON.parse(fs.readFileSync(path.join(repository, ".git/slterm-tasks", `${id}.json`), "utf8"));
    samePath(ownership.root, repository); samePath(ownership.path, state.worktree);
    assert.equal(ownership.branch, branch); assert.equal(ownership.base_revision, baseRevision);
    assert.equal(ownership.complete, true, "Native ownership receipt must confirm checkout completion");
    const persisted = persistedTask(name);
    assert.equal(persisted.attempt.goal, goal); assert.equal(persisted.attempt.provider, "codex");
    assert.equal(persisted.attempt.number, number); assert.equal(persisted.attempt.deadlineAt - persisted.attempt.approvedAt, 120000);
    samePath(persisted.attempt.path, receipt.cwd); assert.equal(persisted.attempt.baseRevision, baseRevision);
    await harness.capture(app);
    const identity = app.owned.find((item) => item.pid === receipt.pid);
    assert(identity, "Native provider must be a verified GUI descendant");
    assert.equal((await liveOwnedProcesses([identity])).length, 1, "Native provider must remain alive while task runs");
    harness.save(`running-${previousCount + 1}.json`, { state, persisted, receipt, identity, ownership });
    return { state, receipt, identity };
}
const verifiedPids = new Set();
async function scenario() {
    const first = await harness.launch();
    await first.click("Workspace mới"); await dialog(first, "Workspace mới");
    await first.fill('dialog input[name="name"]', "Disposable Git task smoke");
    await first.fill('dialog input[name="cwd"]', repository); await accept(first);
    await first.wait(`document.querySelector('.workspace-location')?.title === ${JSON.stringify(repository)}`);
    await first.click("Tasks");
    await createTask(first, title, prompt, 2);
    assert.equal(recorder.read().length, 0, "Creating a draft must not launch a provider");
    assert.equal(await git(repository, ["worktree", "list", "--porcelain"]).then((text) => text.match(/^worktree /gm)?.length), 1);
    const cancelledApproval = await review(first, title, 1);
    await harness.screenshot(first, "01-review-before-approval.png");
    await first.click("Hủy", "document.querySelector('dialog')"); await first.wait("!document.querySelector('dialog')");
    assert.equal((await first.evaluate(taskState(title))).status, "draft");
    assert(!fs.existsSync(`${repository}.slterm-worktrees`), "Cancelled approval must not create a worktree");
    assert.equal(recorder.read().length, 0, "Cancelled approval must not launch a provider");
    harness.save("cancelled-review.json", { text: cancelledApproval, state: await first.evaluate(taskState(title)), providerReceipts: [] });
    results.push("Draft and cancelled review create no worktree or provider process");

    const attempt1 = await running(first, title, 1, prompt, 0);
    await verifyTranscript(first, attempt1.receipt.pid);
    await harness.screenshot(first, "02-running-task.png");
    await first.click("Dừng task", `(${card(title)})`); await dialog(first, "Dừng task?");
    await first.click("Hủy", "document.querySelector('dialog')"); await first.wait("!document.querySelector('dialog')");
    assert.equal((await liveOwnedProcesses([attempt1.identity])).length, 1, "Cancelling stop must keep the owned provider alive");
    assert.equal((await first.evaluate(taskState(title))).status, "running");
    await first.click("Dừng task", `(${card(title)})`); await dialog(first, "Dừng task?"); await accept(first);
    await first.wait(`(${card(title)})?.dataset.status === 'blocked'`);
    await waitForOwnedGone([attempt1.identity], 10000);
    assert(fs.existsSync(attempt1.state.worktree), "Stop must retain the worktree for review");
    results.push("Running task receives exact argv; cancelled stop remains live; approved stop ends provider and retains worktree");

    const attempt2 = await running(first, title, 2, prompt, 1);
    samePath(attempt2.state.worktree, attempt1.state.worktree);
    await first.click("Xác nhận hoàn tất", `(${card(title)})`); await dialog(first, "Dừng process và xác nhận task hoàn tất?");
    await first.click("Hủy", "document.querySelector('dialog')"); await first.wait("!document.querySelector('dialog')");
    assert.equal((await first.evaluate(taskState(title))).status, "running");
    assert.equal((await liveOwnedProcesses([attempt2.identity])).length, 1);
    await first.click("Xác nhận hoàn tất", `(${card(title)})`); await dialog(first, "Dừng process và xác nhận task hoàn tất?"); await accept(first);
    await first.wait(`(${card(title)})?.dataset.status === 'completed'`);
    await waitForOwnedGone([attempt2.identity], 10000);
    assert(!(await first.evaluate(taskState(title))).text.includes("Xem và duyệt lượt"), "Completed tasks must not offer another launch");
    results.push("Second approved attempt reuses owned worktree; completion requires confirmation and stops provider");

    await createTask(first, interruptedTitle, interruptedPrompt, 1);
    const interrupted = await running(first, interruptedTitle, 1, interruptedPrompt, 2);
    await harness.screenshot(first, "03-completed-and-live-tasks.png");
    assert.equal(await git(repository, ["status", "--porcelain"]), "", "Source repository must remain unchanged");
    harness.save("before-quit.json", { tasks: [await first.evaluate(taskState(title)), await first.evaluate(taskState(interruptedTitle))], receipts: recorder.read() });
    await harness.quit(first);
    await waitForOwnedGone([interrupted.identity]);
    results.push("Graceful quit stops the live task and exits 0 with no owned survivors");

    const reopened = await harness.launch();
    await reopened.wait(`document.querySelector('.workspace-location')?.title === ${JSON.stringify(repository)}`);
    await reopened.click("Tasks");
    await reopened.wait(`(${card(title)})?.dataset.status === 'completed' && (${card(interruptedTitle)})?.dataset.status === 'blocked'`);
    assert.equal((await reopened.evaluate(taskState(title))).goal, prompt);
    assert.equal((await reopened.evaluate(taskState(interruptedTitle))).goal, interruptedPrompt);
    samePath((await reopened.evaluate(taskState(title))).worktree, attempt1.state.worktree);
    samePath((await reopened.evaluate(taskState(interruptedTitle))).worktree, interrupted.state.worktree);
    assert(await reopened.evaluate("[...document.querySelectorAll('.pane-state')].length >= 4 && [...document.querySelectorAll('.pane-state')].every(x => x.textContent === 'Lịch sử · đã dừng')"), "All saved panes must restore as stopped history");
    assert(await reopened.evaluate("document.querySelector('.footer-count').textContent.startsWith('0 đang chạy')"));
    const details = await harness.coreDetails(reopened);
    const consoleHost = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/conhost.exe").toLowerCase();
    assert(details.processes.filter((item) => item.ProcessId !== details.core.pid).every((item) => item.Name?.toLowerCase() === "conhost.exe" && item.ExecutablePath?.toLowerCase() === consoleHost), "Reopen must not start shells or provider processes");
    assert.equal(recorder.read().length, 3, "Restart must not invoke any provider");
    assert(!fs.existsSync(sentinel), "No shell injection sentinel may exist");
    await verifyTranscript(reopened, interrupted.receipt.pid);
    await replenishBudget(reopened);
    await harness.screenshot(reopened, "04-restored-stopped-history.png");
    harness.save("reopened.json", { tasks: [await reopened.evaluate(taskState(title)), await reopened.evaluate(taskState(interruptedTitle))], processes: details, receipts: recorder.read() });
    results.push("Restart preserves completed task, worktrees, exact goals and searchable recorder output; interrupted task becomes blocked; every pane is stopped history; no provider respawn");
    await harness.quit(reopened);
    results.push("Reopened application exits 0 with no owned survivors");
}
async function main() {
    assert.equal(process.platform, "win32", "Windows-only GUI smoke");
    fs.mkdirSync(out, { recursive: true });
    let failure;
    try { await prepare(); await scenario(); }
    catch (error) {
        failure = error;
        for (const app of harness?.apps ?? []) if (!app.exit && app.client) {
            try { await harness.screenshot(app, `failure-${app.proc.pid}.png`); } catch { /* Keep original failure. */ }
            try { harness.save(`failure-ui-${app.proc.pid}.json`, await app.evaluate("({ text: document.body.innerText, html: document.querySelector('.task-board-panel')?.outerHTML, dialog: document.querySelector('dialog')?.outerHTML })")); } catch { /* CDP may already be closed. */ }
        }
    } finally {
        for (const app of harness?.apps ?? []) {
            await harness.cleanup(app);
            if (app.cleanup.forced || app.cleanup.errors.length) failure ??= new Error(`Fallback cleanup required: ${JSON.stringify(app.cleanup)}`);
        }
        fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ ok: !failure, profile, repository, port: 19232, results,
            error: failure ? String(failure.stack ?? failure) : null,
            launches: harness?.apps.map((app) => ({ pid: app.proc.pid, shellProfile: app.shellProfile, exit: app.exit, owned: app.owned, cleanup: app.cleanup })) ?? [] }, null, 2));
    }
    console.log(out);
    if (failure) throw failure;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
