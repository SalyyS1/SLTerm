// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CarryOverTtlMs,
    MaxCarryOverBytes,
    MaxCarryOverEntries,
    carriedTerminalCount,
    clearCarriedTerminals,
    parkCarriedTerminal,
    takeCarriedTerminal,
} from "../term-carry-over";

const size = { rows: 24, cols: 80 };

afterEach(() => {
    clearCarriedTerminals();
    vi.useRealTimers();
});

describe("terminal carry-over", () => {
    it("hands a parked screen to the next instance", () => {
        parkCarriedTerminal("b1", { snapshot: "hello", ptyOffset: 42, termSize: size });
        const carried = takeCarriedTerminal("b1");
        expect(carried?.snapshot).toBe("hello");
        expect(carried?.ptyOffset).toBe(42);
        expect(carried?.termSize).toEqual(size);
    });

    it("has nothing for a block that parked nothing", () => {
        expect(takeCarriedTerminal("b1")).toBeNull();
    });

    it("restores a screen once, so a later remount rereads the file", () => {
        parkCarriedTerminal("b1", { snapshot: "hello", ptyOffset: 42, termSize: size });
        expect(takeCarriedTerminal("b1")).not.toBeNull();
        expect(takeCarriedTerminal("b1")).toBeNull();
    });

    it("keeps the newest screen when a block parks twice", () => {
        parkCarriedTerminal("b1", { snapshot: "old", ptyOffset: 1, termSize: size });
        parkCarriedTerminal("b1", { snapshot: "new", ptyOffset: 2, termSize: size });
        expect(carriedTerminalCount()).toBe(1);
        expect(takeCarriedTerminal("b1")?.snapshot).toBe("new");
    });

    it("keeps blocks apart", () => {
        parkCarriedTerminal("b1", { snapshot: "one", ptyOffset: 1, termSize: size });
        parkCarriedTerminal("b2", { snapshot: "two", ptyOffset: 2, termSize: size });
        expect(takeCarriedTerminal("b2")?.snapshot).toBe("two");
        expect(takeCarriedTerminal("b1")?.snapshot).toBe("one");
    });

    it("drops a screen that has gone stale", () => {
        vi.useFakeTimers();
        parkCarriedTerminal("b1", { snapshot: "hello", ptyOffset: 42, termSize: size });
        vi.advanceTimersByTime(CarryOverTtlMs + 1);
        expect(takeCarriedTerminal("b1")).toBeNull();
        expect(carriedTerminalCount()).toBe(0);
    });

    it("still restores a screen parked within the window", () => {
        vi.useFakeTimers();
        parkCarriedTerminal("b1", { snapshot: "hello", ptyOffset: 42, termSize: size });
        vi.advanceTimersByTime(CarryOverTtlMs - 1);
        expect(takeCarriedTerminal("b1")).not.toBeNull();
    });

    it("refuses a snapshot too large to be worth holding", () => {
        const huge = "x".repeat(MaxCarryOverBytes + 1);
        expect(parkCarriedTerminal("b1", { snapshot: huge, ptyOffset: 1, termSize: size })).toBe(false);
        expect(takeCarriedTerminal("b1")).toBeNull();
    });

    it("bounds how many screens it holds, evicting the oldest", () => {
        vi.useFakeTimers();
        for (let i = 0; i < MaxCarryOverEntries; i++) {
            parkCarriedTerminal(`b${i}`, { snapshot: `s${i}`, ptyOffset: i, termSize: size });
            vi.advanceTimersByTime(1);
        }
        expect(carriedTerminalCount()).toBe(MaxCarryOverEntries);
        parkCarriedTerminal("newest", { snapshot: "newest", ptyOffset: 99, termSize: size });
        expect(carriedTerminalCount()).toBe(MaxCarryOverEntries);
        expect(takeCarriedTerminal("b0")).toBeNull();
        expect(takeCarriedTerminal("newest")?.snapshot).toBe("newest");
    });

    it("does not evict when replacing an existing block at the cap", () => {
        for (let i = 0; i < MaxCarryOverEntries; i++) {
            parkCarriedTerminal(`b${i}`, { snapshot: `s${i}`, ptyOffset: i, termSize: size });
        }
        parkCarriedTerminal("b0", { snapshot: "replaced", ptyOffset: 0, termSize: size });
        expect(carriedTerminalCount()).toBe(MaxCarryOverEntries);
        expect(takeCarriedTerminal("b0")?.snapshot).toBe("replaced");
    });

    it("carries an empty snapshot, which still advances the offset", () => {
        // A terminal with nothing on screen yet still knows where it is in the file.
        parkCarriedTerminal("b1", { snapshot: "", ptyOffset: 128, termSize: size });
        expect(takeCarriedTerminal("b1")?.ptyOffset).toBe(128);
    });
});
