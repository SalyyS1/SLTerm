/* Run only when this harness has exclusive ownership of the native GUI/test port. */
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { connectCdp } from './cdp-client.mjs';
import { root, run, save, readJson, parseArguments, hashManifest, setInterruptionSignal } from './performance-common.mjs';
import { launchOwned } from './performance-launch.mjs';
import { installPerformanceRenderer } from './performance-renderer.mjs';
import { prepareAdapter } from './performance-adapter.mjs';
import { identifyShell, measureBurst, measureCommand, measureResize, verifyShellDimensions } from './performance-measurements.mjs';

async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (!options) {
        console.log('node scripts/terminal-proof/performance-run.mjs --app native|baseline [--port 19231|19229] [--out ABSOLUTE_NEW_DIR] [--temp ABSOLUTE_NEW_TEMP_DIR] [--width 1100 --height 642 --dpr 1.5] [--hidden]');
        return;
    }
    if (process.platform !== 'win32') throw new Error('Controlled ConPTY measurement is Windows-only');
    // Validate/hash every prerequisite before launching. This command never builds.
    const manifest = await hashManifest(options.app);
    const controller = new AbortController();
    const interrupted = signal => controller.abort(new Error('Measurement interrupted: ' + signal));
    const onInterrupt = () => interrupted('SIGINT'), onTerminate = () => interrupted('SIGTERM');
    process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
    setInterruptionSignal(controller.signal);
    const owned = await launchOwned(options);
    let client, adapter, failure, cleanup;
    const result = { schemaVersion: 1, app: options.app, options, status: 'running', thresholdsApproved: false,
        storage: { artifactVolume: path.parse(root).root, evidenceVolume: path.parse(options.out).root,
            requestedTemporaryVolume: path.parse(options.temp || os.tmpdir()).root },
        host: { platform: process.platform, release: os.release(), arch: os.arch(), logicalCpus: os.cpus().length,
            memoryBytes: os.totalmem(), node: process.version }, manifest,
        limits: [
            'Source/artifact hashes record existing files; this harness does not prove a source-to-build mapping or rebuild anything.',
            'Startup is a cold disposable-profile, warm OS-cache launch-to-observed-usable-shell upper bound, including CDP connection and probe admission.',
            'Device metrics apply after CDP connection; initial window geometry may differ. Startup geometry is separately recorded and cannot be assumed controlled.',
            'Latency includes measurement instrumentation; xterm render/RAF events do not prove physical display presentation.',
            'Known payload bytes exclude shell echo/prompt/ConPTY controls. Measured xterm bytes include them.',
            'Both disposable shells use a controlled short global prompt after safety verification; this replaces the baseline integration prompt wrapper for measured steady workloads.',
            'Ten shell count is controlled; pane geometry/topology is recorded and may differ. No ten-pane baseline equivalence is assumed.',
            'Tab phase adds one safe shell after ten-shell idle/burst/input/resize phases; eleven shells remain alive during tab switching.',
            'Idle is a fixed ten-sample warm observation, not proof of settled steady state. Providers/MCP/WSL are outside application ancestry.',
            'Network controls are proxy/browser policy, not an OS network sandbox. No provider or account requests are part of this workload.',
            'Artifact/profile/evidence storage volumes are recorded. Different volumes and warm OS cache prevent a storage-neutral startup comparison.'
        ] };
    save(options.out, 'measurement.json', result);
    try {
        controller.signal.throwIfAborted();
        const launch = await owned.ready(); result.launch = launch;
        client = await connectCdp(options.port, target => target.type === 'page' &&
            (options.app === 'native' ? target.url.startsWith('http://tauri.localhost') : target.url.startsWith('file:')), 30000);
        result.bootstrapViewport = await client.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState})');
        await client.send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height,
            deviceScaleFactor: options.dpr, mobile: false });
        await client.evaluate(`(${installPerformanceRenderer.toString()})(${JSON.stringify(options.app)})`);
        adapter = await prepareAdapter(client, options.app, options);
        const first = await adapter.waitCount(1);
        result.startup = await identifyShell(client, first[0].id, options.app, 'startup-shell-ready');
        result.startup.launchToReadyFrameMs = result.startup.timing.endEpochMs - launch.spawnRequestedAtMs;
        result.startup.clock = 'process spawn Date.now to renderer performance.timeOrigin+performance.now; epoch-clock resolution/skew applies';
        result.controlledViewport = await client.evaluate('window.__sltermPerformance.viewport()');
        assert.equal(result.controlledViewport.width, options.width); assert.equal(result.controlledViewport.height, options.height);
        assert.equal(result.controlledViewport.dpr, options.dpr);
        result.currentPhase = 'ten-shell-setup'; save(options.out, 'measurement.json', result);
        const setupStarted = performance.now();
        for (let index = 1; index < 10; index++) await adapter.createTerminal();
        const terminals = await adapter.waitCount(10);
        result.setup = { terminals, status: 'checking-identities' };
        result.shells = [];
        for (const terminal of terminals) result.shells.push(await identifyShell(client, terminal.id, options.app));
        assert.equal(new Set(result.shells.map(shell => shell.pid)).size, 10, 'Ten distinct real shell PIDs required');
        const identities = await owned.snapshot();
        for (const shell of result.shells) assert(identities.some(identity => identity.pid === shell.pid), 'Shell is not an owned descendant');
        result.setup = { elapsedMs: performance.now() - setupStarted, terminals,
            note: 'Nine additional terminals plus ten safety/PID receipts; never application startup latency' };
        save(options.out, 'measurement.json', result);
        result.idleBefore = await client.evaluate('({viewport:window.__sltermPerformance.viewport(),dimensions:window.__sltermPerformance.dimensions()})');
        await run('pwsh.exe', ['-NoProfile', '-File', path.join(root, 'scripts/terminal-proof/measure-process-tree.ps1'),
            '-RootProcessId', String(launch.rootPid), '-Samples', '10', '-IntervalMilliseconds', '1000',
            '-Label', `${options.app}; ten verified safe Windows PowerShell shells; controlled document metrics`,
            '-OutputPath', path.join(options.out, 'idle-resources.json')], { cwd: root, windowsHide: true, timeout: 55000, maxBuffer: 1024 * 1024, signal: controller.signal });
        result.idleAfter = await client.evaluate('({viewport:window.__sltermPerformance.viewport(),dimensions:window.__sltermPerformance.dimensions()})');
        assert.deepEqual(result.idleAfter, result.idleBefore, 'Geometry/visibility/focus changed during idle samples');
        const idle = readJson(path.join(options.out, 'idle-resources.json'));
        assert.equal(idle.samples.length, 10, 'Missing idle samples');
        for (const sample of idle.samples) {
            assert.equal(sample.missingPrivateWorkingSetPids.length, 0, 'Missing private working set counters');
            for (const shell of result.shells) assert(sample.processes.some(process => process.pid === shell.pid), 'A verified shell was absent during idle');
        }
        result.idleValidated = true;
        result.bursts = [];
        for (const terminal of terminals) result.bursts.push(await measureBurst(client, terminal.id));
        result.input = [];
        for (let index = 0; index < 5; index++) result.input.push(await measureCommand(client, terminals[0].id,
            'keyboard-response', "[Console]::Write(('I'+'NPUT'))", true));
        result.resize = await measureResize(client, { width: Math.min(options.width + 160, 4000), height: Math.min(options.height + 180, 2340), dpr: options.dpr });
        result.resize.shellDimensions = [];
        for (const terminal of terminals) result.resize.shellDimensions.push(await verifyShellDimensions(client, terminal.id));
        result.restore = await measureResize(client, { width: options.width, height: options.height, dpr: options.dpr });
        save(options.out, 'measurement.json', result);
        result.currentPhase = 'create-second-tab';
        const tab = await adapter.createTab();
        const second = (await adapter.discovered()).find(terminal => terminal.visible && !terminals.some(old => old.id === terminal.id));
        if (!second) throw new Error('Second tab has no distinct real terminal renderer');
        result.currentPhase = 'second-tab-shell';
        result.tabShell = await identifyShell(adapter.getClient(), second.id, options.app, 'second-tab-shell-ready');
        assert(!result.shells.some(shell => shell.pid === result.tabShell.pid), 'Second tab reused a shell PID');
        result.tabs = { ...tab, switches: [] };
        result.currentPhase = 'return-to-first-tab'; await adapter.switchTab(tab.initial);
        for (let index = 0; index < 6; index++) {
            result.currentPhase = 'tab-switch-' + (index + 1);
            result.tabs.switches.push(await adapter.switchTab(index % 2 === 0 ? tab.second : tab.initial));
        }
        const finalManifest = await hashManifest(options.app);
        assert.deepEqual(finalManifest.artifacts, manifest.artifacts, 'Artifact changed during measurement');
        result.sourceChangedDuringRun = JSON.stringify(finalManifest.source) !== JSON.stringify(manifest.source);
        result.status = 'measured'; result.currentPhase = 'complete';
    } catch (error) { failure = error; result.status = 'failed'; result.error = String(error.stack ?? error); result.failureDetails = error.measurementDetails; }
    finally {
        setInterruptionSignal(undefined);
        try { cleanup = await owned.stop(client); }
        catch (error) { failure ??= error; cleanup = { graceful: false, error: String(error) }; }
        adapter?.close();
        result.cleanup = cleanup;
        result.completedUtc = new Date().toISOString();
        result.measurementComplete = !failure && cleanup.graceful && !cleanup.forced && !cleanup.errors?.length;
        save(options.out, 'measurement.json', result);
        process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
    }
    console.log(JSON.stringify({ out: options.out, measurementComplete: result.measurementComplete, thresholdsApproved: false }));
    if (failure) throw failure;
    if (!result.measurementComplete) throw new Error('Measurement requires confirmed graceful cleanup');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
