// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { reconcileHeldData, waveFileDataStartIdx, type HeldChunk } from "../term-replay";

function chunk(offset: number, ...bytes: number[]): HeldChunk {
    return { offset, data: new Uint8Array(bytes) };
}

function bytesOf(writes: Uint8Array[]): number[] {
    return writes.flatMap((w) => Array.from(w));
}

describe("reconcileHeldData", () => {
    it("skips output the read already covered", () => {
        // The read reached offset 100; both appends landed before that.
        const result = reconcileHeldData([chunk(80, 1, 2, 3), chunk(83, 4, 5)], 100);
        expect(result.ok).toBe(true);
        expect(result.writes).toEqual([]);
    });

    it("writes output that landed after the read", () => {
        const result = reconcileHeldData([chunk(100, 1, 2), chunk(102, 3)], 100);
        expect(result.ok).toBe(true);
        expect(bytesOf(result.writes)).toEqual([1, 2, 3]);
    });

    it("writes only the tail of an append the read half covered", () => {
        // The read stopped mid-append: bytes at 98 and 99 are already on screen.
        const result = reconcileHeldData([chunk(98, 1, 2, 3, 4)], 100);
        expect(result.ok).toBe(true);
        expect(bytesOf(result.writes)).toEqual([3, 4]);
    });

    it("keeps writing after a partially covered append", () => {
        const result = reconcileHeldData([chunk(98, 1, 2, 3), chunk(101, 4, 5)], 100);
        expect(result.ok).toBe(true);
        expect(bytesOf(result.writes)).toEqual([3, 4, 5]);
    });

    it("refuses when output is missing between the read and the stream", () => {
        // Nothing accounts for offsets 100..104, so writing chunk 105 would splice
        // two unrelated points of the byte stream together.
        const result = reconcileHeldData([chunk(105, 9)], 100);
        expect(result.ok).toBe(false);
        expect(result.writes).toEqual([]);
    });

    it("refuses a gap that only appears after an applicable append", () => {
        const result = reconcileHeldData([chunk(100, 1, 2), chunk(120, 3)], 100);
        expect(result.ok).toBe(false);
        expect(result.writes).toEqual([]);
    });

    it("accepts an empty buffer", () => {
        const result = reconcileHeldData([], 4096);
        expect(result.ok).toBe(true);
        expect(result.writes).toEqual([]);
    });

    it("handles the first append of a new file, at offset zero", () => {
        const result = reconcileHeldData([chunk(0, 27, 91, 63)], 0);
        expect(result.ok).toBe(true);
        expect(bytesOf(result.writes)).toEqual([27, 91, 63]);
    });
});

function waveFile(size: number, opts: FileOpts): WaveFile {
    return { zoneid: "z", name: "term", opts, createdts: 0, size, modts: 0, meta: {} };
}

describe("waveFileDataStartIdx", () => {
    it("starts at zero for a regular file", () => {
        expect(waveFileDataStartIdx(waveFile(9000, {}))).toBe(0);
    });

    it("starts at zero for a circular file that has not filled up", () => {
        expect(waveFileDataStartIdx(waveFile(900, { circular: true, maxsize: 1000 }))).toBe(0);
    });

    it("reports the retained window once a circular file has wrapped", () => {
        expect(waveFileDataStartIdx(waveFile(2500, { circular: true, maxsize: 1000 }))).toBe(1500);
    });

    it("ignores a maxsize on a non-circular file", () => {
        expect(waveFileDataStartIdx(waveFile(2500, { maxsize: 1000 }))).toBe(0);
    });
});
