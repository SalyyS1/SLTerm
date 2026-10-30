import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { connectCdp } from "../cdp-client.mjs";
import { snapshotProcessTree, liveOwnedProcesses, killOwnedProcesses, waitForOwnedGone } from "./windows-process-tree.mjs";

export const run = promisify(execFile);
export const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
export async function waitFor(check, label, timeout = 25000) {
    const deadline = Date.now() + timeout;
    do { const value = await check(); if (value) return value; await delay(100); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
}

export function createHarness({ root, out, profile, environment, port = 19232 }) {
    const host = path.join(root, "src-tauri/target/release/slterm.exe");
    const apps = [];
    const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
    const query = async (command) => {
        const { stdout } = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${command}`],
            { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
        return JSON.parse(stdout);
    };
    const freePort = async () => {
        const guard = net.createServer();
        await new Promise((resolve, reject) => { guard.once("error", reject); guard.listen({ port, host: "127.0.0.1", exclusive: true }, resolve); });
        await new Promise((resolve, reject) => guard.close((error) => error ? reject(error) : resolve()));
    };
    const capture = async (app, ancestor = app.identity) => {
        const tree = await snapshotProcessTree(ancestor?.pid ?? app.proc.pid);
        const identity = tree.find((item) => item.pid === (ancestor?.pid ?? app.proc.pid));
        if (!identity || ancestor && identity.createdAt !== ancestor.createdAt) return;
        assert(Date.parse(identity.createdAt) >= app.startedAt - 2000, "Root predates this owned launch");
        app.identity ??= identity;
        for (const item of tree) if (!app.owned.some((known) => known.pid === item.pid && known.createdAt === item.createdAt)) app.owned.push(item);
        save(`owner-${app.proc.pid}.json`, { pid: app.proc.pid, port, profile, command: host, root, owned: app.owned });
    };
    const launch = async () => {
        await freePort();
        const log = fs.openSync(path.join(out, `host-${apps.length + 1}.stderr.log`), "wx");
        const app = { startedAt: Date.now(), owned: [], exit: null };
        app.proc = spawn(host, [], { cwd: root, windowsHide: true, stdio: ["ignore", "ignore", log], env: {
            ...environment, SLTERM_PROOF_HIDDEN: "1", SLTERM_PROOF_PROFILE_DIR: profile,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        } });
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
            return listeners.length;
        }, "owned WebView CDP listener", 35000);
        app.client = await connectCdp(port, (target) => target.type === "page" && new URL(target.url).origin === "http://tauri.localhost", 30000);
        app.evaluate = app.client.evaluate;
        app.wait = (expression) => waitFor(() => app.evaluate(expression), expression);
        app.click = (label, scope = "document") => app.evaluate(`(() => {
            const b = [...${scope}.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(label)} || x.textContent.trim() === ${JSON.stringify(label)});
            if (!b || b.disabled) throw Error('Unavailable button: ' + ${JSON.stringify(label)}); b.scrollIntoView({ block: 'center' }); b.click();
        })()`);
        app.fill = (selector, value) => app.evaluate(`(() => {
            const field = document.querySelector(${JSON.stringify(selector)});
            if (!field || field.disabled) throw Error('Unavailable field: ' + ${JSON.stringify(selector)});
            const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(value)});
            field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await app.wait("document.querySelector('.connection-state')?.textContent.includes('connected')");
        await capture(app);
        return app;
    };
    const screenshot = async (app, name) => {
        const { data } = await app.client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(out, name), Buffer.from(data, "base64"));
    };
    const quit = async (app) => {
        await app.click("Dừng và thoát", "document.querySelector('.app-header')");
        await app.wait("document.querySelector('dialog h2')?.textContent === 'Dừng và thoát SLTerm?'");
        await capture(app);
        await app.evaluate("document.querySelector('dialog form').requestSubmit()").catch(() => {});
        await waitFor(() => app.exit, "native process exit", 20000);
        assert.deepEqual(app.exit, { code: 0, signal: null }, "Graceful native quit must succeed");
        await waitForOwnedGone(app.owned, 10000);
        app.client.close();
        await freePort();
        save(`exit-${app.proc.pid}.json`, { ...app.exit, owned: app.owned, survivors: [] });
    };
    const coreDetails = async (app) => {
        await capture(app);
        const details = await query(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${app.proc.pid} AND Name='slterm-core-proof.exe'" -Property ProcessId,ExecutablePath | Select-Object ProcessId,ExecutablePath)`);
        assert.equal(details.length, 1, "Exactly one owned Zig core is required");
        const core = app.owned.find((item) => item.pid === details[0].ProcessId && item.parentPid === app.proc.pid);
        assert(core, "Core must be a verified owned GUI descendant");
        assert.equal(details[0].ExecutablePath.toLowerCase(), path.join(root, "native-core/zig-out/bin/slterm-core-proof.exe").toLowerCase());
        const tree = await snapshotProcessTree(core.pid);
        assert(tree.some((item) => item.pid === core.pid && item.createdAt === core.createdAt), "Core identity changed");
        const filter = tree.map((item) => `ProcessId=${item.pid}`).join(" OR ");
        const processes = await query(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter '${filter}' -Property ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{n='createdAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}})`);
        assert.equal(processes.length, tree.length, "Every core descendant requires classification");
        assert(processes.every((item) => tree.some((owned) => owned.pid === item.ProcessId && owned.parentPid === item.ParentProcessId && owned.createdAt === item.createdAt)), "Classified process identity changed");
        return { core, tree, processes };
    };
    const cleanup = async (app) => {
        app.cleanup = { forced: false, errors: [] };
        const attempt = async (action) => { try { await action(); } catch (error) { app.cleanup.errors.push(String(error)); } };
        await attempt(() => capture(app));
        if (!app.exit && app.client) await attempt(async () => {
            await app.evaluate("window.__TAURI_INTERNALS__.invoke('proof_quit')").catch(() => {});
            await waitFor(() => app.exit, "cleanup graceful exit", 15000);
        });
        await attempt(async () => {
            const live = await liveOwnedProcesses(app.owned);
            for (const identity of live.filter((item) => !live.some((parent) => parent.pid === item.parentPid))) await attempt(() => capture(app, identity));
        });
        await attempt(async () => {
            const survivors = await liveOwnedProcesses(app.owned);
            if (survivors.length) { app.cleanup.forced = true; await killOwnedProcesses(survivors.reverse()); }
            await waitForOwnedGone(app.owned); app.cleanup.survivors = [];
        });
        app.client?.close();
    };
    return { host, apps, save, capture, launch, screenshot, quit, coreDetails, cleanup };
}
