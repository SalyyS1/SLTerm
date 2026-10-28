import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isAlive, killOwnedProcesses, snapshotProcessTree, waitForOwnedGone } from "./fixtures/windows-process-tree.mjs";

export { isAlive } from "./fixtures/windows-process-tree.mjs";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const coreExecutable = fileURLToPath(new URL("../../native-core/zig-out/bin/slterm-core-proof.exe", import.meta.url));

export async function waitForGone(pids, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (pids.some(isAlive) && Date.now() < deadline) await delay(25);
    const alive = pids.filter(isAlive);
    if (alive.length) throw new Error(`Owned fixture processes still alive: ${alive.join(", ")}`);
}

// Private stdio transport only: no sockets, existing terminal sessions, or user profiles.
export class CoreClient {
    constructor({ autoAck = true, onOutput, executable = coreExecutable } = {}) {
        this.autoAck = autoAck;
        this.onOutput = onOutput;
        this.frames = [];
        this.outputs = new Map();
        this.sequences = new Map();
        this.exitedSessions = new Set();
        this.spawnedSessions = new Set();
        this.pending = new Map();
        this.ownedPids = new Set();
        this.processIdentities = new Map();
        this.events = new EventEmitter();
        this.events.setMaxListeners(100);
        this.nextId = 1;
        this.stderr = "";
        this.partial = "";
        this.child = spawn(executable, [], { cwd: repoRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        this.closed = new Promise((resolve) => {
            this.child.once("close", (code, signal) => {
                this.exit = { code, signal };
                if (this.partial) this.fail(new Error("Core closed with an incomplete JSONL frame"));
                for (const pending of this.pending.values()) pending.reject(new Error(`Core closed (${code}, ${signal})`));
                this.pending.clear();
                this.events.emit("change");
                resolve(this.exit);
            });
        });
        this.child.on("error", (error) => this.fail(error));
        this.child.stdin.on("error", (error) => { if (!this.closing) this.fail(error); });
        this.child.stdout.setEncoding("utf8").on("data", (data) => this.receive(data));
        this.child.stderr.setEncoding("utf8").on("data", (data) => { this.stderr = (this.stderr + data).slice(-16000); });
    }

    fail(error) {
        this.failure ??= error;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        this.events.emit("change");
    }

    receive(data) {
        this.partial += data;
        let end;
        while ((end = this.partial.indexOf("\n")) >= 0) {
            const line = this.partial.slice(0, end);
            this.partial = this.partial.slice(end + 1);
            try {
                const frame = JSON.parse(line);
                if (frame.version !== 1) throw new Error(`Unexpected response version: ${frame.version}`);
                this.frames.push(frame);
                if (frame.event === "output") {
                    if (this.exitedSessions.has(frame.session_id)) throw new Error(`Output after session ${frame.session_id} exited`);
                    const expected = (this.sequences.get(frame.session_id) ?? 0) + 1;
                    if (frame.sequence !== expected) throw new Error(`Session ${frame.session_id}: expected sequence ${expected}, got ${frame.sequence}`);
                    this.sequences.set(frame.session_id, frame.sequence);
                    const bytes = Buffer.from(frame.data, "base64");
                    const chunks = this.outputs.get(frame.session_id) ?? [];
                    chunks.push(bytes);
                    this.outputs.set(frame.session_id, chunks);
                    // ACK only after the consumer callback has finished handling these bytes.
                    Promise.resolve().then(() => this.onOutput?.(frame, bytes, this)).then(async () => {
                        if (!this.autoAck || this.closing || this.exit) return;
                        const response = await this.request("ack", { session_id: frame.session_id, sequence: frame.sequence });
                        if (!response.ok) throw new Error(`Output ACK rejected: ${response.error_code}`);
                    }).catch((error) => { if (!this.closing) this.fail(error); });
                } else if (frame.event === "exit") {
                    if (this.exitedSessions.has(frame.session_id)) throw new Error(`Duplicate exit for session ${frame.session_id}`);
                    if (frame.last_sequence !== (this.sequences.get(frame.session_id) ?? 0)) throw new Error(`Exit sequence mismatch for session ${frame.session_id}`);
                    this.exitedSessions.add(frame.session_id);
                }
                this.pending.get(frame.id)?.resolve(frame);
                this.events.emit("change");
            } catch (error) { this.fail(new Error(`${error.message}; IPC frame=${JSON.stringify(line.slice(0,1024))}`, { cause: error })); }
        }
        if (this.partial.length > 128 * 1024) this.fail(new Error("Core emitted an oversized JSONL frame"));
    }

    request(method, fields = {}, timeoutMs = 15000) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(reject, new Error(`${method} request timed out; stderr=${this.stderr}`)), timeoutMs);
            const finish = (fn, value) => { clearTimeout(timer); this.pending.delete(id); fn(value); };
            this.pending.set(id, { resolve: (value) => {
                if (method === "spawn" && value.ok) this.spawnedSessions.add(fields.session_id);
                finish(resolve, value);
            }, reject: (error) => finish(reject, error) });
            if (this.failure || this.exit) return this.pending.get(id).reject(this.failure ?? new Error("Core already closed"));
            this.child.stdin.write(`${JSON.stringify({ version: 1, id, method, ...fields })}\n`, (error) => {
                if (error) this.pending.get(id)?.reject(error);
            });
        });
    }

    waitFor(predicate, description = "matching frame", timeoutMs = 15000) {
        return this.waitUntil(() => this.frames.find(predicate), description, timeoutMs);
    }

    waitUntil(read, description, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(reject, new Error(`Timed out: ${description}; stderr=${this.stderr}`)), timeoutMs);
            const finish = (fn, value) => { clearTimeout(timer); this.events.off("change", check); fn(value); };
            const check = () => {
                try {
                    const result = read();
                    if (this.failure) finish(reject, this.failure);
                    else if (result) finish(resolve, result);
                    else if (this.exit) finish(reject, new Error(`Core closed before ${description}`));
                } catch (error) { finish(reject, error); }
            };
            this.events.on("change", check);
            check();
        });
    }

    output(sessionId) { return Buffer.concat(this.outputs.get(sessionId) ?? []); }

    trackPid(pid) {
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) throw new Error(`Invalid fixture PID: ${pid}`);
        this.ownedPids.add(pid);
    }

    async captureProcessTree() {
        const identities = await snapshotProcessTree(this.child.pid);
        const root = identities.find((item) => item.pid === this.child.pid);
        if (!root && !this.exit) throw new Error("Could not identify the live core process");
        const previous = this.processIdentities.get(this.child.pid);
        if (root && previous && root.createdAt !== previous.createdAt) throw new Error("Core PID was reused");
        for (const identity of identities) this.processIdentities.set(identity.pid, identity);
        return identities;
    }

    async waitClosed(timeoutMs = 15000) {
        let timer;
        try {
            return await Promise.race([this.closed, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Core failed to close; PID ${this.child.pid}`)), timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    }

    endInput() { this.closing = true; this.child.stdin.end(); }

    async dispose() {
        let cleanupError;
        if (!this.exit) {
            const active = [...this.spawnedSessions].some((id) => !this.exitedSessions.has(id));
            if (active && !this.processIdentities.size) {
                try { await this.captureProcessTree(); }
                catch (error) { cleanupError = error; }
            }
            this.closing = true;
            try {
                if (!this.child.stdin.writableEnded && !this.child.stdin.destroyed) await this.request("shutdown", {}, 3000);
                await this.waitClosed(3000);
            } catch (error) {
                cleanupError = error;
                this.child.kill();
                await this.waitClosed(3000);
            }
        }
        const identities = [...this.processIdentities.values()];
        try {
            await waitForOwnedGone(identities, 3000);
            await waitForGone([...this.ownedPids].filter((pid) => !this.processIdentities.has(pid)), 3000);
        }
        catch (error) {
            cleanupError ??= error;
            await killOwnedProcesses(identities);
            await waitForOwnedGone(identities, 3000);
        }
        if (cleanupError) throw cleanupError;
        if (this.failure) throw this.failure;
    }
}
