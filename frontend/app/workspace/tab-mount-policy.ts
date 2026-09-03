// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Which tabs stay mounted when one document holds them all.
 *
 * With per-tab webviews the host bounded this for us: a `WebContentsView` LRU
 * evicted cold tabs and their memory went with the process. In one document there
 * is no such boundary — every mounted tab keeps its terminals and editors on the
 * same heap and its work on the same main thread — so the bound has to be explicit.
 *
 * The rule is least-recently-shown: the active tab is never evicted, tabs that no
 * longer exist go immediately, and beyond the cap the tabs you looked at longest ago
 * are unmounted. Coming back to one is not lossless-free but it is not lossy either:
 * a terminal restores from its parked screen, or failing that from the term file.
 */

/**
 * Default cap on mounted tabs. Matches the Electron tab-view cache default, since
 * `window:maxtabcachesize` configures both and it is the number the app has always
 * shipped for this idea.
 */
export const DefaultMaxWarmTabs = 10;

export type MountedTabsInput = {
    /** Currently mounted, in mount order. Order is preserved for survivors. */
    prev: string[];
    /** Tabs that exist in the workspace right now. */
    tabIds: string[];
    /** The tab being shown; always ends up mounted, never evicted. */
    activeTabId: string;
    /** Tab ids most recently shown first. Ids missing from it rank as oldest. */
    recency: string[];
    /** Cap from `window:maxtabcachesize`; clamped to at least 1. */
    maxWarm: number;
};

/** Clamps a configured cap to something usable — the shown tab must fit. */
export function clampMaxWarmTabs(configured: number | undefined | null): number {
    if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
        return DefaultMaxWarmTabs;
    }
    return Math.max(1, Math.floor(configured));
}

/**
 * Resolves the set of tabs that should be mounted.
 *
 * Returns `prev` itself when nothing changes. That identity matters: the caller
 * writes this straight back into state, and a fresh array every time would loop.
 */
export function resolveMountedTabs(input: MountedTabsInput): string[] {
    const { prev, tabIds, activeTabId, recency } = input;
    const maxWarm = clampMaxWarmTabs(input.maxWarm);
    const exists = new Set(tabIds);
    // A tab closed anywhere else stops existing, and its view has to go with it.
    let next = prev.filter((id) => exists.has(id));
    const activeIsReal = !!activeTabId && exists.has(activeTabId);
    if (activeIsReal && !next.includes(activeTabId)) {
        next = [...next, activeTabId];
    }
    if (next.length > maxWarm) {
        const rank = new Map<string, number>();
        recency.forEach((id, idx) => {
            if (!rank.has(id)) {
                rank.set(id, idx);
            }
        });
        // Coldest first: unranked tabs (never shown since this list was built) go
        // before anything with a known position.
        const evictable = next
            .filter((id) => id !== activeTabId)
            .sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER))
            .reverse();
        const evict = new Set(evictable.slice(0, next.length - maxWarm));
        next = next.filter((id) => !evict.has(id));
    }
    if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
        return prev;
    }
    return next;
}

/** Moves a tab to the front of a most-recent-first list, without duplicates. */
export function touchRecency(recency: string[], tabId: string): string[] {
    if (!tabId) {
        return recency;
    }
    if (recency[0] === tabId) {
        return recency;
    }
    return [tabId, ...recency.filter((id) => id !== tabId)];
}
