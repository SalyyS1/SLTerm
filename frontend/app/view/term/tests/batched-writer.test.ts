// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { BatchedWriter } from "../term-batched-writer";

/** Collects what xterm would have been handed, without instantiating xterm. */
function fakeTerminal() {
    const writes: (string | Uint8Array)[] = [];
    const callbacks: (() => void)[] = [];
    return {
        writes,
        /** xterm's write is async; nothing is "parsed" until this is drained. */
        callbacks,
        drain: () => {
            const pending = callbacks.splice(0, callbacks.length);
            for (const cb of pending) {
                cb();
            }
        },
        terminal: {
            write: (data: string | Uint8Array, callback?: () => void) => {
                writes.push(data);
                if (callback != null) {
                    callbacks.push(callback);
                }
            },
        },
    };
}

function concatBytes(writes: (string | Uint8Array)[]): number[] {
    const out: number[] = [];
    for (const w of writes) {
        if (typeof w === "string") {
            throw new Error(`expected bytes, got the string ${JSON.stringify(w)}`);
        }
        out.push(...Array.from(w));
    }
    return out;
}

describe("BatchedWriter", () => {
    it("delivers a single chunk unchanged", () => {
        const { writes, terminal } = fakeTerminal();
        const writer = new BatchedWriter(terminal);
        const data = new Uint8Array([27, 91, 50, 74]);
        writer.write(data);
        writer.flush();
        expect(writes).toEqual([data]);
    });

    it("keeps bytes intact when a UTF-8 character straddles two chunks", () => {
        // "é" is 0xC3 0xA9. Decoding the batch chunk by chunk loses the split
        // character, and a dropped byte wedges xterm's parser.
        const { writes, terminal } = fakeTerminal();
        const writer = new BatchedWriter(terminal);
        writer.write(new Uint8Array([0x61, 0xc3]));
        writer.write(new Uint8Array([0xa9, 0x62]));
        writer.flush();
        expect(concatBytes(writes)).toEqual([0x61, 0xc3, 0xa9, 0x62]);
    });

    it("keeps bytes intact when a UTF-8 character straddles two flushes", () => {
        // The byte stream is split so "é" (0xC3 0xA9) spans a flush boundary.
        // Decoding per flush cannot carry the half character across, so the
        // trailing byte is dropped and the leading one arrives as U+FFFD — and
        // one lost byte is enough to wedge xterm's escape parser.
        const { writes, terminal } = fakeTerminal();
        const writer = new BatchedWriter(terminal);
        writer.write(new Uint8Array([0x61, 0xc3]));
        writer.flush();
        writer.write(new Uint8Array([0xa9, 0x62]));
        writer.flush();
        expect(concatBytes(writes)).toEqual([0x61, 0xc3, 0xa9, 0x62]);
    });

    it("keeps bytes intact when an escape sequence straddles two chunks", () => {
        const { writes, terminal } = fakeTerminal();
        const writer = new BatchedWriter(terminal);
        writer.write(new Uint8Array([0x1b, 0x5b]));
        writer.write(new Uint8Array([0x32, 0x4a]));
        writer.flush();
        expect(concatBytes(writes)).toEqual([0x1b, 0x5b, 0x32, 0x4a]);
    });

    it("coalesces a batch of byte chunks into one write", () => {
        const { writes, terminal } = fakeTerminal();
        const writer = new BatchedWriter(terminal);
        writer.write(new Uint8Array([1]));
        writer.write(new Uint8Array([2]));
        writer.write(new Uint8Array([3]));
        writer.flush();
        expect(writes).toHaveLength(1);
        expect(concatBytes(writes)).toEqual([1, 2, 3]);
    });

    it("preserves order when strings and bytes are interleaved", () => {
        const { writes, terminal } = fakeTerminal();
        const writer = new BatchedWriter(terminal);
        writer.write(new Uint8Array([1]));
        writer.write("middle");
        writer.write(new Uint8Array([2]));
        writer.flush();
        expect(writes).toHaveLength(3);
        expect(Array.from(writes[0] as Uint8Array)).toEqual([1]);
        expect(writes[1]).toBe("middle");
        expect(Array.from(writes[2] as Uint8Array)).toEqual([2]);
    });

    it("flushes on the frame timer without an explicit flush", () => {
        vi.useFakeTimers();
        try {
            const { writes, terminal } = fakeTerminal();
            const writer = new BatchedWriter(terminal);
            writer.write(new Uint8Array([7]));
            expect(writes).toHaveLength(0);
            vi.advanceTimersByTime(20);
            expect(concatBytes(writes)).toEqual([7]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("flushes once the batch is full, without waiting for the timer", () => {
        vi.useFakeTimers();
        try {
            const { writes, terminal } = fakeTerminal();
            const writer = new BatchedWriter(terminal);
            for (let i = 0; i < 100; i++) {
                writer.write(new Uint8Array([i]));
            }
            expect(writes).toHaveLength(1);
            expect(concatBytes(writes)).toHaveLength(100);
        } finally {
            vi.useRealTimers();
        }
    });

    it("writes what is buffered when disposed", () => {
        const { writes, terminal } = fakeTerminal();
        const writer = new BatchedWriter(terminal);
        writer.write(new Uint8Array([42]));
        writer.dispose();
        expect(concatBytes(writes)).toEqual([42]);
    });

    describe("parse reporting", () => {
        it("reports nothing until xterm has finished parsing", () => {
            const { terminal, drain } = fakeTerminal();
            const parsed: number[] = [];
            const writer = new BatchedWriter(terminal, (n) => parsed.push(n));
            writer.write(new Uint8Array([1]));
            writer.flush();
            // Handed over, not yet parsed — the distinction a snapshot depends on.
            expect(parsed).toEqual([]);
            drain();
            expect(parsed).toEqual([1]);
        });

        it("reports the chunk count it was given, not the write count", () => {
            const { writes, terminal, drain } = fakeTerminal();
            const parsed: number[] = [];
            const writer = new BatchedWriter(terminal, (n) => parsed.push(n));
            writer.write(new Uint8Array([1]));
            writer.write(new Uint8Array([2]));
            writer.write(new Uint8Array([3]));
            writer.flush();
            drain();
            // Three chunks coalesced into one write; the caller tracks chunks.
            expect(writes).toHaveLength(1);
            expect(parsed).toEqual([3]);
        });

        it("counts interleaved strings and bytes as separate chunks", () => {
            const { terminal, drain } = fakeTerminal();
            const parsed: number[] = [];
            const writer = new BatchedWriter(terminal, (n) => parsed.push(n));
            writer.write(new Uint8Array([1]));
            writer.write("text");
            writer.write(new Uint8Array([2]));
            writer.flush();
            drain();
            expect(parsed).toEqual([3]);
        });

        it("reports once per flush", () => {
            const { terminal, drain } = fakeTerminal();
            const parsed: number[] = [];
            const writer = new BatchedWriter(terminal, (n) => parsed.push(n));
            writer.write(new Uint8Array([1]));
            writer.flush();
            writer.write(new Uint8Array([2]));
            writer.write(new Uint8Array([3]));
            writer.flush();
            drain();
            expect(parsed).toEqual([1, 2]);
        });

        it("says nothing when a flush had nothing to write", () => {
            const { terminal, drain } = fakeTerminal();
            const parsed: number[] = [];
            const writer = new BatchedWriter(terminal, (n) => parsed.push(n));
            writer.flush();
            drain();
            expect(parsed).toEqual([]);
        });

        it("still delivers bytes when no reporter is attached", () => {
            const { writes, terminal } = fakeTerminal();
            const writer = new BatchedWriter(terminal);
            writer.write(new Uint8Array([7]));
            writer.flush();
            expect(concatBytes(writes)).toEqual([7]);
        });
    });
});
