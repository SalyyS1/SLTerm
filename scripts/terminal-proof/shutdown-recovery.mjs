/* Source-only Windows GUI regression. Uses only disposable profiles and owned descendants. */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { connectCdp } from "./cdp-client.mjs";
import { snapshotProcessTree, liveOwnedProcesses, killOwnedProcesses, waitForOwnedGone } from "./fixtures/windows-process-tree.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, "proof-results", `shutdown-recovery-${Date.now()}-${process.pid}`);
const profile = path.join(out, "webview");
const port = 19231;
const host = path.join(root, "src-tauri/target/release/slterm.exe");
const core = path.join(root, "native-core/zig-out/bin/slterm-core-proof.exe");
const run = promisify(execFile), apps = [], results = [];
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
async function query(command) {
    const { stdout } = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${command}`],
        { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout);
}
async function waitFor(check, label, timeout = 20000) {
    const deadline = Date.now() + timeout;
    do { const value = await check(); if (value) return value; await delay(100); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
}
async function freePort() {
    const guard = net.createServer();
    await new Promise((resolve, reject) => { guard.once("error", reject); guard.listen({ port, host: "127.0.0.1", exclusive: true }, resolve); });
    await new Promise((resolve, reject) => guard.close((error) => error ? reject(error) : resolve()));
}
async function capture(app, ancestor = app.identity) {
    const tree = await snapshotProcessTree(ancestor?.pid ?? app.proc.pid);
    if (!tree.length) return;
    const identity = tree.find((item) => item.pid === (ancestor?.pid ?? app.proc.pid));
    // Do not follow a recycled root PID into somebody else's process tree.
    if (ancestor && identity.createdAt !== ancestor.createdAt) return;
    assert(Date.parse(identity.createdAt) >= app.startedAt - 2000, "Root predates this owned launch");
    app.identity ??= identity;
    for (const item of tree) if (!app.owned.some((known) => known.pid === item.pid && known.createdAt === item.createdAt)) app.owned.push(item);
    save(`owner-${app.proc.pid}.json`, { pid: app.proc.pid, port, profile, command: host, root, owned: app.owned });
}
async function alive(app) {
    assert.equal(app.proc.exitCode, null, "Application must remain open");
    assert.equal((await liveOwnedProcesses([app.identity])).length, 1, "Owned application must remain alive");
}
async function findCore(app) {
    await capture(app);
    const children = await query(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${app.proc.pid} AND Name='slterm-core-proof.exe'" -Property ProcessId,ExecutablePath | Select-Object ProcessId,ExecutablePath)`);
    assert.equal(children.length, 1, "Exactly one owned Zig core is required");
    assert.equal(children[0].ExecutablePath?.toLowerCase(), core.toLowerCase(), "Unexpected core executable");
    const owned = app.owned.find((item) => item.pid === children[0].ProcessId && item.parentPid === app.proc.pid);
    assert(owned, "Core must be a verified descendant of this test's GUI");
    return owned;
}
async function launch() {
    await freePort();
    const log = fs.openSync(path.join(out, `host-${apps.length + 1}.stderr.log`), "wx");
    const app = { startedAt: Date.now(), owned: [], exit: null };
    app.proc = spawn(host, [], { cwd: root, windowsHide: true, stdio: ["ignore", "ignore", log],
        env: { ...process.env, SLTERM_PROOF_HIDDEN: "1", SLTERM_PROOF_PROFILE_DIR: profile,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
    fs.closeSync(log); apps.push(app);
    app.proc.once("error", (error) => { app.spawnError = error; });
    app.proc.once("close", (code, signal) => { app.exit = { code, signal }; });
    assert(Number.isInteger(app.proc.pid), "Native application did not spawn");
    await capture(app);
    await waitFor(async () => {
        if (app.spawnError || app.exit) throw app.spawnError ?? new Error(`Native application exited: ${JSON.stringify(app.exit)}`);
        const listeners = await query(`ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)`);
        if (listeners.length) await capture(app);
        assert(listeners.every((pid) => app.owned.some((item) => item.pid === pid)), "CDP listener is not owned by this GUI");
        return listeners.length > 0;
    }, "owned WebView CDP listener", 30000);
    app.client = await connectCdp(port, (target) => target.type === "page" && new URL(target.url).origin === "http://tauri.localhost", 30000);
    app.evaluate = app.client.evaluate;
    app.wait = (expression) => waitFor(() => app.evaluate(expression), expression);
    app.click = (label) => app.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(label)} || x.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) throw Error('Unavailable button'); b.click(); })()`);
    await app.wait("document.querySelector('.connection-state')?.textContent.includes('connected')");
    await capture(app);
    return app;
}
async function confirm(app, title) {
    await app.click("Dừng và thoát");
    await app.wait(`document.querySelector('dialog h2')?.textContent === ${JSON.stringify(title)}`);
}
async function exited(app, code) {
    await waitFor(() => app.exit, "native process exit", 15000);
    assert.deepEqual(app.exit, { code, signal: null }, "Native exit status must reflect shutdown outcome");
    await waitForOwnedGone(app.owned);
    app.client.close();
    await freePort();
    save(`exit-${app.proc.pid}.json`, { ...app.exit, owned: app.owned, survivors: [] });
}
const descriptors = "({ names: [...document.querySelectorAll('.tab-title')].map(x => x.textContent), cwd: document.querySelector('.workspace-location')?.title })";
async function scenario() {
    const first = await launch();
    await first.wait("document.querySelector('.pane-state')?.textContent === 'Đang chạy'");
    const savedDescriptors = await first.evaluate(descriptors);
    assert.equal(savedDescriptors.names.length, 1);
    assert.match(await first.evaluate("window.__TAURI_INTERNALS__.invoke('proof_force_quit').then(() => 'allowed', error => String(error))"), /failed shutdown/);
    await alive(first); results.push("Native force command rejects healthy state");
    await first.click("Tăng cỡ chữ");
    await first.wait("document.querySelector('.font-controls')?.textContent.includes('14 px')");
    const ownedCore = await findCore(first);
    save("failure-injection.json", { action: "kill verified owned Zig core only", core: ownedCore });
    await killOwnedProcesses([ownedCore]);
    await first.wait("document.querySelector('.connection-state')?.textContent.includes('Đã ngắt kết nối')");
    await confirm(first, "Dừng và thoát SLTerm?");
    await first.evaluate("document.querySelector('dialog form').requestSubmit()");
    await first.wait("!document.querySelector('dialog') && document.querySelector('.error-banner[role=alert]')?.textContent.includes('chưa xác nhận đủ output') && document.querySelector('.error-banner').getBoundingClientRect().height > 0");
    await alive(first); results.push("Missing shutdown ACK keeps app open with visible error");
    await confirm(first, "Buộc dừng và thoát SLTerm?");
    assert(await first.evaluate("document.querySelector('dialog').textContent.includes('mất output cuối')"));
    await first.click("Hủy");
    await first.wait("!document.querySelector('dialog')");
    await alive(first); results.push("Cancel force confirmation keeps app open");
    await confirm(first, "Buộc dừng và thoát SLTerm?");
    await capture(first);
    // The confirmed native exit may close CDP before Runtime.evaluate replies.
    await first.evaluate("document.querySelector('dialog form').requestSubmit()").catch(() => {});
    await exited(first, 1); results.push("Explicit force confirmation exits with OS status 1 and no owned survivors");
    const reopened = await launch();
    await reopened.wait("document.querySelector('.font-controls')?.textContent.includes('14 px')");
    assert.deepEqual(await reopened.evaluate(descriptors), savedDescriptors, "Workspace descriptors must persist");
    assert.equal(await reopened.evaluate("document.querySelectorAll('.terminal-pane').length"), 0);
    assert(await reopened.evaluate("document.querySelector('.empty-state h2')?.textContent === 'Workspace đang trống' && document.querySelector('.footer-count')?.textContent.includes('0 đang chạy · 0 terminal')"));
    const reopenedCore = await findCore(reopened);
    const coreTree = await snapshotProcessTree(reopenedCore.pid);
    assert(coreTree.some((item) => item.pid === reopenedCore.pid && item.createdAt === reopenedCore.createdAt), "Core identity changed during reopen inspection");
    const filter = coreTree.map((item) => `ProcessId=${item.pid}`).join(" OR ");
    const coreDetails = await query(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter '${filter}' -Property ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{n='createdAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}})`);
    save("reopened-core-processes.json", { core: reopenedCore, identities: coreTree, details: coreDetails });
    assert.equal(coreDetails.length, coreTree.length, "Every core descendant must have a process classification");
    assert(coreDetails.every((item) => coreTree.some((owned) => owned.pid === item.ProcessId && owned.parentPid === item.ParentProcessId && owned.createdAt === item.createdAt)), "Core process identities changed during classification");
    // The hidden CUI core has a system console helper even without a ConPTY session.
    const consoleHost = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/conhost.exe").toLowerCase();
    assert(coreDetails.filter((item) => item.ProcessId !== reopenedCore.pid).every((item) => item.Name?.toLowerCase() === "conhost.exe" && item.ExecutablePath?.toLowerCase() === consoleHost), "Reopen must not restore shells or unexpected descendant processes");
    results.push("Same disposable profile restores 14 px and empty workspace descriptors without sessions");
    await confirm(reopened, "Dừng và thoát SLTerm?");
    await capture(reopened);
    await reopened.evaluate("document.querySelector('dialog form').requestSubmit()").catch(() => {});
    await exited(reopened, 0); results.push("Normal graceful shutdown exits with OS status 0 and no owned survivors");
}
async function cleanup(app) {
    app.cleanup = { forced: false, errors: [] };
    const attempt = async (action) => { try { await action(); } catch (error) { app.cleanup.errors.push(String(error)); } };
    await attempt(() => capture(app));
    if (!app.exit && app.client) await attempt(async () => {
        await app.evaluate("window.__TAURI_INTERNALS__.invoke('proof_quit')").catch(() => {});
        await waitFor(() => app.exit, "cleanup graceful exit", 15000);
    });
    // After root exit, a known surviving child can still own further descendants.
    await attempt(async () => {
        const live = await liveOwnedProcesses(app.owned);
        for (const identity of live.filter((item) => !live.some((parent) => parent.pid === item.parentPid))) await attempt(() => capture(app, identity));
    });
    await attempt(async () => {
        const survivors = await liveOwnedProcesses(app.owned);
        if (survivors.length) { app.cleanup.forced = true; await killOwnedProcesses(survivors.reverse()); }
        await waitForOwnedGone(app.owned);
        app.cleanup.survivors = [];
    });
    app.client?.close();
}
async function main() {
    assert.equal(process.platform, "win32", "Windows-only native regression");
    fs.mkdirSync(out, { recursive: true });
    let failure;
    try {
        const artifacts = [host, core, import.meta.filename, path.join(root, "scripts/terminal-proof/cdp-client.mjs"), path.join(root, "scripts/terminal-proof/fixtures/windows-process-tree.mjs")];
        save("artifacts.json", artifacts.map((file) => ({ file: path.relative(root, file), sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") })));
        await scenario();
    } catch (error) { failure = error; }
    finally {
        for (const app of apps) {
            await cleanup(app);
            if (app.cleanup.forced || app.cleanup.errors.length) failure ??= new Error(`Fallback cleanup required: ${JSON.stringify(app.cleanup)}`);
        }
        save("result.json", { ok: !failure, profile, port, root, results, error: failure ? String(failure.stack ?? failure) : null,
            launches: apps.map((app) => ({ pid: app.proc.pid, exit: app.exit, owned: app.owned, cleanup: app.cleanup })) });
    }
    console.log(out);
    if (failure) throw failure;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
