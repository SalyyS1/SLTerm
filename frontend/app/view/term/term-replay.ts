// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reconciliation between a range read of a terminal's history file and the live
 * appends that arrived while that read was in flight.
 *
 * Both sides are measured in absolute file offsets, which stay meaningful after
 * a circular-file wrap because the file's size keeps growing past its retention
 * limit. That is what makes the overlap computable instead of guessed at.
 */

/** An append that landed while the initial replay was still in flight. */
export type HeldChunk = {
    /** Absolute file offset the bytes were written at. */
    offset: number;
    data: Uint8Array;
};

export type ReconcileResult = {
    /** Byte ranges still to write, in order. */
    writes: Uint8Array[];
    /**
     * False when the held output cannot be applied without leaving a gap, so the
     * caller has to reread the file instead. Writing a stream with a hole in it
     * can cut an escape sequence in half, and a half-parsed sequence is what
     * turns an in-place redraw into a screenful of stacked duplicate lines.
     */
    ok: boolean;
};

/**
 * Works out which of the held appends the read already covered.
 *
 * ptyOffset is the first byte not yet on screen. A chunk that ends at or before
 * it was already read; one that starts after it means bytes went missing between
 * the read and the stream; anything else is written from where the read stopped.
 */
export function reconcileHeldData(held: HeldChunk[], ptyOffset: number): ReconcileResult {
    const writes: Uint8Array[] = [];
    let offset = ptyOffset;
    for (const chunk of held) {
        const chunkEnd = chunk.offset + chunk.data.length;
        if (chunkEnd <= offset) {
            continue;
        }
        if (chunk.offset > offset) {
            return { writes: [], ok: false };
        }
        const skip = offset - chunk.offset;
        writes.push(skip > 0 ? chunk.data.subarray(skip) : chunk.data);
        offset = chunkEnd;
    }
    return { writes, ok: true };
}

/**
 * Index of the first byte a circular file still retains, mirroring Go's
 * WaveFile.DataStartIdx. A read below this has already scrolled out of the file,
 * and the server serves from here instead without saying so.
 */
export function waveFileDataStartIdx(file: WaveFile): number {
    const maxSize = file?.opts?.maxsize ?? 0;
    if (file?.opts?.circular && maxSize > 0 && file.size > maxSize) {
        return file.size - maxSize;
    }
    return 0;
}
