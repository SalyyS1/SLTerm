// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DefaultMaxWarmTabs,
    clampMaxWarmTabs,
    resolveMountedTabs,
    touchRecency,
} from "../tab-mount-policy";

describe("clampMaxWarmTabs", () => {
    it("takes a configured cap", () => {
        expect(clampMaxWarmTabs(4)).toBe(4);
    });

    it("falls back to the default when unset", () => {
        expect(clampMaxWarmTabs(undefined)).toBe(DefaultMaxWarmTabs);
        expect(clampMaxWarmTabs(null)).toBe(DefaultMaxWarmTabs);
    });

    it("treats zero and negatives as unset rather than unmounting everything", () => {
        expect(clampMaxWarmTabs(0)).toBe(DefaultMaxWarmTabs);
        expect(clampMaxWarmTabs(-3)).toBe(DefaultMaxWarmTabs);
    });

    it("truncates a fractional cap", () => {
        expect(clampMaxWarmTabs(3.7)).toBe(3);
    });

    it("ignores a non-number", () => {
        expect(clampMaxWarmTabs("6" as unknown as number)).toBe(DefaultMaxWarmTabs);
        expect(clampMaxWarmTabs(NaN)).toBe(DefaultMaxWarmTabs);
    });
});

describe("touchRecency", () => {
    it("puts the shown tab first", () => {
        expect(touchRecency(["b", "c"], "a")).toEqual(["a", "b", "c"]);
    });

    it("moves an already-seen tab to the front without duplicating it", () => {
        expect(touchRecency(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    });

    it("returns the same list when the tab is already first", () => {
        const recency = ["a", "b"];
        expect(touchRecency(recency, "a")).toBe(recency);
    });

    it("ignores an empty tab id", () => {
        const recency = ["a"];
        expect(touchRecency(recency, "")).toBe(recency);
    });
});

describe("resolveMountedTabs", () => {
    const base = { tabIds: ["a", "b", "c"], recency: ["a"], maxWarm: 10 };

    it("mounts the shown tab", () => {
        expect(resolveMountedTabs({ ...base, prev: [], activeTabId: "a" })).toEqual(["a"]);
    });

    it("keeps previously visited tabs mounted", () => {
        expect(resolveMountedTabs({ ...base, prev: ["a"], activeTabId: "b", recency: ["b", "a"] })).toEqual(["a", "b"]);
    });

    it("returns the same array when nothing changes", () => {
        const prev = ["a", "b"];
        expect(resolveMountedTabs({ ...base, prev, activeTabId: "b", recency: ["b", "a"] })).toBe(prev);
    });

    it("unmounts a tab that no longer exists", () => {
        expect(resolveMountedTabs({ ...base, prev: ["a", "gone"], activeTabId: "a" })).toEqual(["a"]);
    });

    it("ignores an active tab that is not in the workspace", () => {
        expect(resolveMountedTabs({ ...base, prev: ["a"], activeTabId: "ghost" })).toEqual(["a"]);
    });

    it("evicts the least recently shown tab past the cap", () => {
        // Shown order was a, b, c, d; d is active, cap is 3, so a goes.
        const next = resolveMountedTabs({
            prev: ["a", "b", "c", "d"],
            tabIds: ["a", "b", "c", "d"],
            activeTabId: "d",
            recency: ["d", "c", "b", "a"],
            maxWarm: 3,
        });
        expect(next).toEqual(["b", "c", "d"]);
    });

    it("evicts several at once when the cap drops", () => {
        const next = resolveMountedTabs({
            prev: ["a", "b", "c", "d"],
            tabIds: ["a", "b", "c", "d"],
            activeTabId: "d",
            recency: ["d", "c", "b", "a"],
            maxWarm: 2,
        });
        expect(next).toEqual(["c", "d"]);
    });

    it("never evicts the tab being shown, even as the coldest", () => {
        const next = resolveMountedTabs({
            prev: ["a", "b", "c"],
            tabIds: ["a", "b", "c"],
            activeTabId: "a",
            recency: ["c", "b", "a"],
            maxWarm: 1,
        });
        expect(next).toEqual(["a"]);
    });

    it("evicts tabs it has no recency for first", () => {
        // "x" was mounted before this window learned any order — it is the coldest
        // thing there is, and holding it while evicting a tab we know is warmer
        // would be backwards.
        const next = resolveMountedTabs({
            prev: ["x", "b", "c"],
            tabIds: ["x", "b", "c"],
            activeTabId: "c",
            recency: ["c", "b"],
            maxWarm: 2,
        });
        expect(next).toEqual(["b", "c"]);
    });

    it("preserves mount order for survivors, so the DOM does not reshuffle", () => {
        const next = resolveMountedTabs({
            prev: ["a", "b", "c", "d"],
            tabIds: ["a", "b", "c", "d"],
            activeTabId: "b",
            recency: ["b", "a", "d", "c"],
            maxWarm: 3,
        });
        // c is coldest and goes; the rest keep the order they were mounted in.
        expect(next).toEqual(["a", "b", "d"]);
    });

    it("holds a single tab at a cap of one", () => {
        const next = resolveMountedTabs({
            prev: ["a"],
            tabIds: ["a", "b"],
            activeTabId: "b",
            recency: ["b", "a"],
            maxWarm: 1,
        });
        expect(next).toEqual(["b"]);
    });

    it("applies the default cap when the setting is missing", () => {
        const prev = Array.from({ length: 12 }, (_, i) => `t${i}`);
        const next = resolveMountedTabs({
            prev,
            tabIds: prev,
            activeTabId: "t11",
            recency: [...prev].reverse(),
            maxWarm: undefined as unknown as number,
        });
        expect(next).toHaveLength(DefaultMaxWarmTabs);
        expect(next).toContain("t11");
    });
});
