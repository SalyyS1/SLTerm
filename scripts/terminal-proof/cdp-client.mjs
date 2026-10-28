import { setTimeout as delay } from "node:timers/promises";

/** Test-only local CDP client. Never enables debugging on the normal application. */
export async function connectCdp(port, matches, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let target;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
            target = (await response.json()).find(matches);
            if (target) break;
        } catch { /* Wait for the explicitly owned test process to start CDP. */ }
        await delay(100);
    }
    if (!target) throw new Error(`No matching local CDP target on port ${port}`);
    const url = new URL(target.webSocketDebuggerUrl);
    if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        throw new Error("Refusing non-local CDP endpoint");
    }
    const socket = new WebSocket(url);
    let serial = 0;
    const pending = new Map();
    const rejectPending = () => {
        for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("CDP disconnected")); }
        pending.clear();
    };
    socket.addEventListener("close", rejectPending);
    socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        const task = pending.get(message.id);
        if (!task) return;
        clearTimeout(task.timer); pending.delete(message.id);
        if (message.error) task.reject(new Error(message.error.message));
        else task.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error("CDP connection timed out")); }, 5000);
        socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed")); }, { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) { reject(new Error("CDP is closed")); return; }
        const id = ++serial;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    return { send, evaluate, close() { rejectPending(); socket.close(); } };
}
