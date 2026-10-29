import { appearancePresets } from "./appearance-presets";
import { normalizeAppearance, type AppearanceSettings } from "./appearance-settings";

export type LegacyImportPreview = {
    sourceName: string;
    appearance: Partial<AppearanceSettings>;
    importedFields: string[];
    skippedFields: string[];
    warnings: string[];
};

const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const knownTheme = (value: unknown) => {
    const name = string(value)?.toLowerCase();
    if (!name) return undefined;
    return appearancePresets.find((preset) => preset.id.toLowerCase() === name || preset.name.toLowerCase() === name)?.id;
};

/**
 * Read a captured legacy JSON file without resolving $ENV references or
 * touching secrets. The importer intentionally accepts settings only; old
 * connections, commands and workspace graphs need a separate consented
 * migration surface.
 */
export function parseLegacyProfileJson(sourceName: string, text: string): LegacyImportPreview {
    if (new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024) throw new Error("File profile cũ vượt quá 4 MiB.");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error("File profile cũ không phải JSON hợp lệ."); }
    const root = object(parsed);
    const raw = object(root.settings ?? root.term ?? root);
    const appearance: Partial<AppearanceSettings> = {};
    const importedFields: string[] = [];
    const skippedFields: string[] = [];
    const warnings: string[] = [];
    const use = (field: keyof AppearanceSettings, value: unknown, label: string) => {
        if (value === undefined) return;
        appearance[field] = value as never;
        importedFields.push(label);
    };
    const skip = (field: string) => { if (!skippedFields.includes(field)) skippedFields.push(field); };

    const fontSize = number(raw.fontsize ?? raw.fontSize ?? raw["term:fontsize"]);
    if (fontSize !== undefined) use("terminalFontSize", fontSize, "cỡ chữ terminal");
    const fontFamily = string(raw.fontfamily ?? raw.fontFamily ?? raw["term:fontfamily"]);
    if (fontFamily) use("terminalFontFamily", fontFamily, "font terminal");
    const scrollback = number(raw.scrollback ?? raw["term:scrollback"]);
    if (scrollback !== undefined) use("scrollback", scrollback, "scrollback");
    const themeValue = raw.theme ?? raw.themeId ?? root.theme ?? root.themeId;
    const theme = knownTheme(themeValue);
    if (theme) use("themeId", theme, "theme");
    else if (themeValue !== undefined) {
        skip("theme");
        warnings.push("Theme cũ không có tên tương ứng trong SLTerm; giữ theme hiện tại.");
    }
    for (const key of Object.keys(raw)) {
        if (/token|secret|password|api.?key|command|script|env/i.test(key)) {
            skip(key);
            warnings.push(`Bỏ qua trường nhạy cảm hoặc có thể chạy lệnh: ${key}.`);
        }
    }
    if (root.connections !== undefined) {
        skip("connections");
        warnings.push("Connections cũ chưa được kích hoạt; hãy đăng nhập/kết nối lại thủ công.");
    }
    if (root.workspaces !== undefined || root.tabs !== undefined) {
        skip(root.workspaces !== undefined ? "workspaces" : "tabs");
        warnings.push("Workspace/tab cũ chưa được chuyển tự động để tránh làm sai layout và process.");
    }
    const safe = normalizeAppearance({ ...appearance });
    return { sourceName, appearance: safe, importedFields, skippedFields, warnings };
}
