// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Visual editor for presets/bg.json — grid of background preset cards with live CSS preview

import { getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, stringToBase64 } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";

type BgPreset = {
    bg?: string;
    "bg:opacity"?: number;
    "bg:blendmode"?: string;
    [key: string]: any;
};

type BgPresetsData = Record<string, BgPreset>;

const BLEND_MODES = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "soft-light",
    "hard-light",
];

// ---- Single BG preset card ----
const BgPresetCard = memo(
    ({
        presetKey,
        preset,
        isExpanded,
        onToggle,
        onUpdate,
        onDelete,
    }: {
        presetKey: string;
        preset: BgPreset;
        isExpanded: boolean;
        onToggle: () => void;
        onUpdate: (key: string, value: any) => void;
        onDelete: () => void;
    }) => {
        const bgValue = preset.bg || "";
        const opacity = preset["bg:opacity"] ?? 1;
        const blendMode = preset["bg:blendmode"] || "normal";
        const displayName = presetKey.replace(/^bg@/, "");

        return (
            <div
                style={{
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    overflow: "hidden",
                    animation: "fadeIn 0.2s ease",
                }}
            >
                {/* Header with live preview */}
                <button
                    onClick={onToggle}
                    style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "8px 14px",
                        background: isExpanded ? "var(--panel-bg-color)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--main-text-color)",
                        transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                        if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "var(--hover-bg-color)";
                    }}
                    onMouseLeave={(e) => {
                        if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                >
                    {/* Preview swatch */}
                    <div
                        style={{
                            width: "40px",
                            height: "28px",
                            borderRadius: "4px",
                            border: "1px solid var(--border-color)",
                            background: bgValue || "var(--main-bg-color)",
                            opacity: opacity,
                            flexShrink: 0,
                        }}
                    />
                    <div style={{ flex: 1, textAlign: "left" }}>
                        <div style={{ fontWeight: 600, fontSize: "13px" }}>{displayName}</div>
                        <div
                            style={{
                                fontSize: "10px",
                                color: "var(--secondary-text-color)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                maxWidth: "250px",
                            }}
                        >
                            {bgValue || "No background set"}
                        </div>
                    </div>
                    <i
                        className={`fa fa-chevron-${isExpanded ? "up" : "down"}`}
                        style={{ fontSize: "10px", color: "var(--secondary-text-color)" }}
                    />
                </button>

                {/* Expanded form */}
                {isExpanded && (
                    <div
                        style={{
                            padding: "12px 14px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px",
                            borderTop: "1px solid var(--border-color)",
                            animation: "fadeIn 0.15s ease",
                        }}
                    >
                        {/* Live preview */}
                        <div
                            style={{
                                width: "100%",
                                height: "80px",
                                borderRadius: "6px",
                                border: "1px solid var(--border-color)",
                                background: bgValue || "var(--main-bg-color)",
                                opacity: opacity,
                                mixBlendMode: blendMode as any,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        />

                        {/* Background value */}
                        <div>
                            <div
                                style={{
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "var(--accent-color)",
                                    marginBottom: "6px",
                                }}
                            >
                                BACKGROUND
                            </div>
                            <textarea
                                value={bgValue}
                                onChange={(e) => onUpdate("bg", e.target.value || undefined)}
                                placeholder="CSS background value... (color, gradient, url(), etc.)"
                                rows={2}
                                className="text-sm"
                                style={{
                                    width: "100%",
                                    padding: "6px 8px",
                                    borderRadius: "4px",
                                    background: "var(--form-element-bg-color)",
                                    border: "1px solid var(--form-element-border-color)",
                                    color: "var(--main-text-color)",
                                    outline: "none",
                                    resize: "vertical",
                                    fontFamily: "monospace",
                                    fontSize: "11px",
                                }}
                            />
                        </div>

                        {/* Opacity Slider */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>Opacity</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={opacity}
                                    onChange={(e) => onUpdate("bg:opacity", Number(e.target.value))}
                                    className="accent-[var(--accent-color)]"
                                    style={{ width: "100px" }}
                                />
                                <span
                                    style={{
                                        fontSize: "11px",
                                        color: "var(--secondary-text-color)",
                                        width: "35px",
                                        textAlign: "right",
                                    }}
                                >
                                    {Math.round(opacity * 100)}%
                                </span>
                            </div>
                        </div>

                        {/* Blend Mode */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>Blend Mode</span>
                            <select
                                value={blendMode}
                                onChange={(e) =>
                                    onUpdate("bg:blendmode", e.target.value === "normal" ? undefined : e.target.value)
                                }
                                className="text-sm cursor-pointer"
                                style={{
                                    padding: "4px 8px",
                                    borderRadius: "4px",
                                    background: "var(--form-element-bg-color)",
                                    border: "1px solid var(--form-element-border-color)",
                                    color: "var(--main-text-color)",
                                    outline: "none",
                                }}
                            >
                                {BLEND_MODES.map((mode) => (
                                    <option key={mode} value={mode}>
                                        {mode}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Delete */}
                        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "10px" }}>
                            <button
                                onClick={() => {
                                    if (confirm(`Delete preset "${displayName}"?`)) {
                                        onDelete();
                                    }
                                }}
                                className="text-xs cursor-pointer"
                                style={{
                                    padding: "4px 10px",
                                    borderRadius: "4px",
                                    border: "1px solid rgba(229, 77, 46, 0.3)",
                                    background: "transparent",
                                    color: "var(--error-color)",
                                    transition: "all 0.15s ease",
                                }}
                                onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "rgba(229, 77, 46, 0.1)";
                                }}
                                onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "transparent";
                                }}
                            >
                                <i className="fa fa-trash" style={{ marginRight: "4px" }} />
                                Delete Preset
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }
);
BgPresetCard.displayName = "BgPresetCard";

// ---- Main editor ----
const BgPresetsEditor = memo(({ model }: { model: any }) => {
    const [presets, setPresets] = useState<BgPresetsData>({});
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const configDir = getApi().getConfigDir();
    const filePath = `${configDir}/presets/bg.json`;

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: filePath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            if (content.trim()) {
                setPresets(JSON.parse(content));
            } else {
                setPresets({});
            }
        } catch (err: any) {
            setError(`Failed to load: ${err.message || String(err)}`);
            setPresets({});
        } finally {
            setLoading(false);
        }
    }, [filePath]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const saveData = useCallback(
        async (data: BgPresetsData) => {
            setSaving(true);
            setError(null);
            try {
                const cleaned: BgPresetsData = {};
                for (const [key, val] of Object.entries(data)) {
                    const p: BgPreset = {};
                    for (const [k, v] of Object.entries(val)) {
                        if (v !== undefined && v !== "") {
                            (p as any)[k] = v;
                        }
                    }
                    cleaned[key] = p;
                }

                const formatted = JSON.stringify(cleaned, null, 2);
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: filePath },
                    data64: stringToBase64(formatted),
                });
                setPresets(cleaned);
            } catch (err: any) {
                setError(`Failed to save: ${err.message || String(err)}`);
            } finally {
                setSaving(false);
            }
        },
        [filePath]
    );

    const handleAdd = useCallback(() => {
        let key = "bg@new-preset";
        let i = 1;
        while (presets[key]) {
            key = `bg@new-preset-${i++}`;
        }

        const newPreset: BgPreset = {
            bg: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
            "bg:opacity": 0.85,
        };

        const updated = { ...presets, [key]: newPreset };
        setPresets(updated);
        setExpandedKey(key);
        saveData(updated);
    }, [presets, saveData]);

    const handleUpdate = useCallback(
        (presetKey: string, fieldKey: string, value: any) => {
            const updated = {
                ...presets,
                [presetKey]: {
                    ...presets[presetKey],
                    [fieldKey]: value,
                },
            };
            setPresets(updated);
            saveData(updated);
        },
        [presets, saveData]
    );

    const handleDelete = useCallback(
        (presetKey: string) => {
            const { [presetKey]: _, ...rest } = presets;
            setPresets(rest);
            if (expandedKey === presetKey) setExpandedKey(null);
            saveData(rest);
        },
        [presets, expandedKey, saveData]
    );

    const presetEntries = Object.entries(presets);

    if (loading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
                <i
                    className="fa fa-spinner fa-spin"
                    style={{ fontSize: "20px", color: "var(--secondary-text-color)" }}
                />
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "16px",
                overflow: "auto",
                height: "100%",
            }}
        >
            {/* Header */}
            <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}
            >
                <div>
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>Background Presets</div>
                    <div style={{ fontSize: "11px", color: "var(--secondary-text-color)" }}>
                        {presetEntries.length} preset{presetEntries.length !== 1 ? "s" : ""}
                    </div>
                </div>
                <button
                    onClick={handleAdd}
                    className="cursor-pointer"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--accent-color)",
                        background: "rgba(103, 230, 214, 0.08)",
                        color: "var(--accent-color)",
                        fontSize: "12px",
                        fontWeight: 500,
                        transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(103, 230, 214, 0.15)";
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(103, 230, 214, 0.08)";
                    }}
                >
                    <i className="fa fa-plus" style={{ fontSize: "10px" }} />
                    Add Preset
                </button>
            </div>

            {/* Error */}
            {error && (
                <div
                    style={{
                        padding: "8px 12px",
                        borderRadius: "6px",
                        background: "rgba(229, 77, 46, 0.1)",
                        border: "1px solid rgba(229, 77, 46, 0.3)",
                        color: "var(--error-color)",
                        fontSize: "12px",
                    }}
                >
                    <i className="fa fa-exclamation-triangle" style={{ marginRight: "6px" }} />
                    {error}
                </div>
            )}

            {/* Saving indicator */}
            {saving && (
                <div style={{ fontSize: "11px", color: "var(--accent-color)", textAlign: "center" }}>
                    <i className="fa fa-spinner fa-spin" style={{ marginRight: "4px" }} />
                    Saving...
                </div>
            )}

            {/* Preset cards */}
            {presetEntries.length === 0 ? (
                <div
                    style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--secondary-text-color)",
                        fontSize: "13px",
                    }}
                >
                    <i
                        className="fa fa-image"
                        style={{ fontSize: "32px", marginBottom: "12px", display: "block", opacity: 0.3 }}
                    />
                    No background presets yet.
                    <br />
                    Click "Add Preset" to create one.
                </div>
            ) : (
                presetEntries.map(([key, data]) => (
                    <BgPresetCard
                        key={key}
                        presetKey={key}
                        preset={data}
                        isExpanded={expandedKey === key}
                        onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
                        onUpdate={(field, value) => handleUpdate(key, field, value)}
                        onDelete={() => handleDelete(key)}
                    />
                ))
            )}
        </div>
    );
});
BgPresetsEditor.displayName = "BgPresetsEditor";

export { BgPresetsEditor };
