import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from './performance-common.mjs';
import { compareMeasurements } from './performance-compare.mjs';

test('performance CLI rejects malformed or repeated launch controls before launching', () => {
    for (const args of [[], ['--app', 'other'], ['--app', 'native', '--port', '1'],
        ['--app', 'native', '--dpr', 'NaN'], ['--app', 'native', '--width', '600'],
        ['--app', 'native', '--hidden', '--hidden'], ['--app', 'native', '--launch']]) {
        assert.throws(() => parseArguments(args));
    }
    const options = parseArguments(['--app', 'native', '--hidden']);
    assert.equal(options.hidden, true); assert.equal(options.port, 19231);
    assert.equal(options.width, 1100); assert.equal(options.height, 642); assert.equal(options.dpr, 1.5);
});

// These are control-shape fixtures only. They contain no measured latency/resource
// values and are never emitted as benchmark evidence.
function fixture(app) {
    return { app, measurementComplete: true, host: { platform: 'win32' }, options: { hidden: true },
        manifest: { source: ['performance-run.mjs', 'performance-common.mjs', 'performance-launch.mjs',
            'performance-renderer.mjs', 'performance-adapter.mjs', 'performance-measurements.mjs', 'performance-compare.mjs',
            'baseline-launch.cjs', 'baseline-output.cjs', 'cdp-client.mjs', 'measure-process-tree.ps1', 'fixtures/windows-process-tree.mjs']
            .map(file => ({ file: 'scripts/terminal-proof/' + file, sha256: 'a'.repeat(64) })) },
        storage: { artifactVolume: 'C:', evidenceVolume: 'C:', requestedTemporaryVolume: 'C:' },
        bootstrapViewport: { width: 1100, height: 642, dpr: 1.5, visibility: 'visible' },
        controlledViewport: { width: 1100, height: 642, dpr: 1.5, visibility: 'visible' },
        idleBefore: { viewport: { width: 1100, height: 642, dpr: 1.5, visibility: 'visible' } },
        idleAfter: { viewport: { width: 1100, height: 642, dpr: 1.5, visibility: 'visible' } },
        shells: Array.from({ length: 10 }, (_, pid) => ({ pid, safetyVerified: true,
            metadata: { shell: 'system-powershell', psVersion: '5.1', moduleVersion: '2.0', modulePath: 'machine-module' } })),
        setup: { terminals: Array.from({ length: 10 }, () => ({ cols: 20, rows: 10, width: 200, height: 200, visible: true })) },
        bursts: Array.from({ length: 10 }, () => ({ knownPayloadBytes: 4352, knownPayloadSha256: 'control-fixture-hash' })),
        status: 'measured', sourceChangedDuringRun: false, idleValidated: true };
}

test('comparison never approves thresholds or performance gate even when controls match', () => {
    const result = compareMeasurements(fixture('baseline'), fixture('native'));
    assert.equal(result.fullyComparable, true);
    assert.equal(result.thresholdsApproved, false); assert.equal(result.performanceGatePassed, false);
    assert.equal(result.native.startupObservedShellReadyMs, null);
});

test('geometry, completeness and any shell module mismatch invalidate comparison', () => {
    const old = fixture('baseline'), next = fixture('native');
    next.bootstrapViewport.width = 1000;
    next.shells[9].metadata.moduleVersion = 'different';
    next.setup.terminals[3].cols = 5;
    next.measurementComplete = false;
    next.storage.evidenceVolume = 'D:';
    const result = compareMeasurements(old, next);
    assert.equal(result.fullyComparable, false);
    for (const key of ['bothComplete', 'bootstrapViewport', 'sameShellAndModule', 'sameTenPaneGeometry', 'sameStorageVolumes']) assert.equal(result.controls[key], false);
});

test('missing requested shell or idle confirmation remains incomplete evidence', () => {
    const old = fixture('baseline'), next = fixture('native');
    next.shells.pop(); next.idleValidated = false;
    const result = compareMeasurements(old, next);
    assert.equal(result.controls.tenDistinctSafeShells, false);
    assert.equal(result.controls.tenShellsInEveryIdleSample, false);
});

test('individually stable runs still require identical shared instrumentation provenance', () => {
    const old = fixture('baseline'), next = fixture('native');
    next.manifest.source[0].sha256 = 'b'.repeat(64);
    let result = compareMeasurements(old, next);
    assert.equal(result.controls.sourceStable, true);
    assert.equal(result.controls.sharedInstrumentation, false); assert.equal(result.fullyComparable, false);
    next.manifest.source = old.manifest.source.slice(1);
    result = compareMeasurements(old, next);
    assert.equal(result.controls.sharedInstrumentation, false);
    delete next.manifest;
    assert.equal(compareMeasurements(old, next).controls.sharedInstrumentation, false);
});

test('Windows volume separators and drive-letter case do not create false mismatches', () => {
    const old = fixture('baseline'), next = fixture('native');
    old.storage = { artifactVolume: 'C:\\', evidenceVolume: 'D:\\', requestedTemporaryVolume: 'D:\\' };
    next.storage = { artifactVolume: 'c:/', evidenceVolume: 'd:/', requestedTemporaryVolume: 'd:/' };
    assert.equal(compareMeasurements(old, next).controls.sameStorageVolumes, true);
    next.storage.evidenceVolume = 'E:/';
    assert.equal(compareMeasurements(old, next).controls.sameStorageVolumes, false);
});
