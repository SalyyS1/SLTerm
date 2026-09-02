// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Hand-off of a terminal's on-screen state across a remount.
 *
 * The layout tree unmounts a block's view when it is moved or swapped between
 * tiles, and the terminal is also rebuilt when an option that xterm can only take
 * at construction changes (scrollback, transparency, renderer). The replacement
 * instance can rebuild itself from the block's term file, but that means a fresh
 * read of the whole retained history over the wire, and it loses anything the file
 * has already dropped from its circular window.
 *
 * So the outgoing instance leaves its serialized buffer here and the incoming one
 * picks it up. Entries are single-use and short-lived: a remount happens within a
 * frame or two, and anything older is a different situation that should re-read the
 * file rather than restore a stale screen.
 */

/** A terminal's screen, parked between the old instance and the new one. */
export type CarriedTerminal = {
    /** Serialized xterm buffer, written verbatim into the new instance. */
    snapshot: string;
    /** Absolute term-file offset the snapshot ends at; the new instance reads on from here. */
    ptyOffset: number;
    /** Geometry the snapshot was serialized at, so it can be written back at its own width. */
    termSize: { rows: number; cols: number };
    /** When it was parked, for expiry. */
    storedAt: number;
};

/**
 * How long a parked screen stays usable. A remount is immediate; this only has to
 * survive React tearing down one instance and constructing the next. Anything older
 * is a stale screen and re-reading the file is the honest answer.
 */
export const CarryOverTtlMs = 10_000;

/**
 * Cap on a single parked snapshot. A serialized screen of a normal scrollback is
 * tens of KB; past this the file read is the cheaper path anyway, and parking it
 * would pin the bytes until expiry.
 */
export const MaxCarryOverBytes = 4 * 1024 * 1024;

/** Cap on parked screens, so a burst of closing blocks cannot hold unbounded memory. */
export const MaxCarryOverEntries = 16;

const carried = new Map<string, CarriedTerminal>();

/** Drops entries past their TTL. Called on both park and pick-up, so the map cannot leak. */
function evictExpired(now: number) {
    for (const [blockId, entry] of carried) {
        if (now - entry.storedAt > CarryOverTtlMs) {
            carried.delete(blockId);
        }
    }
}

/**
 * Parks a terminal's screen for its replacement. Overwrites any existing entry for
 * the block: the newest screen is the only one worth restoring.
 */
export function parkCarriedTerminal(blockId: string, entry: Omit<CarriedTerminal, "storedAt">): boolean {
    const now = Date.now();
    evictExpired(now);
    if (entry.snapshot.length > MaxCarryOverBytes) {
        return false;
    }
    if (!carried.has(blockId) && carried.size >= MaxCarryOverEntries) {
        // Evict the oldest to make room rather than refusing the newest.
        let oldestId: string | null = null;
        let oldestAt = Infinity;
        for (const [id, existing] of carried) {
            if (existing.storedAt < oldestAt) {
                oldestAt = existing.storedAt;
                oldestId = id;
            }
        }
        if (oldestId != null) {
            carried.delete(oldestId);
        }
    }
    carried.set(blockId, { ...entry, storedAt: now });
    return true;
}

/**
 * Takes the parked screen for a block, if there is a live one. Single-use: a screen
 * is restored once, and a later remount reads the file.
 */
export function takeCarriedTerminal(blockId: string): CarriedTerminal | null {
    const now = Date.now();
    evictExpired(now);
    const entry = carried.get(blockId);
    if (entry == null) {
        return null;
    }
    carried.delete(blockId);
    return entry;
}

/** Test seam. */
export function clearCarriedTerminals() {
    carried.clear();
}

/** Test seam. */
export function carriedTerminalCount(): number {
    return carried.size;
}
