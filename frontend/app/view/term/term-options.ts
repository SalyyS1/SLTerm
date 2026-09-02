// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Terminal option resolution that has no dependency on xterm or the store, so it
 * stays cheap to reason about and to test.
 */

export const DefaultTermScrollback = 2000;
const MaxTermScrollback = 50000;

/**
 * Resolves the scrollback line count, the block's own setting winning over the
 * global one.
 *
 * xterm takes scrollback at construction, making this one of the few values whose
 * change has to rebuild the terminal — so it is worth resolving in exactly one
 * place rather than recomputing it wherever a rebuild is decided.
 */
export function clampScrollback(settingsValue: unknown, blockValue: unknown): number {
    let scrollback = DefaultTermScrollback;
    if (typeof settingsValue === "number" && settingsValue) {
        scrollback = Math.floor(settingsValue);
    }
    if (typeof blockValue === "number" && blockValue) {
        scrollback = Math.floor(blockValue);
    }
    if (!Number.isFinite(scrollback) || scrollback < 0) {
        return 0;
    }
    return Math.min(scrollback, MaxTermScrollback);
}
