import { defaultAppearance, normalizeAppearance, type AppearanceSettings } from "./appearance-settings";
import { defaultShortcuts, normalizeShortcuts, type ShortcutBindings } from "./workspace-shortcuts";
import { createWorkspace, type Workspace, type WorkspaceState } from "./workspace-model";

export type WorkspaceDescriptor = Pick<Workspace, "id" | "name" | "cwd" | "layoutMode">;
export type WorkspaceOverride = { appearance?: AppearanceSettings; shortcuts?: ShortcutBindings };
export type WorkspacePreferences = {
    version: 1;
    appearance: AppearanceSettings;
    shortcuts: ShortcutBindings;
    overrides: Record<string, WorkspaceOverride>;
    workspaces: WorkspaceDescriptor[];
    activeWorkspaceId: string | null;
};
export const newPreferences = (): WorkspacePreferences => ({ version: 1, appearance: { ...defaultAppearance },
    shortcuts: { ...defaultShortcuts }, overrides: {}, workspaces: [], activeWorkspaceId: null });
export function parsePreferences(value: unknown): WorkspacePreferences {
    if (value === null) return newPreferences();
    if (!value || typeof value !== "object" || (value as WorkspacePreferences).version !== 1)
        throw new Error("Phiên bản tùy chỉnh không được hỗ trợ. Dữ liệu cũ được giữ nguyên.");
    const raw = value as WorkspacePreferences;
    if (!Object.prototype.hasOwnProperty.call(raw, "appearance") || !Object.prototype.hasOwnProperty.call(raw, "shortcuts") ||
        !Array.isArray(raw.workspaces) || !raw.overrides || typeof raw.overrides !== "object" || Array.isArray(raw.overrides))
        throw new Error("Dữ liệu tùy chỉnh không hợp lệ. Dữ liệu cũ được giữ nguyên.");
    const ids = new Set<string>();
    const workspaces = raw.workspaces.map((item) => {
        if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
            typeof item.name !== "string" || typeof item.cwd !== "string") throw new Error("Workspace đã lưu không hợp lệ.");
        ids.add(item.id);
        return { id: item.id, name: item.name.slice(0, 128), cwd: item.cwd, layoutMode: item.layoutMode === "free" ? "free" as const : "tiled" as const };
    });
    const overrides: Record<string, WorkspaceOverride> = Object.create(null);
    for (const [id, override] of Object.entries(raw.overrides)) {
        if (!override || typeof override !== "object" || Array.isArray(override))
            throw new Error("Tùy chỉnh workspace không hợp lệ.");
        overrides[id] = { appearance: override.appearance ? normalizeAppearance(override.appearance) : undefined,
            shortcuts: override.shortcuts ? normalizeShortcuts(override.shortcuts) : undefined };
    }
    return { version: 1, appearance: normalizeAppearance(raw.appearance), shortcuts: normalizeShortcuts(raw.shortcuts), overrides,
        workspaces, activeWorkspaceId: workspaces.some((item) => item.id === raw.activeWorkspaceId) ? raw.activeWorkspaceId : workspaces[0]?.id ?? null };
}
// A workspace overrides the whole appearance group; removing it restores global inheritance.
export const appearanceFor = (preferences: WorkspacePreferences, id?: string) =>
    normalizeAppearance((id ? preferences.overrides[id]?.appearance : undefined) ?? preferences.appearance);
export const shortcutsFor = (preferences: WorkspacePreferences, id?: string) =>
    id ? preferences.overrides[id]?.shortcuts ?? preferences.shortcuts : preferences.shortcuts;
export function restoreDescriptors(preferences: WorkspacePreferences): WorkspaceState {
    return { workspaces: preferences.workspaces.map((item) => ({ ...createWorkspace(item.id, item.name, item.cwd), layoutMode: item.layoutMode })),
        activeWorkspaceId: preferences.activeWorkspaceId };
}
export function withDescriptors(preferences: WorkspacePreferences, state: WorkspaceState): WorkspacePreferences {
    return { ...preferences, workspaces: state.workspaces.map(({ id, name, cwd, layoutMode }) => ({ id, name, cwd, layoutMode })),
        activeWorkspaceId: state.activeWorkspaceId };
}
