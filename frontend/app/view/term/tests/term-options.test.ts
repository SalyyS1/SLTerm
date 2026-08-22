// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { clampScrollback, DefaultTermScrollback } from "../term-options";

describe("clampScrollback", () => {
    it("falls back to the default when nothing is configured", () => {
        expect(clampScrollback(undefined, undefined)).toBe(DefaultTermScrollback);
    });

    it("takes the global setting", () => {
        expect(clampScrollback(8000, undefined)).toBe(8000);
    });

    it("lets the block override the global setting", () => {
        expect(clampScrollback(8000, 500)).toBe(500);
    });

    it("truncates a fractional value to whole lines", () => {
        expect(clampScrollback(1500.9, undefined)).toBe(1500);
    });

    it("caps a value above the ceiling", () => {
        expect(clampScrollback(1_000_000, undefined)).toBe(50000);
    });

    it("floors a negative value at zero", () => {
        expect(clampScrollback(-10, undefined)).toBe(0);
    });

    it("ignores values that are not numbers", () => {
        expect(clampScrollback("4000", undefined)).toBe(DefaultTermScrollback);
        expect(clampScrollback(null, undefined)).toBe(DefaultTermScrollback);
    });

    it("treats zero as unset, matching the setting's own semantics", () => {
        // Zero has always meant "not configured" here; a real no-scrollback
        // terminal is expressed by the negative-clamped path above.
        expect(clampScrollback(0, undefined)).toBe(DefaultTermScrollback);
    });
});
