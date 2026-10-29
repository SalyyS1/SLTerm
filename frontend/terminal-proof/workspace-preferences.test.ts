import { describe, expect, it } from "vitest";
import { appearanceFor, maxPreferencesBytes, newPreferences, parsePreferences, restoreDescriptors, shortcutsFor, withDescriptors } from "./workspace-preferences";
import { addWorkspace, createWorkspace, maxWorkspaceLayoutDepth, type LayoutNode, type PaneNode, type WorkspaceState } from "./workspace-model";

const runId = (id: number) => `01234567-89ab-4cde-8fab-${String(id).padStart(12, "0")}`;
const pane = (id: number): PaneNode => ({ kind: "pane", paneId: id, title: `Terminal ${id}`, runId: runId(id) });
function savedState(): WorkspaceState {
    return { activeWorkspaceId: "two", workspaces: [{
        ...createWorkspace("one", "Development", "C:\\Repo"), layoutMode: "free", arrangement: "manual",
        layout: { kind: "split", splitId: "split-7", axis: "horizontal", ratio: 0.37,
            first: { ...pane(8), title: "Build <local>" }, second: { kind: "split", splitId: "nested", axis: "vertical", ratio: 0.61,
                first: pane(9), second: pane(10) } }, activePaneId: 8, zoomedPaneId: 8, hiddenPaneIds: [10, 9],
        floating: { 8: { x: 0.125, y: 0.25, width: 0.5, height: 0.375 }, 10: { x: 0, y: 0, width: 1, height: 1 } },
    }, { ...createWorkspace("two", "Tools", "D:\\Tools"), layout: pane(42), activePaneId: 42 }] };
}
const preferences = () => withDescriptors(newPreferences(), savedState());

describe("workspace preference persistence", () => {
    it("refuses future or malformed envelopes so load cannot enable overwriting them", () => {
        for (const input of [{ version: 3 }, { version: 0 }, {}, [], { ...newPreferences(), overrides: [] },
            { ...newPreferences(), appearance: undefined, shortcuts: undefined, workspaces: null }]) {
            expect(() => parsePreferences(input)).toThrow();
        }
        expect(() => parsePreferences({ version: 1, workspaces: [], overrides: {} })).toThrow();
        expect(() => parsePreferences({ ...newPreferences(), panes: [pane(1)] })).toThrow();
        expect(parsePreferences(null)).toEqual(newPreferences());
        expect(newPreferences().version).toBe(2);
    });
    it("rejects duplicate identities and malformed descriptors", () => {
        const descriptor = { id: "workspace", name: "Local", cwd: "C:\\Repo", layoutMode: "free" };
        for (const workspaces of [[descriptor, descriptor], [{ ...descriptor, cwd: null }], [{ ...descriptor, layout: pane(1) }]])
            expect(() => parsePreferences({ ...newPreferences(), version: 1, workspaces })).toThrow();
    });
    it("restores exact topology, titles, run identity, selections, visibility and free geometry", () => {
        const original = savedState();
        const stored = withDescriptors(newPreferences(), original);
        const restored = restoreDescriptors(parsePreferences(JSON.parse(JSON.stringify(stored))));
        expect(restored).toEqual(original);
        expect(stored.version).toBe(2);
        expect(restored.workspaces[0].layout).not.toBe(stored.workspaces[0].layout);
        expect(stored.workspaces[0].layout).not.toBe(original.workspaces[0].layout);
        expect(restored.workspaces[0].hiddenPaneIds).not.toBe(stored.workspaces[0].hiddenPaneIds);
        expect(stored.workspaces[0].floating[8]).not.toBe(original.workspaces[0].floating[8]);
        original.workspaces[0].floating[8].x = 0;
        expect(stored.workspaces[0].floating[8].x).toBe(0.125);
    });
    it("migrates version 1 descriptors while retaining settings, overrides and selection", () => {
        const settings = newPreferences();
        settings.appearance = { ...settings.appearance, themeId: "dracula", terminalFontSize: 20 };
        settings.shortcuts = { ...settings.shortcuts, newTerminal: "Ctrl+Alt+KeyN" };
        settings.overrides.one = { appearance: { ...settings.appearance, themeId: "slterm-dark" },
            shortcuts: { ...settings.shortcuts, newTerminal: null } };
        const legacy = { ...settings, version: 1, activeWorkspaceId: "two", workspaces: [
            { id: "one", name: " Dev ", cwd: "C:\\Repo", layoutMode: "free" },
            { id: "two", name: "Tools", cwd: "D:\\Tools", layoutMode: "tiled" },
        ] };
        const before = structuredClone(legacy), migrated = parsePreferences(legacy);
        expect(migrated).toMatchObject({ version: 2, activeWorkspaceId: "two", appearance: settings.appearance,
            shortcuts: settings.shortcuts, overrides: settings.overrides });
        expect(migrated.workspaces).toEqual(legacy.workspaces.map((descriptor) => ({
            ...createWorkspace(descriptor.id, descriptor.name, descriptor.cwd), ...descriptor,
        })));
        expect(legacy).toEqual(before);
        expect(parsePreferences({ ...legacy, activeWorkspaceId: "missing" }).activeWorkspaceId).toBe("one");
        expect(parsePreferences(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    });
    it("rejects duplicate workspace, pane, split and run identities across the document", () => {
        const duplicateWorkspace = preferences();
        duplicateWorkspace.workspaces.push(duplicateWorkspace.workspaces[0]);
        expect(() => parsePreferences(duplicateWorkspace)).toThrow();
        const duplicatePane = preferences(); duplicatePane.workspaces[1].layout = pane(8);
        expect(() => parsePreferences(duplicatePane)).toThrow();
        const duplicateRun = preferences();
        duplicateRun.workspaces[1].layout = { kind: "pane", paneId: 42, title: "Duplicate run", runId: runId(8) };
        expect(() => parsePreferences(duplicateRun)).toThrow();
        const duplicateSplit = preferences();
        duplicateSplit.workspaces[1].layout = { kind: "split", splitId: "nested", axis: "horizontal", ratio: 0.5,
            first: pane(42), second: pane(43) };
        expect(() => parsePreferences(duplicateSplit)).toThrow();
    });
    it.each([
        ["unknown node", { kind: "editor", paneId: 8, title: "Unsupported" }],
        ["missing child", { kind: "split", splitId: "split", axis: "horizontal", ratio: 0.5, first: pane(8) }],
        ["invalid axis", { kind: "split", splitId: "split", axis: "diagonal", ratio: 0.5, first: pane(8), second: pane(9) }],
        ["unknown pane metadata", { ...pane(8), processId: "do not discard" }],
        ["invalid run ID", { ...pane(8), runId: "not-a-uuid" }],
        ["uppercase run ID", { ...pane(8), runId: runId(8).toUpperCase() }],
        ["zero UUID version", { ...pane(8), runId: "01234567-89ab-0cde-8fab-012345678908" }],
        ["unsupported UUID version", { ...pane(8), runId: "01234567-89ab-9cde-8fab-012345678908" }],
        ["invalid UUID variant", { ...pane(8), runId: "01234567-89ab-4cde-7fab-012345678908" }],
        ["unsafe pane ID", { ...pane(8), paneId: Number.MAX_SAFE_INTEGER + 1 }],
        ["fractional pane ID", { ...pane(8), paneId: 1.5 }],
        ["missing title", { kind: "pane", paneId: 8, runId: runId(8) }],
        ["invalid ratio", { kind: "split", splitId: "split", axis: "horizontal", ratio: Infinity, first: pane(8), second: pane(9) }],
    ])("rejects %s without altering the source document", (_, layout) => {
        const document = preferences(); document.workspaces[0].layout = layout as LayoutNode;
        const before = structuredClone(document);
        expect(() => parsePreferences(document)).toThrow();
        expect(document).toEqual(before);
    });
    it("rejects dangling selections, duplicate/unknown hidden IDs and unsafe geometry", () => {
        const base = preferences().workspaces[0];
        for (const patch of [{ activePaneId: 99 }, { zoomedPaneId: 99 }, { hiddenPaneIds: [8, 8] }, { hiddenPaneIds: [99] },
            { floating: { "08": { x: 0, y: 0, width: 1, height: 1 } } },
            { floating: { 99: { x: 0, y: 0, width: 1, height: 1 } } },
            { floating: { 8: { x: NaN, y: 0, width: 1, height: 1 } } },
            { floating: { 8: { x: 0, y: 0, width: Number.MAX_VALUE, height: 1 } } },
            { floating: { 8: { x: 0, y: 0, width: 0, height: 1 } } },
            { floating: { 8: { x: -0.1, y: 0, width: 1, height: 1 } } },
            { floating: { 8: { x: 0.5, y: 0, width: 1, height: 1 } } }]) {
            const document = { ...preferences(), workspaces: [{ ...base, ...patch }, preferences().workspaces[1]] };
            expect(() => parsePreferences(document)).toThrow();
        }
    });
    it("rejects deep or oversized documents without imposing a terminal count cap", () => {
        let layout: LayoutNode = pane(1);
        for (let index = 0; index <= maxWorkspaceLayoutDepth; index++) layout = {
            kind: "split", splitId: `depth-${index}`, axis: "horizontal", ratio: 0.5, first: layout, second: pane(index + 2),
        };
        const deep = { ...newPreferences(), activeWorkspaceId: "deep", workspaces: [{ ...createWorkspace("deep", "Deep", ""), layout }] };
        expect(() => parsePreferences(deep)).toThrow();
        const oversized = preferences(); oversized.workspaces[0].cwd = "漢".repeat(Math.ceil(maxPreferencesBytes / 3));
        expect(() => parsePreferences(oversized)).toThrow("1 MiB");
        const many = { ...newPreferences(), activeWorkspaceId: "workspace-0", workspaces: Array.from({ length: 1024 }, (_, index) => ({
            ...createWorkspace(`workspace-${index}`, "Workspace", ""), layout: pane(index + 1), activePaneId: index + 1,
        })) };
        expect(parsePreferences(many).workspaces).toHaveLength(1024);
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
    it("snapshot autosaves retain unrelated settings and reject invalid state atomically", () => {
        const preferences = newPreferences(); preferences.overrides.id = { shortcuts: { ...preferences.shortcuts, hidePane: "Ctrl+Alt+KeyH" } };
        const state = addWorkspace({ workspaces: [], activeWorkspaceId: null }, createWorkspace("id", "Dev", "C:\\Repo"));
        const changed = withDescriptors(preferences, state);
        expect(changed.overrides).toBe(preferences.overrides); expect(changed.appearance).toBe(preferences.appearance);
        expect(changed.shortcuts).toBe(preferences.shortcuts);
        expect(() => withDescriptors(preferences, { ...state, activeWorkspaceId: "missing" })).toThrow();
        expect(() => parsePreferences({ ...changed, activeWorkspaceId: "missing" })).toThrow();
        expect(preferences.workspaces).toEqual([]);
    });
});
