import { describe, expect, it } from "vitest";
import { fontKey, nextFontSize } from "./terminal-font";

const key = (value: string, overrides: Record<string, unknown> = {}) => ({
    key: value, code: "", ctrlKey: true, altKey: false, metaKey: false, isComposing: false, keyCode: 0, ...overrides,
});

describe("terminal font gestures", () => {
    it("supports plus/minus/reset and numeric keypad without changing unrelated keys", () => {
        expect(fontKey(key("+"))).toBe(1);
        expect(fontKey(key("="))).toBe(1);
        expect(fontKey(key("-"))).toBe(-1);
        expect(fontKey(key("0"))).toBe("reset");
        expect(fontKey(key("Unidentified", { code: "NumpadAdd" }))).toBe(1);
        expect(fontKey(key("Unidentified", { code: "NumpadSubtract" }))).toBe(-1);
        expect(fontKey(key("c"))).toBeUndefined();
    });
    it("preserves IME, normal typing and terminal modifier combinations", () => {
        for (const overrides of [{ ctrlKey: false }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
            expect(fontKey(key("=", overrides))).toBeUndefined();
        }
    });
    it("bounds the font and restores the original size", () => {
        expect(nextFontSize(12, 1)).toBe(13);
        expect(nextFontSize(12, -1)).toBe(11);
        expect(nextFontSize(8, -1)).toBe(8);
        expect(nextFontSize(30, 1)).toBe(30);
        expect(nextFontSize(30, "reset")).toBe(12);
    });
});
