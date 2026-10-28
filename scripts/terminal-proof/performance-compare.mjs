/* No thresholds are embedded: comparison reports evidence and its controls. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson } from './performance-common.mjs';

const median = values => {
    const items = values.filter(Number.isFinite).sort((a, b) => a - b);
    const mid = Math.floor(items.length / 2);
    return items.length ? items.length % 2 ? items[mid] : (items[mid - 1] + items[mid]) / 2 : null;
};
const geometry = viewport => viewport && ({ width: viewport.width, height: viewport.height, dpr: viewport.dpr, visibility: viewport.visibility, focused: viewport.focused });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const topology = dimensions => dimensions.map(({ cols, rows, width, height, visible }) => ({ cols, rows, width, height, visible }));
const shellPolicy = shell => shell && ({ shell: shell.metadata?.shell, psVersion: shell.metadata?.psVersion,
    moduleVersion: shell.metadata?.moduleVersion, modulePath: shell.metadata?.modulePath });
function storageVolumes(storage) {
    const keys = ['artifactVolume', 'evidenceVolume', 'requestedTemporaryVolume'];
    if (!storage || !keys.every(key => typeof storage[key] === 'string' && storage[key])) return null;
    return Object.fromEntries(keys.map(key => [key, storage[key].replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()]));
}
const requiredInstrumentation = ['performance-run.mjs', 'performance-common.mjs', 'performance-launch.mjs',
    'performance-renderer.mjs', 'performance-adapter.mjs', 'performance-measurements.mjs', 'performance-compare.mjs',
    'baseline-launch.cjs', 'baseline-output.cjs', 'cdp-client.mjs', 'measure-process-tree.ps1', 'fixtures/windows-process-tree.mjs'];
function instrumentationManifest(item) {
    const source = item.manifest?.source;
    if (!Array.isArray(source)) return null;
    const selected = source.filter(entry => /^scripts\/terminal-proof\/(performance-[^/]+\.mjs|baseline-launch\.cjs|baseline-output\.cjs|cdp-client\.mjs|measure-process-tree\.ps1|fixtures\/windows-process-tree\.mjs)$/.test(entry.file));
    if (!requiredInstrumentation.every(file => selected.some(entry => entry.file === 'scripts/terminal-proof/' + file && /^[a-f0-9]{64}$/i.test(entry.sha256)))) return null;
    return selected.map(({ file, sha256 }) => ({ file, sha256: sha256.toLowerCase() })).sort((a, b) => a.file.localeCompare(b.file));
}

export function compareMeasurements(baseline, native, baselineIdle, nativeIdle) {
    if (baseline.app !== 'baseline' || native.app !== 'native') throw new Error('Expected baseline then native measurement');
    const controls = {
        bothComplete: baseline.measurementComplete === true && native.measurementComplete === true,
        sameHost: same(baseline.host, native.host),
        sameStorageVolumes: Boolean(storageVolumes(baseline.storage) && storageVolumes(native.storage)) && same(storageVolumes(baseline.storage), storageVolumes(native.storage)),
        sameWindowVisibilityRequest: baseline.options.hidden === native.options.hidden,
        bootstrapViewport: same(geometry(baseline.bootstrapViewport), geometry(native.bootstrapViewport)),
        controlledViewport: same(geometry(baseline.controlledViewport), geometry(native.controlledViewport)),
        idleViewport: same(geometry(baseline.idleBefore?.viewport), geometry(native.idleBefore?.viewport)) &&
            same(geometry(baseline.idleAfter?.viewport), geometry(native.idleAfter?.viewport)),
        tenShellsInEveryIdleSample: baseline.idleValidated === true && native.idleValidated === true,
        tenDistinctSafeShells: [baseline, native].every(item => item.shells?.length === 10 &&
            new Set(item.shells.map(shell => shell.pid)).size === 10 && item.shells.every(shell => shell.safetyVerified)),
        sameShellAndModule: [baseline, native].every(item => item.shells?.length === 10 &&
            item.shells.every(shell => same(shellPolicy(shell), shellPolicy(baseline.shells[0])))),
        sameTenPaneGeometry: Boolean(baseline.setup && native.setup) && same(topology(baseline.setup.terminals), topology(native.setup.terminals)),
        artifactsStable: [baseline, native].every(item => item.status === 'measured'),
        sourceStable: [baseline, native].every(item => item.sourceChangedDuringRun === false),
        sharedInstrumentation: Boolean(instrumentationManifest(baseline) && instrumentationManifest(native)) &&
            same(instrumentationManifest(baseline), instrumentationManifest(native)),
        sameBurstPayload: Boolean(baseline.bursts?.length === 10 && native.bursts?.length === 10) &&
            same(baseline.bursts.map(item => [item.knownPayloadBytes, item.knownPayloadSha256]), native.bursts.map(item => [item.knownPayloadBytes, item.knownPayloadSha256])),
    };
    function summarize(item, idle) {
        const samples = idle?.samples ?? [];
        return { measurementComplete: item.measurementComplete === true, idleAccepted: item.idleValidated === true,
            startupObservedShellReadyMs: item.startup?.launchToReadyFrameMs ?? null,
            observedSamples: { bursts: item.bursts?.length ?? 0, keyboard: item.input?.length ?? 0, tabSwitches: item.tabs?.switches?.length ?? 0 },
            workloadSetupMs: item.setup?.elapsedMs ?? null,
            idleMedian: Object.fromEntries(['privateWorkingSetBytes', 'privateCommitBytes', 'workingSetSumBytes', 'cpuMachinePercent']
                .map(key => [key, median(samples.map(sample => sample.totals[key]))])),
            burstRenderMedianMs: median(item.bursts?.map(value => value.frameMs) ?? []),
            keyboardResponseMedianMs: median(item.input?.map(value => value.frameMs) ?? []),
            resizeStableDimensionsMs: item.resize?.stable?.elapsedMs ?? null,
            tabDomFrameMedianMs: item.tabs?.switches?.length === 6 ? median(item.tabs.switches.map(value => value.elapsedMs)) : null,
            partialTabFrameMs: item.tabs?.switches?.length === 6 ? [] : (item.tabs?.switches?.map(value => value.elapsedMs) ?? []) };
    }
    return { schemaVersion: 1, thresholdsApproved: false, performanceGatePassed: false,
        controls, fullyComparable: Object.values(controls).every(Boolean),
        baseline: summarize(baseline, baselineIdle), native: summarize(native, nativeIdle),
        limits: [...new Set([...(baseline.limits ?? []), ...(native.limits ?? [])])],
        interpretation: 'Raw observations; failed controls prohibit a like-for-like improvement claim. No thresholds or milestone approval.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const [baselineDir, nativeDir] = process.argv.slice(2);
    if (!baselineDir || !nativeDir) throw new Error('Usage: node scripts/terminal-proof/performance-compare.mjs BASELINE_RESULT_DIR NATIVE_RESULT_DIR');
    const optionalIdle = directory => { try { return readJson(path.join(directory, 'idle-resources.json')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
    const result = compareMeasurements(readJson(path.join(baselineDir, 'measurement.json')), readJson(path.join(nativeDir, 'measurement.json')),
        optionalIdle(baselineDir), optionalIdle(nativeDir));
    console.log(JSON.stringify(result, null, 2));
    if (!result.controls.bothComplete) process.exitCode = 1;
}
