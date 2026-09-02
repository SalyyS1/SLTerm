// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { canMeasureTermLayout } from "../term-spawn-gate";

describe("canMeasureTermLayout", () => {
    it("accepts a laid-out element with real geometry", () => {
        expect(canMeasureTermLayout(800, 600, { cols: 120, rows: 40 })).toBe(true);
    });

    it("rejects an element with no box, before first layout", () => {
        expect(canMeasureTermLayout(0, 0, undefined)).toBe(false);
    });

    it("rejects the fit addon's floor geometry for a collapsed box", () => {
        // The trap this gate exists for: cell metrics are known, so numbers come back,
        // but the box is empty and 2x1 is not the size anything should start at.
        expect(canMeasureTermLayout(0, 0, { cols: 2, rows: 1 })).toBe(false);
    });

    it("rejects a zero-height box even when it has width", () => {
        expect(canMeasureTermLayout(800, 0, { cols: 120, rows: 1 })).toBe(false);
    });

    it("rejects a zero-width box even when it has height", () => {
        expect(canMeasureTermLayout(0, 600, { cols: 2, rows: 40 })).toBe(false);
    });

    it("rejects NaN dimensions from an unstyled parent", () => {
        // parseInt("") on a computed height yields NaN, which propagates through
        // Math.max and would otherwise reach terminal.resize().
        expect(canMeasureTermLayout(800, 600, { cols: NaN, rows: NaN })).toBe(false);
        expect(canMeasureTermLayout(800, 600, { cols: 120, rows: NaN })).toBe(false);
    });

    it("rejects a non-finite proposal", () => {
        expect(canMeasureTermLayout(800, 600, { cols: Infinity, rows: 40 })).toBe(false);
    });

    it("rejects a null proposal even with a real box", () => {
        // The addon returns null before the terminal is attached; the box being real
        // does not make the missing measurement usable.
        expect(canMeasureTermLayout(800, 600, null)).toBe(false);
    });

    it("rejects a NaN box, which is what a detached element reports", () => {
        expect(canMeasureTermLayout(NaN, NaN, { cols: 120, rows: 40 })).toBe(false);
    });
});
