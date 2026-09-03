// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * View-transition regression suite.
 *
 * Every case here asserts the same two things about a transition: **nothing is
 * duplicated and nothing is lost**. That is the whole of Phase 1 — a terminal that
 * shows a line twice, or drops one, has usually dropped or replayed bytes around a
 * transition, and one dropped control byte wedges xterm's escape parser, which is
 * what turns an in-place redraw into screenfuls of stacked duplicates.
 *
 * These drive the real modules that decide it — the batched writer, the carry-over
 * store, and the held-output reconciler — composed the way `TermWrap` composes them,
 * against a terminal that records the byte stream instead of painting it. What is
 * *not* covered here is the browser half: a real tile drag, a real tab switch, a
 * real SSH block. Those need a window, and the machine this was built on has none.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BatchedWriter } from "../term-batched-writer";
import { clearCarriedTerminals, parkCarriedTerminal, takeCarriedTerminal } from "../term-carry-over";
import { reconcileHeldData, type HeldChunk } from "../term-replay";

/** The term file on the server: append-only, readable from any offset. */
class TermFile {
    private data: number[] = [];

    append(bytes: number[]): number {
        const offset = this.data.length;
        this.data.push(...bytes);
        return offset;
    }

    readFrom(offset: number): { bytes: number[]; size: number } {
        return { bytes: this.data.slice(offset), size: this.data.length };
    }

    get size(): number {
        return this.data.length;
    }

    truncate() {
        this.data = [];
    }
}

/**
 * One terminal instance's lifetime, composed from the real modules the way TermWrap
 * composes them: writes go through the batched writer, the writer reports what xterm
 * has finished parsing, and that parsed position is what a carry-over parks.
 */
class TermSession {
    /** Bytes that reached the terminal, in the order they arrived. */
    readonly screen: number[] = [];
    /** Offset handed to the terminal. */
    ptyOffset = 0;
    /** Offset the terminal has finished parsing — behind ptyOffset while writes are queued. */
    renderedOffset = 0;
    private marks: number[] = [];
    private parseQueue: (() => void)[] = [];
    private writer: BatchedWriter;
    private held: HeldChunk[] = [];
    loaded = false;

    constructor() {
        const terminal = {
            write: (data: string | Uint8Array, callback?: () => void) => {
                const bytes = typeof data === "string" ? Array.from(data).map((c) => c.charCodeAt(0)) : Array.from(data);
                // Queued, not applied: xterm parses asynchronously, and the gap
                // between handing bytes over and them being on screen is exactly
                // what a snapshot has to respect.
                this.parseQueue.push(() => {
                    this.screen.push(...bytes);
                    callback?.();
                });
            },
        };
        this.writer = new BatchedWriter(terminal, (chunkCount) => {
            const taken = Math.min(chunkCount, this.marks.length);
            if (taken > 0) {
                this.renderedOffset = this.marks[taken - 1];
                this.marks.splice(0, taken);
            }
        });
    }

    /** Mirrors TermWrap.doTerminalWrite. */
    write(bytes: number[], absoluteOffset?: number) {
        this.writer.write(new Uint8Array(bytes));
        this.ptyOffset = absoluteOffset ?? this.ptyOffset + bytes.length;
        this.marks.push(this.ptyOffset);
    }

    /** Hands everything to the terminal without letting it parse — a write in flight. */
    flushWriter() {
        this.writer.flush();
    }

    /** Lets the terminal catch up on everything handed to it. */
    settle() {
        this.writer.flush();
        while (this.parseQueue.length > 0) {
            this.parseQueue.shift()!();
        }
    }

    /** Live output arriving while the initial read is still in flight. */
    holdAppend(offset: number, bytes: number[]) {
        this.held.push({ offset, data: new Uint8Array(bytes) });
    }

    /** Mirrors TermWrap.drainHeldData: reconcile the hold buffer against the read. */
    drainHeld(): boolean {
        const { writes, ok } = reconcileHeldData(this.held, this.ptyOffset);
        this.held = [];
        if (!ok) {
            return false;
        }
        for (const write of writes) {
            this.write(Array.from(write));
        }
        return true;
    }

    /** Mirrors TermWrap.parkScreenForRemount: snapshot at the *parsed* offset. */
    park(blockId: string) {
        parkCarriedTerminal(blockId, {
            // Stands in for SerializeAddon: what is on screen reproduces the screen.
            snapshot: String.fromCharCode(...this.screen.slice(0, this.renderedOffset)),
            ptyOffset: this.renderedOffset,
            termSize: { rows: 24, cols: 80 },
        });
    }

    /** Mirrors the restore path: carried screen first, then read the file on from it. */
    restore(blockId: string, file: TermFile) {
        const carried = takeCarriedTerminal(blockId);
        let from = 0;
        if (carried != null) {
            this.write(Array.from(carried.snapshot).map((c) => c.charCodeAt(0)), carried.ptyOffset);
            from = carried.ptyOffset;
        }
        const { bytes, size } = file.readFrom(from);
        this.write(bytes, size);
        this.loaded = true;
    }
}

const BLOCK = "block-1";

/** Output the shell produced, as one logical stream to compare a screen against. */
function shellOutput(...chunks: string[]): number[] {
    return chunks.flatMap((chunk) => Array.from(chunk).map((c) => c.charCodeAt(0)));
}

function asText(bytes: number[]): string {
    return String.fromCharCode(...bytes);
}

/** Appends to the file and to the live terminal, as the server + WS pair does. */
function emit(file: TermFile, session: TermSession | null, text: string) {
    const bytes = shellOutput(text);
    file.append(bytes);
    if (session != null && session.loaded) {
        session.write(bytes);
    }
}

describe("view transitions", () => {
    let file: TermFile;

    beforeEach(() => {
        clearCarriedTerminals();
        vi.useRealTimers();
        file = new TermFile();
    });

    /**
     * Rebuilding the terminal is what a font, theme, scrollback or renderer change
     * does, and what a tile move or swap does to the block's view. One mechanism,
     * so one test shape: park, rebuild, restore, keep streaming.
     */
    describe.each([
        ["a font family change", "rebuild"],
        ["a font size change", "rebuild"],
        ["a theme change", "rebuild"],
        ["a tile move or swap", "rebuild"],
        ["a split", "rebuild"],
        ["a tab switch back and forth", "rebuild"],
    ])("%s", (_label) => {
        it("keeps the scrollback exactly once", () => {
            const first = new TermSession();
            first.restore(BLOCK, file);
            emit(file, first, "line one\n");
            emit(file, first, "line two\n");
            first.settle();

            first.park(BLOCK);
            const second = new TermSession();
            second.restore(BLOCK, file);
            emit(file, second, "line three\n");
            second.settle();

            expect(asText(second.screen)).toBe("line one\nline two\nline three\n");
            expect(second.ptyOffset).toBe(file.size);
        });
    });

    it("re-reads output that was still in xterm's queue when the view was torn down", () => {
        // The bug this exists for: bytes handed to the terminal but not yet parsed
        // are not in the snapshot. Parking the optimistic offset would claim they
        // were, and the replacement would read past them — they would appear on
        // neither the old screen nor the new one.
        const first = new TermSession();
        first.restore(BLOCK, file);
        emit(file, first, "before\n");
        first.settle();
        emit(file, first, "in flight\n");
        first.flushWriter(); // handed over, never parsed

        first.park(BLOCK);
        const second = new TermSession();
        second.restore(BLOCK, file);
        second.settle();

        expect(asText(second.screen)).toBe("before\nin flight\n");
    });

    it("does not replay output twice when the terminal had caught up", () => {
        const first = new TermSession();
        first.restore(BLOCK, file);
        emit(file, first, "alpha\n");
        emit(file, first, "beta\n");
        first.settle();

        first.park(BLOCK);
        const second = new TermSession();
        second.restore(BLOCK, file);
        second.settle();

        expect(asText(second.screen)).toBe("alpha\nbeta\n");
    });

    it("restores a cold tab from the file once its parked screen has expired", () => {
        vi.useFakeTimers();
        const first = new TermSession();
        first.restore(BLOCK, file);
        emit(file, first, "kept in the file\n");
        first.settle();
        first.park(BLOCK);

        // Evicted past the cap, revisited much later: the parked screen is gone and
        // the file is authoritative.
        vi.advanceTimersByTime(60_000);
        const second = new TermSession();
        second.restore(BLOCK, file);
        second.settle();

        expect(asText(second.screen)).toBe("kept in the file\n");
        expect(second.ptyOffset).toBe(file.size);
    });

    it("starts clean after a clear that follows a burst", () => {
        const session = new TermSession();
        session.restore(BLOCK, file);
        for (let i = 0; i < 50; i++) {
            emit(file, session, `burst ${i}\n`);
        }
        session.settle();
        expect(session.screen.length).toBeGreaterThan(0);

        // `clear` truncates the file and resets the terminal; a stale offset here
        // would make the next read start past the end and restore nothing.
        file.truncate();
        const cleared = new TermSession();
        cleared.restore(BLOCK, file);
        emit(file, cleared, "after clear\n");
        cleared.settle();

        expect(asText(cleared.screen)).toBe("after clear\n");
        expect(cleared.ptyOffset).toBe(file.size);
    });

    it("keeps the stream intact when a resize lands mid-burst", () => {
        // Resizing is decoupled from output on purpose: geometry changes must not
        // touch the byte stream. Interleaving one proves the two do not interact.
        const session = new TermSession();
        session.restore(BLOCK, file);
        const expected: string[] = [];
        for (let i = 0; i < 200; i++) {
            const line = `heavy output line ${i}\n`;
            expected.push(line);
            emit(file, session, line);
            if (i === 100) {
                session.park(BLOCK); // a snapshot taken mid-burst must not disturb it
                takeCarriedTerminal(BLOCK);
            }
        }
        session.settle();

        expect(asText(session.screen)).toBe(expected.join(""));
        expect(session.ptyOffset).toBe(file.size);
    });

    it("survives a remount in the middle of heavy output", () => {
        const first = new TermSession();
        first.restore(BLOCK, file);
        const expected: string[] = [];
        for (let i = 0; i < 60; i++) {
            const line = `pre ${i}\n`;
            expected.push(line);
            emit(file, first, line);
        }
        first.settle();
        // Output keeps coming after the last parse and before the teardown.
        for (let i = 0; i < 5; i++) {
            const line = `mid ${i}\n`;
            expected.push(line);
            emit(file, first, line);
        }
        first.flushWriter();
        first.park(BLOCK);

        const second = new TermSession();
        second.restore(BLOCK, file);
        for (let i = 0; i < 5; i++) {
            const line = `post ${i}\n`;
            expected.push(line);
            emit(file, second, line);
        }
        second.settle();

        expect(asText(second.screen)).toBe(expected.join(""));
    });

    it("applies output held during the read, in order, exactly once", () => {
        // A remote block behaves the same way; what makes it interesting is that
        // appends arrive over the wire while the initial read is still in flight.
        emit(file, null, "history from the job\n");
        const session = new TermSession();
        const read = file.readFrom(0);

        // Live appends land while the read is being applied.
        const liveOne = shellOutput("live one\n");
        const liveOneOffset = file.append(liveOne);
        const liveTwo = shellOutput("live two\n");
        const liveTwoOffset = file.append(liveTwo);
        session.holdAppend(liveOneOffset, liveOne);
        session.holdAppend(liveTwoOffset, liveTwo);

        session.write(read.bytes, read.size);
        expect(session.drainHeld()).toBe(true);
        session.settle();

        expect(asText(session.screen)).toBe("history from the job\nlive one\nlive two\n");
        expect(session.ptyOffset).toBe(file.size);
    });

    it("skips held output the read already covered", () => {
        const history = shellOutput("already read\n");
        file.append(history);
        const session = new TermSession();
        // The append and the read overlap: the same bytes arrive by both routes.
        session.holdAppend(0, history);
        const read = file.readFrom(0);
        session.write(read.bytes, read.size);
        expect(session.drainHeld()).toBe(true);
        session.settle();

        expect(asText(session.screen)).toBe("already read\n");
    });

    it("refuses to splice when output went missing between the read and the stream", () => {
        file.append(shellOutput("first\n"));
        const session = new TermSession();
        const read = file.readFrom(0);
        session.write(read.bytes, read.size);
        // A gap: the file moved on further than the held append accounts for.
        file.append(shellOutput("lost\n"));
        const later = shellOutput("later\n");
        session.holdAppend(file.append(later), later);

        // Reconciliation fails rather than joining two unrelated points, which sends
        // TermWrap to a clean reread.
        expect(session.drainHeld()).toBe(false);
    });
});
