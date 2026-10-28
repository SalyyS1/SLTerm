import { describe, expect, it } from "vitest";
import { appearanceFor, newPreferences, parsePreferences, restoreDescriptors, shortcutsFor, withDescriptors } from "./workspace-preferences";
import { addTerminal, addWorkspace, createWorkspace } from "./workspace-model";

describe("workspace preference persistence", () => {
    it("refuses future or malformed envelopes so load cannot enable overwriting them", () => {
        for (const input of [{ version: 2 }, {}, [], { ...newPreferences(), overrides: [] },
            { ...newPreferences(), appearance: undefined, shortcuts: undefined, workspaces: null }]) {
            expect(() => parsePreferences(input)).toThrow();
        }
        expect(() => parsePreferences({ version: 1, workspaces: [], overrides: {} })).toThrow();
    });
    it("rejects duplicate identities and malformed descriptors", () => {
        const descriptor = { id: "workspace", name: "Local", cwd: "C:\\Repo", layoutMode: "free" };
        expect(() => parsePreferences({ ...newPreferences(), workspaces: [descriptor, descriptor] })).toThrow();
        expect(() => parsePreferences({ ...newPreferences(), workspaces: [{ ...descriptor, cwd: null }] })).toThrow();
    });
    it("restores only workspace descriptors without claiming any terminal is running", () => {
        const original = addTerminal(addWorkspace({ workspaces: [], activeWorkspaceId: null }, createWorkspace("id", "Dev", "C:\\Repo")), "id", { paneId: 8, title: "Server" });
        const stored = withDescriptors(newPreferences(), original);
        const restored = restoreDescriptors(parsePreferences(JSON.parse(JSON.stringify(stored))));
        expect(restored.workspaces[0]).toMatchObject({ id: "id", name: "Dev", cwd: "C:\\Repo", layout: null,
            activePaneId: null, zoomedPaneId: null, hiddenPaneIds: [], floating: {} });
        expect(JSON.stringify(stored)).not.toContain("paneId");
    });
    it("inherits unchanged groups and persists explicit no-image and no-font overrides", () => {
        const preferences = newPreferences();
        preferences.appearance = { ...preferences.appearance, themeId: "dracula", terminalFontSize: 20,
            backgroundAssetId: "global-image", terminalFontAssetId: "global-font", colors: { accent: "#ffffff" } };
        preferences.shortcuts = { ...preferences.shortcuts, newTerminal: "Ctrl+Alt+KeyN" };
        preferences.overrides.id = { appearance: { ...preferences.appearance, themeId: "slterm-dark", colors: {}, backgroundAssetId: "", terminalFontAssetId: "" } };
        const restored = parsePreferences(JSON.parse(JSON.stringify(preferences)));
        expect(appearanceFor(restored, "other")).toMatchObject({ terminalFontSize: 20, backgroundAssetId: "global-image" });
        expect(appearanceFor(restored, "id")).toMatchObject({ themeId: "slterm-dark", colors: {}, backgroundAssetId: "", terminalFontAssetId: "" });
        expect(shortcutsFor(restored, "id").newTerminal).toBe("Ctrl+Alt+KeyN");
        restored.overrides.id.shortcuts = { ...restored.shortcuts, newTerminal: null };
        expect(shortcutsFor(restored, "id").newTerminal).toBeNull();
        delete restored.overrides.id;
        expect(appearanceFor(restored, "id").backgroundAssetId).toBe("global-image");
    });
    it("descriptor autosaves preserve unrelated settings and select a surviving workspace on invalid active ID", () => {
        const preferences = newPreferences(); preferences.overrides.id = { shortcuts: { ...preferences.shortcuts, hidePane: "Ctrl+Alt+KeyH" } };
        const state = addWorkspace({ workspaces: [], activeWorkspaceId: null }, createWorkspace("id", "Dev", "C:\\Repo"));
        const changed = withDescriptors(preferences, state);
        expect(changed.overrides).toBe(preferences.overrides); expect(changed.appearance).toBe(preferences.appearance);
        expect(parsePreferences({ ...changed, activeWorkspaceId: "missing" }).activeWorkspaceId).toBe("id");
    });
});
