// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Terminal theme picker with color swatch previews, custom theme creation, and premium card design

import { atoms, getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useSettingValue, writeSetting } from "@/app/view/waveconfig/setting-controls";
import { base64ToString, stringToBase64 } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";

const CUSTOM_THEMES_FILE = "termthemes/custom.json";

const DEFAULT_NEW_THEME: TermThemeType = {
    "display:name": "",
    "display:order": 100,
    black: "#1a1a2e",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
    gray: "#7f848e",
    cmdtext: "#f0f0f0",
    foreground: "#abb2bf",
    selectionBackground: "#3e4452",
    background: "#282c34",
    cursor: "#528bff",
};

const THEME_COLOR_GROUPS = [
    { label: "Core", fields: ["background", "foreground", "cursor", "selectionBackground"] },
    {
        label: "Base Colors",
        fields: ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"],
    },
    {
        label: "Bright Colors",
        fields: ["brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"],
    },
];

async function readCustomThemes(): Promise<Record<string, TermThemeType>> {
    const configDir = getApi().getConfigDir();
    const filePath = `${configDir}/${CUSTOM_THEMES_FILE}`;
    try {
        const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
            info: { path: filePath },
        });
        const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
        return content.trim() ? JSON.parse(content) : {};
    } catch {
        return {};
    }
}

async function writeCustomThemes(themes: Record<string, TermThemeType>): Promise<void> {
    const configDir = getApi().getConfigDir();
    const filePath = `${configDir}/${CUSTOM_THEMES_FILE}`;
    await RpcApi.FileWriteCommand(TabRpcClient, {
        info: { path: filePath },
        data64: stringToBase64(JSON.stringify(themes, null, 2)),
    });
}

// ---- Theme card with optional delete ----
const ThemeCard = memo(
    ({
        themeKey,
        theme,
        isActive,
        isCustom,
        onSelect,
        onDelete,
    }: {
        themeKey: string;
        theme: TermThemeType;
        isActive: boolean;
        isCustom?: boolean;
        onSelect: () => void;
        onDelete?: () => void;
    }) => {
        const [hovered, setHovered] = useState(false);
        const colors = [
            theme.black,
            theme.red,
            theme.green,
            theme.yellow,
            theme.blue,
            theme.magenta,
            theme.cyan,
            theme.white,
        ];
        const displayName = (theme as any)["display:name"] || themeKey;

        return (
            <button
                onClick={onSelect}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    padding: "10px",
                    borderRadius: "8px",
                    border: isActive
                        ? "2px solid var(--accent-color)"
                        : "1px solid var(--border-color)",
                    background: isActive
                        ? "rgba(var(--accent-color-rgb, 88, 193, 66), 0.08)"
                        : "transparent",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    transform: "scale(1)",
                    outline: "none",
                    position: "relative",
                }}
                onMouseEnter={(e) => {
                    setHovered(true);
                    if (!isActive) {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-color)";
                        (e.currentTarget as HTMLElement).style.transform = "scale(1.03)";
                        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
                    }
                }}
                onMouseLeave={(e) => {
                    setHovered(false);
                    if (!isActive) {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
                        (e.currentTarget as HTMLElement).style.boxShadow = "none";
                    }
                }}
            >
                {isCustom && hovered && onDelete && (
                    <div
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        style={{
                            position: "absolute",
                            top: "4px",
                            right: "4px",
                            width: "18px",
                            height: "18px",
                            borderRadius: "50%",
                            background: "rgba(229, 77, 46, 0.85)",
                            color: "#fff",
                            fontSize: "10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            zIndex: 1,
                        }}
                    >
                        ✕
                    </div>
                )}
                {/* Terminal-style mini preview */}
                <div
                    style={{
                        background: theme.background || "#000",
                        borderRadius: "5px",
                        padding: "6px 8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "3px",
                        width: "100%",
                    }}
                >
                    <div style={{ display: "flex", gap: "3px", marginBottom: "2px" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: theme.red || "#f55" }} />
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: theme.yellow || "#ff0" }} />
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: theme.green || "#0f0" }} />
                    </div>
                    <div
                        style={{
                            display: "flex",
                            gap: "2px",
                            flexWrap: "wrap",
                        }}
                    >
                        {colors.map((c, i) => (
                            <div
                                key={i}
                                style={{
                                    width: "14px",
                                    height: "10px",
                                    borderRadius: "2px",
                                    background: c || "#333",
                                }}
                            />
                        ))}
                    </div>
                    <span
                        style={{
                            fontFamily: "monospace",
                            fontSize: "9px",
                            color: theme.foreground || "#ccc",
                            opacity: 0.7,
                            marginTop: "1px",
                        }}
                    >
                        $ hello world
                    </span>
                </div>
                {/* Theme name */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                    }}
                >
                    {isActive && (
                        <div
                            style={{
                                width: "6px",
                                height: "6px",
                                borderRadius: "50%",
                                background: "var(--accent-color)",
                                flexShrink: 0,
                            }}
                        />
                    )}
                    <span
                        style={{
                            fontSize: "11px",
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? "var(--accent-color)" : "var(--secondary-text-color)",
                        }}
                    >
                        {displayName}
                    </span>
                </div>
            </button>
        );
    }
);
ThemeCard.displayName = "ThemeCard";

// ---- Create theme form ----
const CreateThemeForm = memo(
    ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => {
        const [themeName, setThemeName] = useState("");
        const [colors, setColors] = useState<TermThemeType>({ ...DEFAULT_NEW_THEME });
        const [saving, setSaving] = useState(false);

        const updateColor = useCallback((field: string, value: string) => {
            setColors((prev) => ({ ...prev, [field]: value }));
        }, []);

        const handleSave = useCallback(async () => {
            if (!themeName.trim()) return;
            setSaving(true);
            try {
                const sanitizedKey = themeName
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "-")
                    .replace(/-+/g, "-")
                    .replace(/^-|-$/g, "");
                const key = `custom-${sanitizedKey}`;
                const existing = await readCustomThemes();
                existing[key] = { ...colors, "display:name": themeName.trim() };
                await writeCustomThemes(existing);
                writeSetting("term:theme", key);
                onSave();
            } finally {
                setSaving(false);
            }
        }, [themeName, colors, onSave]);

        return (
            <div
                style={{
                    gridColumn: "1 / -1",
                    border: "1px solid var(--accent-color)",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    background: "rgba(var(--accent-color-rgb, 88, 193, 66), 0.03)",
                }}
            >
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent-color)" }}>
                    Create Custom Theme
                </div>

                {/* Theme name */}
                <input
                    type="text"
                    value={themeName}
                    onChange={(e) => setThemeName(e.target.value)}
                    placeholder="Theme name..."
                    style={{
                        padding: "6px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--form-element-border-color)",
                        background: "var(--form-element-bg-color)",
                        color: "var(--main-text-color)",
                        fontSize: "12px",
                        outline: "none",
                    }}
                />

                {/* Live mini preview */}
                <div
                    style={{
                        background: colors.background || "#000",
                        borderRadius: "6px",
                        padding: "8px 10px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                    }}
                >
                    <div style={{ display: "flex", gap: "3px" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: colors.red }} />
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: colors.yellow }} />
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: colors.green }} />
                    </div>
                    <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
                        {[colors.black, colors.red, colors.green, colors.yellow, colors.blue, colors.magenta, colors.cyan, colors.white].map(
                            (c, i) => (
                                <div key={i} style={{ width: 14, height: 10, borderRadius: 2, background: c || "#333" }} />
                            )
                        )}
                    </div>
                    <span style={{ fontFamily: "monospace", fontSize: "9px", color: colors.foreground, opacity: 0.7 }}>
                        $ hello world
                    </span>
                </div>

                {/* Color groups */}
                {THEME_COLOR_GROUPS.map((group) => (
                    <div key={group.label}>
                        <div
                            style={{
                                fontSize: "10px",
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "var(--secondary-text-color)",
                                marginBottom: "6px",
                            }}
                        >
                            {group.label}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {group.fields.map((field) => (
                                <label
                                    key={field}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "4px",
                                        fontSize: "10px",
                                        color: "var(--secondary-text-color)",
                                    }}
                                >
                                    <input
                                        type="color"
                                        value={(colors as any)[field] || "#000000"}
                                        onChange={(e) => updateColor(field, e.target.value)}
                                        style={{
                                            width: "22px",
                                            height: "22px",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "4px",
                                            padding: 0,
                                            cursor: "pointer",
                                            background: "transparent",
                                        }}
                                    />
                                    {field}
                                </label>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Actions */}
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: "5px 14px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-color)",
                            background: "transparent",
                            color: "var(--secondary-text-color)",
                            fontSize: "11px",
                            cursor: "pointer",
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!themeName.trim() || saving}
                        style={{
                            padding: "5px 14px",
                            borderRadius: "6px",
                            border: "1px solid var(--accent-color)",
                            background: "rgba(var(--accent-color-rgb, 88, 193, 66), 0.15)",
                            color: "var(--accent-color)",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: themeName.trim() ? "pointer" : "not-allowed",
                            opacity: themeName.trim() ? 1 : 0.5,
                        }}
                    >
                        {saving ? "Saving..." : "Save Theme"}
                    </button>
                </div>
            </div>
        );
    }
);
CreateThemeForm.displayName = "CreateThemeForm";

// ---- Create theme button ----
const CreateThemeButton = memo(({ onClick }: { onClick: () => void }) => {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "10px",
                borderRadius: "8px",
                border: "1px dashed var(--border-color)",
                cursor: "pointer",
                transition: "all 0.2s ease",
                background: "transparent",
                minHeight: "100px",
                outline: "none",
            }}
            onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-color)";
                (e.currentTarget as HTMLElement).style.background = "rgba(var(--accent-color-rgb, 88, 193, 66), 0.05)";
            }}
            onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--secondary-text-color)" strokeWidth="1.5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: "10px", color: "var(--secondary-text-color)" }}>Create Theme</span>
        </button>
    );
});
CreateThemeButton.displayName = "CreateThemeButton";

// ---- Main picker ----
const ThemePicker = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const currentTheme = useSettingValue("term:theme") ?? "default-dark";
    const themes = fullConfig?.termthemes ?? {};
    const [showForm, setShowForm] = useState(false);

    const sorted = useMemo(() => {
        return Object.entries(themes).sort(([, a], [, b]) => {
            const oa = (a as any)["display:order"] ?? 999;
            const ob = (b as any)["display:order"] ?? 999;
            return oa - ob;
        });
    }, [themes]);

    const handleDeleteCustomTheme = useCallback(
        async (themeKey: string) => {
            const existing = await readCustomThemes();
            delete existing[themeKey];
            await writeCustomThemes(existing);
            if (currentTheme === themeKey) {
                writeSetting("term:theme", "default-dark");
            }
        },
        [currentTheme]
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 @[500px]:grid-cols-3 @[700px]:grid-cols-4">
                {sorted.map(([key, theme]) => (
                    <ThemeCard
                        key={key}
                        themeKey={key}
                        theme={theme}
                        isActive={currentTheme === key}
                        isCustom={key.startsWith("custom-")}
                        onSelect={() => writeSetting("term:theme", key)}
                        onDelete={() => handleDeleteCustomTheme(key)}
                    />
                ))}
                <CreateThemeButton onClick={() => setShowForm(true)} />
                {showForm && (
                    <CreateThemeForm
                        onSave={() => setShowForm(false)}
                        onCancel={() => setShowForm(false)}
                    />
                )}
            </div>
        </div>
    );
});
ThemePicker.displayName = "ThemePicker";

export { ThemePicker };
