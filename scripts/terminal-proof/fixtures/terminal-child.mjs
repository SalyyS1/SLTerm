import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const [mode = "interactive", ...args] = process.argv.slice(2);
const emit = (record) => process.stdout.write(`@proof:${JSON.stringify(record)}\n`);
const size = () => ({ cols: process.stdout.columns, rows: process.stdout.rows });
const ready = () => emit({ type: "ready", pid: process.pid, tty: Boolean(process.stdin.isTTY && process.stdout.isTTY), ...size() });

if (mode === "metadata") {
    emit({ type: "metadata", cwd: process.cwd(), argv: args, pid: process.pid, stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY) });
    process.stdout.write("@proof:final-output-before-exit\n", () => process.exit(37));
} else if (mode === "descendant") {
    const identity = { type: "descendant", pid: process.pid, parent: process.ppid, token: args[0] };
    if (process.send) process.send(identity);
    else emit(identity);
    setInterval(() => {}, 1000);
} else if (mode === "tree") {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    let input = "";
    process.stdin.on("data", (chunk) => {
        input += chunk;
        const end = input.indexOf("\r");
        if (end === -1) return;
        const command = JSON.parse(input.slice(0, end));
        if (command.op === "exit") process.exit(command.code ?? 0);
        throw new Error(`Unknown tree command: ${command.op}`);
    });
    ready();
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "descendant", args[0]], {
        // The grandchild is detached from this terminal, but must remain owned
        // by the core's job object even when its direct parent exits naturally.
        windowsHide: true, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    child.on("error", (error) => { emit({ type: "fixture-error", error: error.message }); process.exit(2); });
    child.on("message", (message) => emit(message));
    emit({ type: "spawned", pid: process.pid, child: child.pid });
    setInterval(() => {}, 1000);
} else if (mode === "flood") {
    ready();
    process.stdout.write("FLOOD".repeat(128 * 1024));
    setInterval(() => {}, 1000);
} else if (mode === "no-read") {
    process.stdin.setRawMode(true);
    process.stdin.pause();
    ready();
    setInterval(() => {}, 1000);
} else if (mode === "interactive") {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdout.on("resize", () => emit({ type: "resize", ...size() }));
    ready();
    let input = "";
    let commands = Promise.resolve();
    process.stdin.on("data", (chunk) => {
        input += chunk;
        let end;
        while ((end = input.indexOf("\r")) !== -1) {
            const line = input.slice(0, end);
            input = input.slice(end + 1);
            if (!line) continue;
            commands = commands.then(async () => {
                const command = JSON.parse(line);
                if (command.op === "echo") emit({ type: "echo", value: command.value });
                else if (command.op === "size") emit({ type: "size", ...size() });
                else if (command.op === "split") {
                    const bytes = Buffer.from(`@proof:split:${command.value}:end\n`);
                    // Deliberately split UTF-8 code points at child-write boundaries.
                    for (const byte of bytes) { process.stdout.write(Buffer.from([byte])); await delay(1); }
                    emit({ type: "split-done" });
                } else if (command.op === "exit") {
                    process.stdout.write("@proof:final-output-before-exit\n", () => process.exit(command.code ?? 0));
                } else throw new Error(`Unknown fixture command: ${command.op}`);
            }).catch((error) => { emit({ type: "fixture-error", error: error.message }); process.exit(2); });
        }
    });
} else {
    throw new Error(`Unknown fixture mode: ${mode}`);
}
