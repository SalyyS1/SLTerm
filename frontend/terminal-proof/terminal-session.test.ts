import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Frame, ProofTransport } from "./proof-protocol";
import { TerminalSession } from "./terminal-session";
import { TerminalRuntime } from "./terminal-runtime";

vi.mock("@xterm/xterm", () => ({
    Terminal: vi.fn(function (options: ITerminalOptions) {
        let onData = (_data: string) => {};
        const writes: { data: unknown; callback?: () => void }[] = [];
        return {
            get options() { return options; },
            set options(next: ITerminalOptions) { Object.assign(options, next); },
            cols: 80,
            rows: 24,
            writes,
            open: vi.fn(),
            loadAddon: vi.fn(),
            dispose: vi.fn(),
            writeln: vi.fn(),
            onData: vi.fn((callback: (data: string) => void) => {
                onData = callback;
            }),
            emitData: (data: string) => onData(data),
            write: vi.fn((data: unknown, callback?: () => void) => {
                writes.push({ data, callback });
            }),
            flush: () => {
                while (writes.length) writes.shift()!.callback?.();
            },
        };
    }),
}));
vi.mock("@xterm/addon-fit", () => ({
    FitAddon: class {
        fit = vi.fn();
    },
}));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
    WebglAddon: class {
        onContextLoss = vi.fn();
    },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./terminal-clipboard", () => ({ installTerminalClipboard: vi.fn(() => ({ dispose: vi.fn() })) }));

type MockTerminal = {
    options: ITerminalOptions;
    cols: number;
    rows: number;
    open: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    writes: { data: unknown; callback?: () => void }[];
    emitData(data: string): void;
    flush(): void;
};
function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((success, failure) => {
        resolve = success;
        reject = failure;
    });
    return { promise, resolve, reject };
}
const tick = async () => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
};
function setup(options: Partial<ITerminalOptions> = {}) {
    const spawn = deferred();
    const request = vi.fn(
        (method: string, _args?: Record<string, unknown>): Promise<void> =>
            method === "spawn" ? spawn.promise : Promise.resolve()
    );
    const changed = vi.fn();
    const fail = vi.fn();
    const session = new TerminalSession(
        7,
        "C:/work",
        { request } as unknown as ProofTransport,
        { executable: "pwsh.exe", cwd: "C:/work", pid: 1, args: ["-NoLogo"] },
        changed,
        fail,
        14,
        {},
        options
    );
    const terminal = vi.mocked(Terminal).mock.results.at(-1)!.value as MockTerminal;
    const host = { append: vi.fn() } as unknown as HTMLElement;
    return { session, terminal, host, spawn, request, changed, fail };
}
function exit(session: TerminalSession, lastSequence = 0) {
    session.receive({ event: "exit", session_id: 7, last_sequence: lastSequence, exit_code: 23 });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
        createElement: () => ({
            className: "",
            isConnected: true,
            clientWidth: 800,
            clientHeight: 400,
            remove: vi.fn(),
        }),
    });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("terminal session lifetime", () => {
    it("constructs with workspace appearance and transparency before opening the renderer", () => {
        const { terminal } = setup({ fontSize: 19, lineHeight: 1.4, cursorStyle: "bar", theme: { background: "#12345600" }, allowTransparency: false });
        expect(terminal.options).toMatchObject({ fontSize: 19, lineHeight: 1.4, cursorStyle: "bar", allowTransparency: true, theme: { background: "#12345600" } });
        expect(terminal.open).not.toHaveBeenCalled();
    });
    it("reattaches the same surface and process while flushing geometry changed during startup", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        terminal.cols = 120;
        terminal.rows = 40;
        session.resize();
        session.attach(host);
        expect(terminal.open).toHaveBeenCalledOnce();
        expect(request.mock.calls.filter(([method]) => method === "spawn")).toHaveLength(1);
        expect(host.append).toHaveBeenCalledWith(session.surface);
        spawn.resolve();
        await tick();
        expect(request).toHaveBeenCalledWith("resize", { session_id: 7, cols: 120, rows: 40 });
        expect(session.info.status).toBe("running");
    });

    it("deduplicates close during startup and cancels buffered typing", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        terminal.emitData("must not run\r");
        const closing = session.close();
        expect(session.close()).toBe(closing);
        expect(request.mock.calls.filter(([method]) => method === "stop")).toHaveLength(0);
        spawn.resolve();
        await tick();
        expect(request.mock.calls.filter(([method]) => method === "stop")).toHaveLength(1);
        expect(request.mock.calls.filter(([method]) => method === "input")).toHaveLength(0);
        exit(session);
        terminal.flush();
        await closing;
        session.dispose();
        expect(terminal.dispose).toHaveBeenCalledOnce();
    });

    it("reattaches an exited transcript without opening or spawning another terminal", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        session.receive({ event: "output", sequence: 1, data: btoa("retained transcript") });
        exit(session, 1);
        terminal.flush();
        const replacementHost = { append: vi.fn() } as unknown as HTMLElement;
        session.attach(replacementHost);
        expect(replacementHost.append).toHaveBeenCalledWith(session.surface);
        expect(terminal.open).toHaveBeenCalledOnce();
        expect(request.mock.calls.filter(([method]) => method === "spawn")).toHaveLength(1);
        expect(session.info).toEqual({ status: "exited", exitCode: 23 });
        session.dispose();
        const disposedHost = { append: vi.fn() } as unknown as HTMLElement;
        session.attach(disposedHost);
        expect(disposedHost.append).not.toHaveBeenCalled();
    });

    it("reattaches closing and retained failed-close surfaces without respawning", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        const stop = deferred();
        request.mockImplementationOnce(() => stop.promise);
        const result = expect(session.close()).rejects.toThrow("stop failed");
        await tick();
        const closingHost = { append: vi.fn() } as unknown as HTMLElement;
        session.attach(closingHost);
        expect(closingHost.append).toHaveBeenCalledWith(session.surface);
        stop.reject(new Error("stop failed"));
        await result;
        const retainedHost = { append: vi.fn() } as unknown as HTMLElement;
        session.attach(retainedHost);
        expect(retainedHost.append).toHaveBeenCalledWith(session.surface);
        expect(terminal.open).toHaveBeenCalledOnce();
        expect(request.mock.calls.filter(([method]) => method === "spawn")).toHaveLength(1);
    });

    it("consumes the final output and exit marker before confirming disposal", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        const closing = session.close();
        await tick();
        session.receive({ event: "output", sequence: 1, data: btoa("final output") });
        exit(session, 1);
        expect(session.finished).toBe(false);
        expect(() => session.dispose()).toThrow("unconfirmed");
        expect(terminal.writes[0].data).toEqual(new TextEncoder().encode("final output"));
        expect(terminal.writes[1].data).toContain("process exited: 23");
        terminal.writes.shift()!.callback?.();
        expect(request).toHaveBeenCalledWith("ack", { session_id: 7, sequence: 1 });
        expect(session.finished).toBe(false);
        terminal.flush();
        await closing;
        expect(session.info).toEqual({ status: "exited", exitCode: 23 });
        session.dispose();
        session.dispose();
        expect(terminal.dispose).toHaveBeenCalledOnce();
    });

    it("retains an unconfirmed process after stop failure and permits another close attempt", async () => {
        const { session, terminal, host, spawn, request, fail } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        request.mockImplementationOnce(() => Promise.reject(new Error("StopFailed")));
        await expect(session.close()).rejects.toThrow("StopFailed");
        expect(session.info.status).toBe("error");
        expect(session.finished).toBe(false);
        expect(() => session.dispose()).toThrow("unconfirmed");
        expect(fail).toHaveBeenCalled();
        const retry = session.close();
        await tick();
        exit(session);
        terminal.flush();
        await retry;
        expect(request.mock.calls.filter(([method]) => method === "stop")).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("times out close safely even when stop itself never settles", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        const stop = deferred();
        request.mockImplementationOnce(() => stop.promise);
        const result = expect(session.close()).rejects.toThrow("Giữ ô này");
        await vi.advanceTimersByTimeAsync(15000);
        await result;
        expect(session.finished).toBe(false);
        expect(session.info.status).toBe("error");
        // A late stop rejection is already handled and cannot leak an unhandled rejection.
        stop.reject(new Error("late timeout"));
        await tick();
        const retry = session.close();
        await tick();
        exit(session);
        terminal.flush();
        await retry;
    });

    it("rejects active close waiters immediately when disconnected", async () => {
        const { session, host, spawn } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        const result = expect(session.close()).rejects.toThrow("pipe gone");
        await tick();
        session.disconnected("pipe gone");
        await result;
        expect(vi.getTimerCount()).toBe(0);
        expect(session.finished).toBe(false);
        expect(() => session.dispose()).toThrow("unconfirmed");
        await expect(session.close()).rejects.toThrow("pipe gone");
        expect(session.info).toMatchObject({ status: "error", message: expect.stringContaining("pipe gone") });
    });

    it("reports an error when close starts after a disconnect", async () => {
        const { session, host, spawn } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        session.disconnected("transport unavailable");
        await expect(session.close()).rejects.toThrow("transport unavailable");
        expect(session.info).toMatchObject({
            status: "error",
            message: expect.stringContaining("transport unavailable"),
        });
        expect(session.finished).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("drains xterm writes before disposing a spawn that the core confirms never existed", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        spawn.reject(new Error("SpawnFailed"));
        await tick();
        request.mockImplementationOnce(() => Promise.reject(new Error("UnknownSession")));
        const closing = session.close();
        await tick();
        expect(session.finished).toBe(false);
        expect(() => session.dispose()).toThrow("unconfirmed");
        terminal.flush();
        await closing;
        expect(session.finished).toBe(true);
    });

    it("shows uncertain input delivery and never replays failed input", async () => {
        const { session, terminal, host, spawn, request, fail } = setup();
        session.attach(host);
        spawn.resolve();
        await tick();
        request.mockImplementationOnce(() => Promise.reject(new Error("input timed out")));
        terminal.emitData("hello\r");
        await tick();
        terminal.emitData("again\r");
        await tick();
        expect(session.info).toMatchObject({
            status: "error",
            message: expect.stringContaining("Input delivery is uncertain"),
        });
        expect(terminal.writeln).toHaveBeenCalledWith(expect.stringContaining("input delivery uncertain"));
        expect(request.mock.calls.filter(([method]) => method === "input")).toHaveLength(1);
        expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: "input timed out" }));
    });

    it("closes an unattached pane without spawning and ignores subsequent attachment", async () => {
        const { session, terminal, host, request } = setup();
        await session.close();
        session.attach(host);
        session.dispose();
        expect(session.finished).toBe(true);
        expect(request).not.toHaveBeenCalled();
        expect(terminal.open).not.toHaveBeenCalled();
    });

    it("does not restart input when an exit event arrives before the spawn response", async () => {
        const { session, terminal, host, spawn, request } = setup();
        session.attach(host);
        terminal.emitData("cancel this\r");
        exit(session);
        spawn.resolve();
        await tick();
        expect(request.mock.calls.filter(([method]) => method === "input")).toHaveLength(0);
        terminal.flush();
        expect(session.info).toEqual({ status: "exited", exitCode: 23 });
    });
});

describe("terminal runtime appearance", () => {
    it("updates only selected live identities in place and retains legacy font and theme controls", async () => {
        vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); });
        vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
        Object.assign(document, { body: { dataset: {} } });
        let receive!: (frame: { id: number; ok: boolean }) => void;
        vi.mocked(listen).mockImplementation(async (_event, callback) => {
            receive = (payload) => callback({ event: "proof-event", id: 0, payload } as Parameters<typeof callback>[0]);
            return () => {};
        });
        vi.mocked(invoke).mockImplementation(async (command, args) => {
            if (command === "proof_start") return { executable: "pwsh.exe", cwd: "C:/work", pid: 1, args: [] } as never;
            if (command === "proof_request") {
                const request = (args as { request: { id: number } }).request;
                receive({ id: request.id, ok: true });
            }
            return undefined as never;
        });
        const runtime = new TerminalRuntime();
        await runtime.start();
        runtime.prepare(1, "C:/one", { fontSize: 17, fontFamily: "One" });
        runtime.prepare(2, "C:/two", { fontSize: 21, fontFamily: "Two" });
        const [first, second] = vi.mocked(Terminal).mock.results.slice(-2).map((result) => result.value as MockTerminal);
        runtime.applyAppearance([1, 999], { fontSize: 23, theme: { foreground: "#aabbcc" } });
        expect(first.options).toMatchObject({ fontSize: 23, fontFamily: "One", theme: { foreground: "#aabbcc" } });
        expect(second.options).toMatchObject({ fontSize: 21, fontFamily: "Two" });
        expect(first.dispose).not.toHaveBeenCalled();
        expect(second.dispose).not.toHaveBeenCalled();
        expect(first.open).not.toHaveBeenCalled();
        expect(vi.mocked(invoke).mock.calls.filter(([command, args]) => command === "proof_request" && (args as { request: { method: string } }).request.method === "spawn")).toHaveLength(0);
        runtime.font(1);
        expect(first.options.fontSize).toBe(13);
        expect(second.options.fontSize).toBe(13);
        runtime.theme("light");
        expect(document.body.dataset.theme).toBe("light");
        expect(runtime.getSnapshot()).toMatchObject({ fontSize: 13, theme: "light" });
        await vi.advanceTimersByTimeAsync(60);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("terminal runtime shutdown recovery", () => {
    async function startRuntime() {
        vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); });
        let receive!: (frame: Frame) => void;
        vi.mocked(listen).mockImplementation(async (_event, callback) => {
            receive = (payload) => callback({ event: "proof-event", id: 0, payload } as Parameters<typeof callback>[0]);
            return () => {};
        });
        vi.mocked(invoke).mockImplementation(async (command, args) => {
            if (command === "proof_start") return { executable: "pwsh.exe", cwd: "C:/work", pid: 1, args: [] } as never;
            if (command === "proof_request") receive({ id: (args as { request: { id: number } }).request.id, ok: true });
            return undefined as never;
        });
        const runtime = new TerminalRuntime();
        await runtime.start();
        return { runtime, receive };
    }

    it("requires a failed shutdown before force quit and preserves a live retry after native failure", async () => {
        const { runtime, receive } = await startRuntime();
        await expect(runtime.forceQuit()).rejects.toThrow("Chưa có shutdown lỗi");
        expect(vi.mocked(invoke).mock.calls.some(([name]) => name === "proof_force_quit")).toBe(false);
        await runtime.quit();
        receive({ event: "shutdown_stalled", message: "Still draining" });
        vi.mocked(invoke).mockRejectedValueOnce(new Error("Native stop failed"));
        await expect(runtime.forceQuit()).rejects.toThrow("Native stop failed");
        expect(runtime.getSnapshot()).toMatchObject({ phase: "connected", shutdownIssue: "Still draining", error: "Error: Native stop failed" });
        await runtime.quit();
        expect(vi.mocked(invoke).mock.calls.at(-1)?.[0]).toBe("proof_quit");
    });

    it("keeps a crashed backend disconnected through shutdown failure and sends only the confirmed force action", async () => {
        const { runtime, receive } = await startRuntime();
        receive({ event: "transport_error", message: "Final output was not delivered" });
        await runtime.quit();
        receive({ event: "transport_closed" });
        receive({ event: "shutdown_stalled", message: "Missing shutdown acknowledgement" });
        expect(runtime.getSnapshot()).toMatchObject({ phase: "disconnected", shutdownIssue: "Missing shutdown acknowledgement" });
        await runtime.forceQuit();
        expect(vi.mocked(invoke).mock.calls.at(-1)?.[0]).toBe("proof_force_quit");
    });
});
