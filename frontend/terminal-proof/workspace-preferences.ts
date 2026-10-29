import { defaultAppearance, normalizeAppearance, type AppearanceSettings } from "./appearance-settings";
import { defaultShortcuts, normalizeShortcuts, type ShortcutBindings } from "./workspace-shortcuts";
import { createWorkspace, snapshotWorkspaceState, type Workspace, type WorkspaceState } from "./workspace-model";
import { normalizeTasks, type WorkspaceTask } from "./workspace-tasks";

// Retained for the explicit version 1 migration; version 2 stores complete workspaces.
export type WorkspaceDescriptor = Pick<Workspace, "id" | "name" | "cwd" | "layoutMode">;
export type WorkspaceOverride = { appearance?: AppearanceSettings; shortcuts?: ShortcutBindings };
export type WorkspacePreferences = {
    version: 2;
    appearance: AppearanceSettings;
    shortcuts: ShortcutBindings;
    overrides: Record<string, WorkspaceOverride>;
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
    tasks: WorkspaceTask[];
};
export const maxPreferencesBytes = 1024 * 1024;
export const newPreferences = (): WorkspacePreferences => ({ version: 2, appearance: { ...defaultAppearance },
    shortcuts: { ...defaultShortcuts }, overrides: {}, workspaces: [], activeWorkspaceId: null, tasks: [] });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function migrateDescriptors(raw: Record<string, unknown>): WorkspaceState {
    const ids = new Set<string>();
    const workspaces = (raw.workspaces as unknown[]).map((item) => {
        if (!record(item) || Object.keys(item).some((key) => !["id", "name", "cwd", "layoutMode"].includes(key)) ||
            typeof item.id !== "string" || !item.id.trim() || ids.has(item.id) ||
            typeof item.name !== "string" || typeof item.cwd !== "string") throw new Error("Workspace đã lưu không hợp lệ.");
        ids.add(item.id);
        return { ...createWorkspace(item.id, item.name, item.cwd), name: item.name,
            layoutMode: item.layoutMode === "free" ? "free" as const : "tiled" as const };
    });
    return { workspaces, activeWorkspaceId: typeof raw.activeWorkspaceId === "string" && ids.has(raw.activeWorkspaceId)
        ? raw.activeWorkspaceId : workspaces[0]?.id ?? null };
}

export function parsePreferences(value: unknown): WorkspacePreferences {
    if (value === null) return newPreferences();
    if (!record(value) || (value.version !== 1 && value.version !== 2))
        throw new Error("Phiên bản tùy chỉnh không được hỗ trợ. Dữ liệu cũ được giữ nguyên.");
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["version", "appearance", "shortcuts", "overrides", "workspaces", "activeWorkspaceId", "tasks"].includes(key)) ||
        !Object.prototype.hasOwnProperty.call(raw, "appearance") || !Object.prototype.hasOwnProperty.call(raw, "shortcuts") ||
        !Array.isArray(raw.workspaces) || !record(raw.overrides))
        throw new Error("Dữ liệu tùy chỉnh không hợp lệ. Dữ liệu cũ được giữ nguyên.");
    const state = raw.version === 1 ? migrateDescriptors(raw)
        : snapshotWorkspaceState({ workspaces: raw.workspaces, activeWorkspaceId: raw.activeWorkspaceId });
    // Match the core's document byte bound without imposing a workspace or pane count limit.
    if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > maxPreferencesBytes)
        throw new Error("Dữ liệu tùy chỉnh vượt quá giới hạn 1 MiB. Dữ liệu cũ được giữ nguyên.");
    const overrides: Record<string, WorkspaceOverride> = Object.create(null);
    for (const [id, override] of Object.entries(raw.overrides as Record<string, unknown>)) {
        if (!record(override))
            throw new Error("Tùy chỉnh workspace không hợp lệ.");
        overrides[id] = { appearance: override.appearance ? normalizeAppearance(override.appearance) : undefined,
            shortcuts: override.shortcuts ? normalizeShortcuts(override.shortcuts) : undefined };
    }
    return { version: 2, appearance: normalizeAppearance(raw.appearance), shortcuts: normalizeShortcuts(raw.shortcuts), overrides, tasks: normalizeTasks(raw.tasks), ...state };
}
// A workspace overrides the whole appearance group; removing it restores global inheritance.
export const appearanceFor = (preferences: WorkspacePreferences, id?: string) =>
    normalizeAppearance((id ? preferences.overrides[id]?.appearance : undefined) ?? preferences.appearance);
export const shortcutsFor = (preferences: WorkspacePreferences, id?: string) =>
    id ? preferences.overrides[id]?.shortcuts ?? preferences.shortcuts : preferences.shortcuts;
export function restoreDescriptors(preferences: WorkspacePreferences): WorkspaceState {
    return snapshotWorkspaceState({ workspaces: preferences.workspaces, activeWorkspaceId: preferences.activeWorkspaceId });
}
export function withDescriptors(preferences: WorkspacePreferences, state: WorkspaceState): WorkspacePreferences {
    return { ...preferences, version: 2, ...snapshotWorkspaceState(state) };
}
