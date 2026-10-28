import type { ITerminalOptions } from "@xterm/xterm";
import { appearancePresets, mixHex, type ColorToken } from "./appearance-presets";
export type { ColorToken } from "./appearance-presets";

export type AppearanceSettings = {
    themeId: string;
    colors: Partial<Record<ColorToken, string>>;
    terminalFontFamily: string;
    /** Empty string explicitly disables an inherited uploaded asset. */
    terminalFontAssetId?: string;
    uiFontFamily: string;
    terminalFontSize: number;
    uiFontSize: number;
    lineHeight: number;
    letterSpacing: number;
    cursorStyle: "block" | "bar" | "underline";
    cursorBlink: boolean;
    scrollback: number;
    density: "compact" | "comfortable";
    radius: number;
    /** Empty string explicitly disables an inherited uploaded asset. */
    backgroundAssetId?: string;
    backgroundFit: "cover" | "contain" | "tile";
    backgroundOpacity: number;
    backgroundBlur: number;
    terminalOpacity: number;
};
export const defaultAppearance: AppearanceSettings = {
    themeId: "slterm-dark", colors: {}, terminalFontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    uiFontFamily: '"Segoe UI", system-ui, sans-serif', terminalFontAssetId: "", backgroundAssetId: "", terminalFontSize: 13, uiFontSize: 13,
    lineHeight: 1.15, letterSpacing: 0, cursorStyle: "bar", cursorBlink: true, scrollback: 10000,
    density: "compact", radius: 6, backgroundFit: "cover", backgroundOpacity: .25, backgroundBlur: 0, terminalOpacity: 1,
};
const colorKeys: ColorToken[] = ["bg", "surface", "surfaceRaised", "surfaceHover", "text", "textMuted", "line", "accent", "terminalBg", "terminalFg", "selection"];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const family = (value: unknown, fallback: string) => typeof value === "string" && value.trim() && value.length <= 240 && !/[;{}\r\n\x00-\x1f]/.test(value) ? value.trim() : fallback;
const assetId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : "";
export function normalizeAppearance(value: unknown): AppearanceSettings {
    const input = record(value);
    const colors: Partial<Record<ColorToken, string>> = {};
    const rawColors = record(input.colors);
    for (const key of colorKeys) {
        const color = rawColors[key];
        if (typeof color === "string" && /^#[\da-f]{6}$/i.test(color)) colors[key] = color.toLowerCase();
        else if (typeof color === "string" && /^#[\da-f]{3}$/i.test(color)) colors[key] = "#" + [...color.slice(1)].map((char) => char + char).join("").toLowerCase();
    }
    return {
        themeId: appearancePresets.some((theme) => theme.id === input.themeId) ? String(input.themeId) : defaultAppearance.themeId,
        colors, terminalFontFamily: family(input.terminalFontFamily, defaultAppearance.terminalFontFamily), terminalFontAssetId: assetId(input.terminalFontAssetId),
        uiFontFamily: family(input.uiFontFamily, defaultAppearance.uiFontFamily),
        terminalFontSize: bounded(input.terminalFontSize, 13, 8, 40), uiFontSize: bounded(input.uiFontSize, 13, 10, 24),
        lineHeight: bounded(input.lineHeight, 1.15, 1, 2.5), letterSpacing: bounded(input.letterSpacing, 0, -2, 10),
        cursorStyle: input.cursorStyle === "block" || input.cursorStyle === "underline" ? input.cursorStyle : "bar",
        cursorBlink: typeof input.cursorBlink === "boolean" ? input.cursorBlink : true,
        scrollback: Math.round(bounded(input.scrollback, 10000, 100, 100000)), density: input.density === "comfortable" ? "comfortable" : "compact",
        radius: bounded(input.radius, 6, 0, 24), backgroundAssetId: assetId(input.backgroundAssetId),
        backgroundFit: input.backgroundFit === "contain" || input.backgroundFit === "tile" ? input.backgroundFit : "cover",
        backgroundOpacity: bounded(input.backgroundOpacity, .25, 0, 1), backgroundBlur: bounded(input.backgroundBlur, 0, 0, 20),
        terminalOpacity: bounded(input.terminalOpacity, 1, 0, 1),
    };
}
export function resolveAppearance(global: AppearanceSettings, override?: Partial<AppearanceSettings>): AppearanceSettings {
    return normalizeAppearance({ ...global, ...override, colors: { ...global.colors, ...override?.colors } });
}
export function resolvedAppearanceColors(settings: AppearanceSettings) {
    const safe = normalizeAppearance(settings);
    return { ...appearancePresets.find((theme) => theme.id === safe.themeId)!.colors, ...safe.colors };
}
export function appearanceTokens(settings: AppearanceSettings): Record<string, string> {
    const safe = normalizeAppearance(settings);
    const colors = resolvedAppearanceColors(safe);
    const tokens: Record<string, string> = {};
    const names: Record<ColorToken, string> = { bg: "bg", surface: "surface", surfaceRaised: "surface-raised", surfaceHover: "surface-hover", text: "text", textMuted: "text-muted", line: "line", accent: "accent", terminalBg: "terminal-bg", terminalFg: "terminal-fg", selection: "selection-bg" };
    for (const key of colorKeys) tokens["--" + names[key]] = colors[key];
    Object.assign(tokens, {
        "--text-dim": mixHex(colors.textMuted, colors.bg, .15), "--line-strong": mixHex(colors.line, colors.text, .2),
        "--accent-ink": colors.bg, "--accent-soft": mixHex(colors.surface, colors.accent, .13), "--accent-border": mixHex(colors.surface, colors.accent, .6),
        "--font-ui": safe.uiFontFamily, "--font-mono": safe.terminalFontFamily,
        "--text-xs": `${safe.uiFontSize - 2}px`, "--text-sm": `${safe.uiFontSize - 1}px`, "--text-md": `${safe.uiFontSize}px`,
        "--text-lg": `${safe.uiFontSize + 2}px`, "--text-xl": `${safe.uiFontSize + 5}px`,
        "--radius-sm": `${Math.max(0, safe.radius - 2)}px`, "--radius-md": `${safe.radius}px`, "--radius-lg": `${safe.radius + 2}px`,
        "--control-height": safe.density === "compact" ? "30px" : "36px", "--pane-header-height": safe.density === "compact" ? "34px" : "40px",
        "--tab-height": safe.density === "compact" ? "40px" : "46px", "--toolbar-height": safe.density === "compact" ? "42px" : "48px",
        "--terminal-bg": colors.terminalBg + Math.round(safe.terminalOpacity * 255).toString(16).padStart(2, "0"),
    });
    return tokens;
}
export function terminalAppearance(settings: AppearanceSettings): Partial<ITerminalOptions> {
    const safe = normalizeAppearance(settings);
    const colors = resolvedAppearanceColors(safe);
    const preset = appearancePresets.find((theme) => theme.id === safe.themeId)!;
    return {
        fontFamily: safe.terminalFontFamily, fontSize: safe.terminalFontSize, lineHeight: safe.lineHeight, letterSpacing: safe.letterSpacing,
        cursorStyle: safe.cursorStyle, cursorBlink: safe.cursorBlink, scrollback: safe.scrollback,
        theme: { ...preset.ansi, background: colors.terminalBg + Math.round(safe.terminalOpacity * 255).toString(16).padStart(2, "0"), foreground: colors.terminalFg, cursor: colors.accent, selectionBackground: colors.selection },
    };
}
