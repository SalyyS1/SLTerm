import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root, save, readJson, waitFor, run } from './performance-common.mjs';
import { snapshotProcessTree, waitForOwnedGone, killOwnedProcesses } from './fixtures/windows-process-tree.mjs';

export async function launchOwned(options) {
    const guard = net.createServer();
    await new Promise((resolve, reject) => { guard.once('error', reject); guard.listen(options.port, '127.0.0.1', resolve); });
    await new Promise(resolve => guard.close(resolve));
    fs.mkdirSync(options.out, { recursive: false });
    const profile = path.join(options.out, 'webview-profile');
    const native = options.app === 'native';
    const command = native ? path.join(root, 'src-tauri/target/release/slterm.exe') : process.execPath;
    const args = native ? [] : [path.join(root, 'scripts/terminal-proof/baseline-launch.cjs'), '--launch', '--verify-shell',
        '--seconds', '600', '--debug-port', String(options.port), '--terminals', '0', ...(options.hidden ? [] : ['--show'])];
    const env = native ? { ...process.env, SLTERM_PROOF_PROFILE_DIR: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.port} --remote-debugging-address=127.0.0.1 --disable-background-networking --proxy-server=127.0.0.1:9 --proxy-bypass-list=localhost;127.0.0.1;[::1]` } : { ...process.env };
    if (options.temp) {
        fs.mkdirSync(options.temp, { recursive: false });
        env.TEMP = options.temp; env.TMP = options.temp;
    }
    if (native) {
        // The host tests presence, so a visible run must omit even inherited '0'.
        if (options.hidden) env.SLTERM_PROOF_HIDDEN = '1';
        else delete env.SLTERM_PROOF_HIDDEN;
    }
    const stdoutFd = fs.openSync(path.join(options.out, 'launcher.stdout.log'), 'wx');
    const stderrFd = fs.openSync(path.join(options.out, 'launcher.stderr.log'), 'wx');
    const spawnRequestedAtMs = Date.now();
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', stderrFd] });
    let launchEvent, text = '', code, signal, spawnError;
    child.stdout.on('data', chunk => {
        fs.writeSync(stdoutFd, chunk);
        if (native) return;
        text += chunk.toString();
        if (text.length > 4 * 1024 * 1024) { spawnError = new Error('Baseline launch output exceeds bound'); child.stdout.pause(); return; }
        const lines = text.split('\n'); text = lines.pop();
        for (const line of lines) {
            let event; try { event = JSON.parse(line); } catch { continue; }
            if (event.event === 'started') launchEvent = event;
        }
    });
    const closed = new Promise(resolve => {
        child.once('error', error => { spawnError = error; resolve(); });
        child.once('close', (value, stopSignal) => { code = value; signal = stopSignal; resolve(); });
    });
    const ownership = { pid: child.pid, command, args, root, out: options.out, port: options.port,
        spawnRequestedAtMs, profile: native ? profile : null, tempDirectory: options.temp || null };
    save(options.out, 'owner.json', ownership);
    let identities = [];
    // Do not throw after spawning before returning the owned cleanup handle.
    // A transient inventory failure is retried by ready/stop and recorded.
    let inventoryError;
    try { identities = child.pid ? await snapshotProcessTree(child.pid) : []; }
    catch (error) { inventoryError = String(error); }
    async function snapshot() {
        const fresh = child.pid ? await snapshotProcessTree(child.pid) : [];
        identities = [...new Map([...identities, ...fresh].map(item => [item.pid + ':' + item.createdAt, item])).values()];
        save(options.out, 'owned-process-identities.json', identities);
        return identities;
    }
    async function ready() {
        if (native) { if (spawnError) throw spawnError; return { rootPid: child.pid, spawnRequestedAtMs, inventoryError }; }
        await waitFor(() => {
            if (spawnError) throw spawnError;
            if (code !== undefined) throw new Error('Baseline exited before launch event: ' + code);
            return launchEvent;
        }, 'owned Electron launch event', 30000);
        ownership.baseline = launchEvent;
        save(options.out, 'owner.json', ownership);
        const processReceipt = readJson(path.join(launchEvent.reportDir, 'process.json'));
        await snapshot();
        return { rootPid: launchEvent.pid, spawnRequestedAtMs: processReceipt.spawnRequestedAtMs,
            baselineProfile: launchEvent.profileRoot, baselineReport: launchEvent.reportDir };
    }
    async function stop(client) {
        const cleanup = { graceful: false, forced: false, errors: [] };
        try { await snapshot(); } catch (error) { cleanup.errors.push(String(error)); }
        try {
            if (code === undefined && !spawnError) {
                if (native && client) {
                    // A confirmed OS exit can close CDP before its invoke reply.
                    // Only exit code and identity cleanup below establish success.
                    try { await client.evaluate("window.__TAURI_INTERNALS__.invoke('proof_quit')"); }
                    catch (error) { cleanup.quitInvokeReplyError = String(error); }
                }
                else if (!native && launchEvent) await run(process.execPath, [path.join(root, 'scripts/terminal-proof/baseline-launch.cjs'),
                    '--stop-profile', launchEvent.profileRoot], { cwd: root, windowsHide: true, timeout: 10000 });
                else throw new Error('No verified graceful shutdown route');
            }
            await Promise.race([closed, delay(15000, undefined, { ref: false }).then(() => { throw new Error('Owned launcher shutdown timed out'); })]);
            await waitForOwnedGone(identities);
            cleanup.graceful = code === 0 && signal === null && !spawnError;
        } catch (error) {
            cleanup.errors.push(String(error)); cleanup.forced = true;
            await killOwnedProcesses(identities);
            await waitForOwnedGone(identities);
            await Promise.race([closed, delay(2000, undefined, { ref: false })]);
        } finally {
            client?.close(); child.stdout.destroy(); fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
            save(options.out, 'cleanup.json', { ...cleanup, code, signal, spawnError: spawnError?.message });
        }
        return cleanup;
    }
    return { ready, snapshot, stop, ownership };
}
