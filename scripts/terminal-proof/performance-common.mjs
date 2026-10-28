import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

export const root = path.resolve(import.meta.dirname, '../..');
export const run = promisify(execFile);
export const save = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
let interruptionSignal;
export const setInterruptionSignal = signal => { interruptionSignal = signal; };
export async function waitFor(check, label, timeoutMs = 60000) {
    const deadline = performance.now() + timeoutMs;
    do { interruptionSignal?.throwIfAborted(); const value = await check(); if (value) return value; await delay(50); } while (performance.now() < deadline);
    throw new Error('Timed out waiting for ' + label);
}
export async function hashManifest(kind) {
    const { stdout: tracked } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    const sourceFiles = tracked.split('\0').filter((file) => file &&
        /^(frontend\/|emain\/|pkg\/|cmd\/|src-tauri\/src\/|native-core\/src\/|native-core\/build\.zig|scripts\/terminal-proof\/|package(?:-lock)?\.json|vite\.proof|src-tauri\/.*\.json)/.test(file));
    for (const name of fs.readdirSync(path.join(root, 'scripts/terminal-proof'))) {
        if (name.startsWith('performance-')) sourceFiles.push('scripts/terminal-proof/' + name);
    }
    const artifacts = kind === 'native' ? ['src-tauri/target/release/slterm.exe', 'native-core/zig-out/bin/slterm-core-proof.exe'] : [];
    if (kind === 'baseline') for (const directory of ['dist/main', 'dist/preload', 'dist/frontend', 'dist/bin']) {
        for (const name of fs.readdirSync(path.join(root, directory), { recursive: true })) {
            const file = path.join(directory, name);
            if (fs.statSync(path.join(root, file)).isFile()) artifacts.push(file.replaceAll('\\', '/'));
        }
    }
    const hashFiles = (files) => [...new Set(files)].sort().map((file) => ({ file,
        bytes: fs.statSync(path.join(root, file)).size,
        sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));
    const [head, status] = await Promise.all([
        run('git', ['rev-parse', 'HEAD'], { cwd: root }), run('git', ['status', '--porcelain'], { cwd: root })]);
    return { head: head.stdout.trim(), status: status.stdout.trim(), source: hashFiles(sourceFiles), artifacts: hashFiles(artifacts) };
}
export function parseArguments(args) {
    if (args.includes('--help')) return null;
    const options = { app: '', port: 0, width: 1100, height: 642, dpr: 1.5, hidden: false, out: '', temp: '' };
    const seen = new Set();
    for (let index = 0; index < args.length; index++) {
        const key = args[index].replace(/^--/, '');
        if (!args[index].startsWith('--') || !(key in options) || seen.has(key)) throw new Error('Invalid/repeated option ' + args[index]);
        seen.add(key);
        if (key === 'hidden') options[key] = true;
        else {
            if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing value ' + key);
            options[key] = ['port', 'width', 'height', 'dpr'].includes(key) ? Number(args[++index]) : args[++index];
        }
    }
    if (!['native', 'baseline'].includes(options.app)) throw new Error('--app native|baseline is required');
    options.port ||= options.app === 'native' ? 19231 : 19229;
    for (const key of ['port', 'width', 'height']) if (!Number.isInteger(options[key]) || options[key] <= 0) throw new Error('Invalid ' + key);
    if (options.port < 1024 || options.port > 65535 || options.width < 800 || options.width > 3840 || options.height < 600 || options.height > 2160 || !Number.isFinite(options.dpr) || options.dpr < 1 || options.dpr > 3) throw new Error('Measurement geometry/port outside bounded range');
    options.out = path.resolve(options.out || path.join(root, 'proof-results', 'performance-' + options.app + '-' + Date.now()));
    if (options.temp && !path.isAbsolute(options.temp)) throw new Error('--temp must be an explicit absolute new directory');
    return options;
}
