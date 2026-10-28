import { describe, expect, it } from "vitest";
import { appearancePresets } from "./appearance-presets";
import { appearanceTokens, defaultAppearance, normalizeAppearance, resolveAppearance, resolvedAppearanceColors, terminalAppearance } from "./appearance-settings";

describe("appearance settings contracts", () => {
    it("uses safe defaults for missing, nonfinite, and untrusted input", () => {
        const normalized = normalizeAppearance({
            themeId: "remote-theme", terminalFontSize: Infinity, uiFontSize: NaN,
            terminalFontFamily: "bad; color:red", uiFontFamily: "", cursorBlink: "false",
            colors: { accent: "url(https://invalid)", text: "#abc", bg: "#123456", unknown: "#ffffff" },
            terminalFontAssetId: "../font", backgroundAssetId: "https://invalid/image.png",
        });
        expect(normalized.themeId).toBe(defaultAppearance.themeId);
        expect(normalized.terminalFontSize).toBe(defaultAppearance.terminalFontSize);
        expect(normalized.uiFontSize).toBe(defaultAppearance.uiFontSize);
        expect(normalized.terminalFontFamily).toBe(defaultAppearance.terminalFontFamily);
        expect(normalized.colors).toEqual({ text: "#aabbcc", bg: "#123456" });
        expect(normalized.cursorBlink).toBe(true);
        expect(normalized.backgroundAssetId).toBe("");
        expect(normalized.terminalFontAssetId).toBe("");
        expect(normalizeAppearance(null)).toEqual(normalizeAppearance(defaultAppearance));
    });
    it("clamps numeric fields to usable bounds", () => {
        const normalized = normalizeAppearance({ terminalFontSize: 999, uiFontSize: 1, lineHeight: 0, letterSpacing: -100, scrollback: 10000000, radius: -1, backgroundOpacity: 2, backgroundBlur: 100, terminalOpacity: -.5 });
        expect(normalized).toMatchObject({ terminalFontSize: 40, uiFontSize: 10, lineHeight: 1, letterSpacing: -2, scrollback: 100000, radius: 0, backgroundOpacity: 1, backgroundBlur: 20, terminalOpacity: 0 });
    });
    it("merges workspace overrides without mutating global defaults", () => {
        const global = normalizeAppearance({ ...defaultAppearance, colors: { accent: "#123456", text: "#abcdef" } });
        const workspace = resolveAppearance(global, { terminalFontSize: 22, colors: { text: "#fedcba" } });
        expect(workspace.terminalFontSize).toBe(22);
        expect(workspace.colors).toEqual({ accent: "#123456", text: "#fedcba" });
        expect(global.terminalFontSize).toBe(defaultAppearance.terminalFontSize);
        expect(global.colors.text).toBe("#abcdef");
        expect(resolveAppearance(global)).toEqual(global);
    });
    it("offers distinct dark and light presets with complete local ANSI palettes", () => {
        expect(appearancePresets.length).toBeGreaterThanOrEqual(12);
        expect(new Set(appearancePresets.map((preset) => preset.id)).size).toBe(appearancePresets.length);
        expect(new Set(appearancePresets.map((preset) => preset.colors.bg)).size).toBe(appearancePresets.length);
        expect(appearancePresets.filter((preset) => preset.mode === "light").length).toBeGreaterThanOrEqual(2);
        for (const preset of appearancePresets) {
            expect(Object.keys(preset.ansi)).toHaveLength(16);
            for (const color of [...Object.values(preset.colors), ...Object.values(preset.ansi)]) expect(color).toMatch(/^#[a-f0-9]{6}$/);
            const options = terminalAppearance({ ...defaultAppearance, themeId: preset.id });
            expect(options.theme).toMatchObject(preset.ansi);
            expect(options.theme?.foreground).toBe(preset.colors.terminalFg);
        }
    });
    it("maps custom colors, typography, density, and opacity to CSS and xterm", () => {
        const value = normalizeAppearance({ ...defaultAppearance, colors: { terminalBg: "#112233", accent: "#aabbcc" }, terminalFontFamily: "Consolas, monospace", terminalFontSize: 19, terminalOpacity: .5, density: "comfortable", radius: 10 });
        const options = terminalAppearance(value);
        expect(options).toMatchObject({ fontFamily: "Consolas, monospace", fontSize: 19, cursorStyle: value.cursorStyle, scrollback: value.scrollback, theme: { background: "#11223380", cursor: "#aabbcc" } });
        expect(appearanceTokens(value)).toMatchObject({ "--terminal-bg": "#11223380", "--accent": "#aabbcc", "--radius-md": "10px", "--pane-header-height": "40px" });
        expect(resolvedAppearanceColors(value).terminalBg).toBe("#112233");
    });
    it("persists explicit no-asset overrides rather than inheriting global assets", () => {
        const global = normalizeAppearance({ ...defaultAppearance, backgroundAssetId: "global-image", terminalFontAssetId: "global-font" });
        const override = JSON.parse(JSON.stringify({ backgroundAssetId: "", terminalFontAssetId: "" }));
        const workspace = resolveAppearance(global, override);
        expect(workspace.backgroundAssetId).toBe("");
        expect(workspace.terminalFontAssetId).toBe("");
    });
});
