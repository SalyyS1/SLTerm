import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { newHostKey, startLoopbackServer } from './loopback-server.mjs';

const executable = fileURLToPath(new URL('../../proof-results/ssh-proof/zig-out/bin/slterm-ssh-proof.exe', import.meta.url));
const build = JSON.parse(await readFile(new URL('../../proof-results/ssh-proof/build-evidence.json', import.meta.url), 'utf8'));
assert.equal(createHash('sha256').update(await readFile(executable)).digest('hex'), build.executableSha256,
    'Executable must match the recorded pinned build');
const key = newHostKey();
const results = [];

async function run(mode, serverKey = key, expectedHash = key.sha256) {
    let child;
    let cancellationSent = false;
    const server = await startLoopbackServer(serverKey, () => {
        if (!cancellationSent) { cancellationSent = true; child.stdin.end('x'); }
    });
    const started = performance.now();
    try {
        child = spawn(executable, [], {
            env: { SystemRoot: process.env.SystemRoot, SSH_PROOF_MODE: mode, SSH_PROOF_HOST_SHA256: expectedHash },
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', (bytes) => { stdout += bytes; });
        child.stderr.on('data', (bytes) => { stderr += bytes; });
        const code = await new Promise((resolve, reject) => {
            const deadline = setTimeout(() => { child.kill(); reject(new Error(`SSH ${mode} exceeded 12 seconds`)); }, 12000);
            child.once('error', (error) => { clearTimeout(deadline); reject(error); });
            child.once('close', (value) => { clearTimeout(deadline); resolve(value); });
        });
        assert.equal(code, 0, `${mode}: ${stderr} ${JSON.stringify(server.events)}`);
        const checks = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
        assert.ok(checks.length > 0);
        assert.ok(checks.every((check) => check.ok === true));
        const auth = server.events.filter((event) => event.event === 'authentication');
        if (mode === 'changed-key' || mode === 'unknown-key') {
            assert.equal(auth.length, 0, 'Untrusted host must receive no authentication attempt');
            assert.deepEqual(checks.map((check) => check.check), ['untrusted-key-blocked-before-auth']);
        } else {
            assert.deepEqual(auth, [{ event: 'authentication', method: 'none', username: 'fixture' }]);
            assert.equal(checks[0].check, 'trusted-key-before-auth');
        }
        if (mode === 'trusted') assert.deepEqual(checks.map((check) => check.check), [
            'trusted-key-before-auth', 'unicode-read', 'unicode-list-and-symlink', 'permission-denied',
        ]);
        if (mode === 'cancel') {
            assert.ok(cancellationSent, 'Cancellation follows receipt of a pending SFTP READ');
            assert.ok(checks.some((check) => check.check === 'cancel-closes-transport'));
        }
        if (mode === 'disconnect') {
            assert.ok(server.events.some((event) => event.event === 'read' && event.path === '/disconnect'));
            assert.ok(checks.some((check) => check.check === 'disconnect-fails-within-deadline'));
        }
        results.push({ mode, elapsedMs: Math.round(performance.now() - started), checks, serverEvents: server.events });
    } catch (error) {
        results.push({ mode, failed: true, error: error.message, serverEvents: server.events });
        throw error;
    } finally {
        if (child && child.exitCode === null) child.kill();
        await server.close();
    }
    assert.ok(server.events.some((event) => event.event === 'closed'), 'Owned SSH connection closed');
}

test('pinned Zig/libssh2 accepts trusted host and exercises real SFTP fixtures', { timeout: 15000 }, () => run('trusted'));
test('changed host key blocks before authentication', { timeout: 15000 }, () => run('changed-key', newHostKey()));
test('unknown host key blocks before authentication', { timeout: 15000 }, () => run('unknown-key', key, ''));
test('cancellation closes transport after pending SFTP read', { timeout: 15000 }, () => run('cancel'));
test('peer disconnect fails pending SFTP read within deadline', { timeout: 15000 }, () => run('disconnect'));
test('WinCNG DH normalization holds across 32 fresh SSH/SFTP connections', { timeout: 30000 }, async () => {
    // Targets the observed randomized DH integer encoding failure. No retries:
    // every connection must pass or this regression check fails immediately.
    for (let iteration = 0; iteration < 32; iteration++) await run('trusted');
});

test.after(async () => {
    await writeFile(new URL('../../proof-results/ssh-proof/fixture-evidence.json', import.meta.url), JSON.stringify({
        evidenceKind: 'real SSH/SFTP wire integration against disposable in-memory loopback fixture',
        fixtureVersion: 'ssh2@1.17.0', build, failed: results.some((result) => result.failed), results,
    }, null, 2) + '\n');
});
