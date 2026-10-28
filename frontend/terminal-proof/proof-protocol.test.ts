import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputOrder, ProofTransport, splitInput } from "./proof-protocol";

afterEach(() => vi.useRealTimers());

describe("proof transport", () => {
    it("settles responses once and rejects pending work on EOF", async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const transport = new ProofTransport(send);
        const first = transport.request("hello");
        const second = transport.request("spawn");
        const secondResult = expect(second).rejects.toThrow("Core exited");
        transport.receive({ id: 1, ok: true });
        transport.receive({ id: 1, ok: false });
        transport.close();
        await first;
        await secondResult;
        await expect(transport.request("hello")).rejects.toThrow("closed");
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("bounds pending requests and reports timeout as unknown completion", async () => {
        vi.useFakeTimers();
        const send = vi.fn().mockResolvedValue(undefined);
        const transport = new ProofTransport(send);
        const pending = Array.from({ length: 64 }, () => transport.request("input").catch((error: Error) => error));
        await expect(transport.request("input")).rejects.toThrow("not accepted");
        expect(send).toHaveBeenCalledTimes(64);
        await vi.advanceTimersByTimeAsync(15000);
        expect(
            (await Promise.all(pending)).every(
                (error) => error instanceof Error && error.message.includes("completion is unknown")
            )
        ).toBe(true);
    });

    it("reports a failed native write and preserves reserved request fields", async () => {
        const send = vi.fn().mockRejectedValue("pipe closed");
        const transport = new ProofTransport(send);
        await expect(transport.request("input", { id: 99, version: 2, method: "shutdown" })).rejects.toThrow(
            "pipe closed"
        );
        expect(send).toHaveBeenCalledWith({ version: 1, id: 1, method: "input" });
        expect(() => transport.receive({ id: 0, error_code: "MalformedRequest" })).toThrow("MalformedRequest");
    });
});

it("chunks multibyte input without corruption and rejects oversized paste", () => {
    const original = "a".repeat(4095) + "🙂Tiếng Việt 中文".repeat(800);
    const result = splitInput(original);
    expect(result.chunks.join("")).toBe(original);
    expect(result.chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 4096)).toBe(true);
    expect(() => splitInput("x".repeat(65537))).toThrow("not accepted");
    expect(() => splitInput("中".repeat(21846))).toThrow("not accepted");
    expect(splitInput("🙂".repeat(16384)).bytes).toBe(65536);
});

it("requires monotonic output before final exit and rejects late output", () => {
    const order = new OutputOrder();
    order.next(1);
    expect(() => order.next(3)).toThrow("Out-of-order");
    expect(() => order.finish(2)).toThrow("all output");
    order.next(2);
    order.finish(2);
    expect(() => order.next(3)).toThrow("Out-of-order");
    expect(() => order.finish(2)).toThrow("all output");
});
