import { describe, expect, it } from "vitest";
import {
    defaultShortcuts, displayShortcut, matchShortcut, normalizeShortcuts, resolveShortcuts, shortcutFromEvent,
    validateShortcutBindings, type ShortcutBindings,
} from "./workspace-shortcuts";

const key = (code: string, overrides: Record<string, unknown> = {}) => ({
    key: "Unidentified", code, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false,
    isComposing: false, keyCode: 0, repeat: false, ...overrides,
});
const defaults = (): ShortcutBindings => ({ ...defaultShortcuts });

describe("workspace shortcut preferences", () => {
    it("preserves existing terminal gestures and leaves new actions available to bind", () => {
        expect(validateShortcutBindings(defaultShortcuts)).toEqual([]);
        for (const [code, shiftKey, action] of [
            ["KeyT", true, "newWorkspace"], ["KeyD", true, "splitHorizontal"], ["KeyE", true, "splitVertical"],
            ["KeyW", true, "closePane"], ["Enter", true, "zoomPane"], ["Tab", false, "nextWorkspace"],
            ["Tab", true, "previousWorkspace"], ["KeyF", false, "search"],
            ["Equal", false, "fontIncrease"], ["Equal", true, "fontIncrease"],
            ["Minus", false, "fontDecrease"], ["Digit0", false, "fontReset"],
        ] as const) expect(matchShortcut(key(code, { shiftKey }), defaults())).toBe(action);
        expect(defaultShortcuts.settings).toBeNull();
    });
    it("normalizes case, order, keypad and familiar aliases while dropping malformed persisted entries", () => {
        const result = normalizeShortcuts({ newWorkspace: "shift+control+t", fontIncrease: "CTRL++", fontDecrease: "Ctrl+NumpadSubtract",
            fontReset: "ctrl+numpad0", settings: "alt+f2", newTerminal: null, search: "Ctrl+foo", unknown: "Ctrl+F7" });
        expect(result).toMatchObject({ newWorkspace: "Ctrl+Shift+KeyT", fontIncrease: "Ctrl+Equal", fontDecrease: "Ctrl+Minus",
            fontReset: "Ctrl+Digit0", settings: "Alt+F2", newTerminal: null, search: "Ctrl+KeyF" });
        expect(result).not.toHaveProperty("unknown");
        for (const value of [null, undefined, [], "bad", 1]) expect(normalizeShortcuts(value)).toEqual(defaults());
        expect(normalizeShortcuts({ search: "Ctrl+C" }).search).toBe(defaultShortcuts.search);
    });
    it("inherits global customization while preserving explicit per-workspace unbinding", () => {
        const global = normalizeShortcuts({ search: "Ctrl+F3", settings: "Ctrl+Comma" });
        const resolved = resolveShortcuts(global, { search: null, settings: "Alt+F8", newWorkspace: undefined });
        expect(resolved.search).toBeNull();
        expect(resolved.settings).toBe("Alt+F8");
        expect(resolved.newWorkspace).toBe(defaultShortcuts.newWorkspace);
        expect(global.search).toBe("Ctrl+F3");
        expect(resolveShortcuts(global, { search: "Shift+C" }).search).toBe("Ctrl+F3");
        expect(resolveShortcuts(global, null)).toEqual(global);
    });
    it("detects collisions across inheritance and normalization without overwriting drafts", () => {
        const value = { ...defaults(), settings: "control+shift+t" };
        expect(validateShortcutBindings(value)).toContainEqual(expect.objectContaining({ action: "settings", type: "conflict", conflictsWith: "newWorkspace" }));
        expect(value.settings).toBe("control+shift+t");
        const inherited = resolveShortcuts(defaults(), { settings: "Ctrl+F" });
        expect(validateShortcutBindings(inherited)).toContainEqual(expect.objectContaining({ type: "conflict", conflictsWith: "search" }));
        expect(validateShortcutBindings({ ...defaults(), settings: null })).toEqual([]);
    });
    it("rejects invalid modifier sequences, unknown codes and unsafe bare keys", () => {
        for (const binding of ["Ctrl", "Ctrl+Ctrl+T", "Ctrl+Mystery", "Ctrl+T+D", "", "Ctrl+"]) {
            expect(validateShortcutBindings({ settings: binding })[0]?.type, binding).toBe("invalid");
        }
        for (const binding of ["T", "Shift+T", "Enter", "Delete", "Shift+Tab"]) {
            expect(validateShortcutBindings({ settings: binding })[0]?.type, binding).toBe("reserved");
        }
        expect(validateShortcutBindings({ settings: "F8" })).toEqual([]);
        expect(validateShortcutBindings({ settings: "Ctrl+Alt+F8" })).toEqual([]);
    });
    it("reserves clipboard, process interrupt and OS destructive gestures", () => {
        for (const binding of ["Ctrl+C", "Ctrl+V", "Ctrl+Shift+C", "Ctrl+Shift+V", "Ctrl+Insert", "Shift+Insert", "Ctrl+Shift+Insert", "Alt+F4", "Ctrl+Alt+Delete", "Meta+T"]) {
            expect(validateShortcutBindings({ settings: binding })[0]?.type, binding).toBe("reserved");
        }
        expect(matchShortcut(key("KeyC"), { ...defaults(), settings: "Ctrl+KeyC" })).toBeUndefined();
    });
});

describe("workspace shortcut keyboard handling", () => {
    it("uses physical codes across keyboard layouts and normalizes numeric keypad aliases", () => {
        expect(shortcutFromEvent(key("KeyT", { key: "е", shiftKey: true }))).toBe("Ctrl+Shift+KeyT");
        expect(shortcutFromEvent(key("", { key: "t", shiftKey: true }))).toBe("Ctrl+Shift+KeyT");
        for (const [code, action] of [["NumpadAdd", "fontIncrease"], ["NumpadSubtract", "fontDecrease"], ["Numpad0", "fontReset"]]) {
            expect(matchShortcut(key(code), defaults())).toBe(action);
        }
        expect(shortcutFromEvent(key("ControlLeft", { key: "Control" }))).toBeNull();
        expect(shortcutFromEvent(key("Unknown", { key: "t" }))).toBeNull();
    });
    it("does not interrupt composition or AltGraph input", () => {
        for (const overrides of [{ isComposing: true }, { keyCode: 229 }, { getModifierState: (modifier: string) => modifier === "AltGraph" }]) {
            expect(shortcutFromEvent(key("KeyF", overrides))).toBeNull();
            expect(matchShortcut(key("KeyF", overrides), defaults())).toBeUndefined();
        }
        expect(matchShortcut(key("KeyF", { ctrlKey: false }), defaults())).toBeUndefined();
        expect(matchShortcut(key("KeyF", { altKey: true }), defaults())).toBeUndefined();
    });
    it("prevents held keys from repeatedly closing, stopping, spawning or toggling panes", () => {
        const custom = { ...defaults(), stopPane: "Ctrl+F8", newTerminal: "Ctrl+F9", hidePane: "Ctrl+F10", toggleLayout: "Ctrl+F11" };
        for (const [code, shiftKey] of [["KeyW", true], ["KeyT", true], ["KeyD", true], ["Enter", true], ["F8", false], ["F9", false], ["F10", false], ["F11", false]] as const) {
            expect(matchShortcut(key(code, { shiftKey, repeat: true }), custom)).toBeUndefined();
            expect(matchShortcut(key(code, { shiftKey }), custom)).toBeDefined();
        }
        expect(matchShortcut(key("Equal", { repeat: true }), custom)).toBe("fontIncrease");
        expect(matchShortcut(key("Tab", { repeat: true }), custom)).toBe("nextWorkspace");
    });
    it("preserves settings/text input but permits the xterm input textarea", () => {
        const target = (xterm: boolean) => ({ closest: () => ({ classList: { contains: (name: string) => xterm && name === "xterm-helper-textarea" } }) });
        expect(matchShortcut(key("KeyF", { target: target(false) }), defaults())).toBeUndefined();
        expect(matchShortcut(key("KeyF", { target: target(true) }), defaults())).toBe("search");
        expect(matchShortcut(key("KeyF", { target: { closest: () => null } }), defaults())).toBe("search");
    });
    it("lets an explicit plus binding win over the legacy font plus alias", () => {
        const custom = { ...defaults(), settings: "Ctrl+Shift+Equal" };
        expect(matchShortcut(key("Equal", { shiftKey: true }), custom)).toBe("settings");
        expect(matchShortcut(key("Equal"), custom)).toBe("fontIncrease");
    });
    it("displays readable combinations and unbound state", () => {
        expect(displayShortcut("Ctrl+Shift+KeyT")).toBe("Ctrl + Shift + T");
        expect(displayShortcut("Ctrl+Digit0")).toBe("Ctrl + 0");
        expect(displayShortcut("Ctrl+Equal")).toBe("Ctrl + +");
        expect(displayShortcut(null)).toBe("Chưa gán");
    });
});
