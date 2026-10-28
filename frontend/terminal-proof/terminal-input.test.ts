import { describe, expect, it, vi } from "vitest";
import { TerminalInput } from "./terminal-input";
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("terminal input lifetime", () => {
    it("buffers early typing until spawn completes, preserving Unicode and order", async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const queue = new TerminalInput(send, vi.fn());
        queue.enqueue("Tiếng Việt"); queue.enqueue("\r");
        expect(send).not.toHaveBeenCalled();
        queue.resume(); await tick();
        expect(send.mock.calls.map(([data]) => data)).toEqual(["Tiếng Việt", "\r"]);
    });
    it("includes in-flight bytes in backpressure and does not retry failed delivery", async () => {
        let reject!: (error: Error) => void;
        const send = vi.fn(() => new Promise<void>((_, failure) => { reject = failure; }));
        const fail = vi.fn(); const queue = new TerminalInput(send, fail);
        queue.resume(); queue.enqueue("a".repeat(65536)); queue.enqueue("b");
        expect(fail).toHaveBeenCalledOnce();
        reject(new Error("completion unknown")); await tick();
        queue.enqueue("retry"); queue.resume(); await tick();
        expect(send).toHaveBeenCalledOnce(); expect(fail).toHaveBeenCalledTimes(2);
    });
    it("cancels buffered startup input and pending chunks on close", async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const queue = new TerminalInput(send, vi.fn());
        queue.enqueue("should not execute\r"); queue.stop(); queue.resume(); await tick();
        expect(send).not.toHaveBeenCalled();
    });
});
