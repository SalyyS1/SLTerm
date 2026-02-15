// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Terminal theme picker with color swatch previews and premium card design

import { atoms } from "@/app/store/global";
import { useSettingValue, writeSetting } from "@/app/view/waveconfig/setting-controls";
import { useAtomValue } from "jotai";
import { memo, useMemo } from "react";

const ThemeCard = memo(
    ({
        themeKey,
        theme,
        isActive,
        onSelect,
    }: {
        themeKey: string;
        theme: TermThemeType;
        isActive: boolean;
        onSelect: () => void;
    }) => {
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
                }}
                onMouseEnter={(e) => {
                    if (!isActive) {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-color)";
                        (e.currentTarget as HTMLElement).style.transform = "scale(1.03)";
                        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
                    }
                }}
                onMouseLeave={(e) => {
                    if (!isActive) {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
                        (e.currentTarget as HTMLElement).style.boxShadow = "none";
                    }
                }}
            >
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

const ThemePicker = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const currentTheme = useSettingValue("term:theme") ?? "default-dark";
    const themes = fullConfig?.termthemes ?? {};
    const sorted = useMemo(() => {
        return Object.entries(themes).sort(([, a], [, b]) => {
            const oa = (a as any)["display:order"] ?? 999;
            const ob = (b as any)["display:order"] ?? 999;
            return oa - ob;
        });
    }, [themes]);

    return (
        <div className="grid grid-cols-2 gap-2 @[500px]:grid-cols-3 @[700px]:grid-cols-4">
            {sorted.map(([key, theme]) => (
                <ThemeCard
                    key={key}
                    themeKey={key}
                    theme={theme}
                    isActive={currentTheme === key}
                    onSelect={() => writeSetting("term:theme", key)}
                />
            ))}
        </div>
    );
});
ThemePicker.displayName = "ThemePicker";

export { ThemePicker };
