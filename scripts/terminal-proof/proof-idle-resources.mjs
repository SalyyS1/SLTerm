/* Disposable Windows GUI/process diagnostic; not the complete performance gate. */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { connectCdp } from "./cdp-client.mjs";
import helpers from "./baseline-output.cjs";
import { snapshotProcessTree, waitForOwnedGone, killOwnedProcesses } from "./fixtures/windows-process-tree.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, "proof-results", `idle-proof-${Date.now()}`);
const port = 19231;
const run = promisify(execFile);
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));

async function waitFor(check, label, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    do { const value = await check(); if (value) return value; await delay(100); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
    if (process.platform !== "win32") throw new Error("Windows-only diagnostic");
    // Refuse a shared debugging endpoint before starting an owned application.
    const guard = net.createServer();
    await new Promise((resolve, reject) => { guard.once("error", reject); guard.listen(port, "127.0.0.1", resolve); });
    await new Promise((resolve) => guard.close(resolve));
    fs.mkdirSync(out, { recursive: true });
    const artifacts = ["src-tauri/target/release/slterm.exe", "native-core/zig-out/bin/slterm-core-proof.exe",
        "scripts/terminal-proof/proof-idle-resources.mjs", "scripts/terminal-proof/cdp-client.mjs", "scripts/terminal-proof/baseline-output.cjs"]
        .map((file) => ({ file, sha256: createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex") }));
    save("artifacts.json", artifacts);
    const log = fs.openSync(path.join(out, "host.stderr.log"), "wx");
    const child = spawn(path.join(root, "src-tauri/target/release/slterm.exe"), [], {
        cwd: root, windowsHide: true, stdio: ["ignore", "ignore", log],
        env: { ...process.env, SLTERM_PROOF_HIDDEN: "1", SLTERM_PROOF_PROFILE_DIR: path.join(out, "webview"),
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    });
    let client, owned = [], code, failed, graceful = false;
    const exited = once(child, "exit").then(([result]) => { code = result; });
    save("owner.json", { pid: child.pid, port, root, out, command: child.spawnfile });
    try {
        client = await connectCdp(port, (target) => target.type === "page" && target.url.startsWith("http://tauri.localhost"), 30000);
        const evaluate = client.evaluate;
        await waitFor(() => evaluate("document.querySelector('.connection-state')?.textContent.includes('connected') && document.querySelector('.pane-state')?.textContent === 'Đang chạy'"), "initial shell");
        await evaluate(`window.probeOutput = {}; window.probeOverflow = false;
            window.__TAURI_INTERNALS__.invoke('plugin:event|listen', { event:'proof-event', target:{kind:'Any'},
                handler:window.__TAURI_INTERNALS__.transformCallback(({payload:f}) => {
                    if (f.event !== 'output') return;
                    const next = (window.probeOutput[f.session_id] || '') + atob(f.data);
                    if (next.length > 1024*1024) window.probeOverflow = true;
                    else window.probeOutput[f.session_id] = next;
                }) });`);
        for (let i = 1; i < 10; i++) await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Terminal mới').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.terminal-pane').length === 10 && [...document.querySelectorAll('.pane-state')].every(x=>x.textContent==='Đang chạy')"), "ten running renderers");
        const ids = await evaluate("[...document.querySelectorAll('.terminal-pane')].map(p=>Number(p.dataset.paneId))");
        const shells = [];
        for (const id of ids) {
            const command = `$o=Get-PSReadLineOption; $h=Join-Path (Split-Path -Parent $env:USERPROFILE) 'history'; if ($o.HistorySaveStyle -eq 'SaveNothing' -and $o.HistorySavePath.StartsWith($h+[IO.Path]::DirectorySeparatorChar) -and [Console]::InputEncoding.CodePage -eq 65001 -and [Console]::OutputEncoding.CodePage -eq 65001 -and $OutputEncoding.CodePage -eq 65001) { Write-Output ('T'+'${id}:'+$PID+':E') } else { Write-Output ('PROBE_'+'SAFETY_FAILED') }\r`;
            await evaluate(`window.__TAURI_INTERNALS__.invoke('proof_request', {request:{version:1,id:${1000000 + id},method:'input',session_id:${id},data:${JSON.stringify(command)}}})`);
            const pid = await waitFor(async () => {
                const observed = await evaluate(`({output:window.probeOutput[${id}] || '', overflow:window.probeOverflow})`);
                assert.equal(observed.overflow, false, "Diagnostic output overflow");
                const output = helpers.compactPtyOutput(observed.output);
                if (output.includes("PROBE_SAFETY_FAILED")) throw new Error(`Shell ${id} safety check failed`);
                const match = output.match(new RegExp(`T${id}:(\\d+):E`));
                return match ? Number(match[1]) : false;
            }, `PTY identity ${id}`);
            shells.push({ id, pid, outputAndSafetyVerified: true });
        }
        assert.equal(new Set(shells.map((item) => item.pid)).size, 10);
        owned = await snapshotProcessTree(child.pid);
        for (const shell of shells) assert(owned.some((item) => item.pid === shell.pid), "Shell is not an owned descendant");
        const viewport = await evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState,xterms:document.querySelectorAll('.xterm').length})");
        save("workload.json", { status: "ready", shells, owned, viewport,
            notes: "Ten active shell renderers in a hidden window; warm idle only, no providers/MCP/WSL; not startup, burst, resize or input latency evidence." });
        await delay(2000);
        await run("pwsh.exe", ["-NoProfile", "-File", path.join(root, "scripts/terminal-proof/measure-process-tree.ps1"),
            "-RootProcessId", String(child.pid), "-Samples", "10", "-IntervalMilliseconds", "1000",
            "-Label", "Tauri Zig proof; 10 verified Windows PowerShell terminals; hidden window; warm idle diagnostic",
            "-OutputPath", path.join(out, "idle-resources.json")], { cwd: root, windowsHide: true, timeout: 55000, maxBuffer: 1024 * 1024 });
    } catch (error) { failed = error; }
    finally {
        owned = [...owned, ...(await snapshotProcessTree(child.pid))];
        if (client) await client.evaluate("window.__TAURI_INTERNALS__.invoke('proof_quit')").catch(() => {});
        try { await Promise.race([exited, delay(15000, undefined, { ref: false }).then(() => { throw new Error("Unconfirmed native shutdown"); })]);
            await waitForOwnedGone(owned); graceful = code === 0;
        } catch (error) { failed ??= error; await killOwnedProcesses(owned); await waitForOwnedGone(owned); }
        client?.close(); fs.closeSync(log);
        save("exit.json", { code, graceful, error: failed ? String(failed) : null, accepted: !failed && graceful });
    }
    if (failed) throw failed;
    if (!graceful) throw new Error("Native diagnostic did not exit cleanly");
    console.log(out);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
