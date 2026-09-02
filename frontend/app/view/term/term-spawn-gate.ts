// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deciding whether a terminal's geometry is real yet.
 *
 * The shell is started by the terminal's first resize, so that resize decides the
 * width the shell's very first frame is painted at. Getting it wrong is not cosmetic:
 * the program lays out its output for one width, the client then reports another, and
 * the redraw leaves the stale cells behind — the ghost characters that show up after a
 * clear. Waiting for a measurement that means something is the whole fix.
 */

/** The shape the fit addon proposes; null/undefined when it cannot measure at all. */
export type ProposedTermDims = { cols: number; rows: number } | null | undefined;

/**
 * Whether a proposed geometry reflects a real, laid-out element.
 *
 * Rejects two distinct pre-layout states:
 * - no measurement at all, before the font's cell metrics exist;
 * - the fit addon's floor geometry, which it returns for a zero-sized box once cell
 *   metrics *do* exist. That one is the trap — 2x1 is a number, and it looks valid.
 *
 * An empty box therefore disqualifies the measurement regardless of what was proposed.
 */
export function canMeasureTermLayout(clientWidth: number, clientHeight: number, dims: ProposedTermDims): boolean {
    if (!(clientWidth > 0) || !(clientHeight > 0)) {
        return false;
    }
    if (dims == null) {
        return false;
    }
    return Number.isFinite(dims.cols) && Number.isFinite(dims.rows) && dims.cols > 0 && dims.rows > 0;
}
