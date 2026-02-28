// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Background preset picker with live CSS previews + custom image/color support

import { atoms, getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useSettingValue, writeSetting } from "@/app/view/waveconfig/setting-controls";
import { base64ToString, stringToBase64 } from "@/util/util";
import { processBackgroundUrls } from "@/util/waveutil";
import { useAtomValue } from "jotai";
import { memo, useCallback, useMemo, useRef, useState } from "react";

const BgPresetCard = memo(
    ({
        presetKey,
        preset,
        isActive,
        onSelect,
        onDelete,
    }: {
        presetKey: string;
        preset: MetaType;
        isActive: boolean;
        onSelect: () => void;
        onDelete?: () => void;
    }) => {
        const bgStyle: React.CSSProperties = {};
        const rawBg = preset["bg"] as string;
        if (rawBg) {
            const processed = processBackgroundUrls(rawBg);
            if (processed) {
                bgStyle.background = processed;
                bgStyle.backgroundSize = "cover";
                bgStyle.backgroundPosition = "center";
                bgStyle.backgroundRepeat = "no-repeat";
            }
        }
        bgStyle.opacity = (preset["bg:opacity"] as number) ?? 0.5;
        if (preset["bg:blendmode"]) {
            bgStyle.backgroundBlendMode = preset["bg:blendmode"] as string;
        }

        const displayName = (preset as any)["display:name"] || presetKey.replace("bg@", "");

        return (
            <div style={{ position: "relative" }}>
                <button
                    onClick={onSelect}
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "4px",
                        padding: "6px",
                        borderRadius: "8px",
                        border: isActive ? "2px solid var(--accent-color)" : "1px solid var(--border-color)",
                        background: isActive ? "rgba(var(--accent-color-rgb, 88, 193, 66), 0.08)" : "transparent",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        outline: "none",
                        width: "100%",
                    }}
                    onMouseEnter={(e) => {
                        if (!isActive) {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-color)";
                            (e.currentTarget as HTMLElement).style.transform = "scale(1.03)";
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!isActive) {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                            (e.currentTarget as HTMLElement).style.transform = "scale(1)";
                        }
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            height: "48px",
                            borderRadius: "5px",
                            overflow: "hidden",
                            background: "#111",
                        }}
                    >
                        <div style={{ ...bgStyle, width: "100%", height: "100%" }} />
                    </div>
                    <span
                        style={{
                            fontSize: "10px",
                            color: isActive ? "var(--accent-color)" : "var(--secondary-text-color)",
                            textAlign: "center",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            width: "100%",
                            fontWeight: isActive ? 600 : 400,
                        }}
                    >
                        {displayName}
                    </span>
                    {isActive && (
                        <div
                            style={{
                                width: "5px",
                                height: "5px",
                                borderRadius: "50%",
                                background: "var(--accent-color)",
                            }}
                        />
                    )}
                </button>
                {onDelete && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        title="Remove background"
                        style={{
                            position: "absolute",
                            top: "2px",
                            right: "2px",
                            width: "18px",
                            height: "18px",
                            borderRadius: "50%",
                            border: "none",
                            background: "rgba(229, 77, 46, 0.85)",
                            color: "#fff",
                            fontSize: "10px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            lineHeight: 1,
                            padding: 0,
                            zIndex: 2,
                            transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "rgba(229, 77, 46, 1)";
                            (e.currentTarget as HTMLElement).style.transform = "scale(1.15)";
                        }}
                        onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "rgba(229, 77, 46, 0.85)";
                            (e.currentTarget as HTMLElement).style.transform = "scale(1)";
                        }}
                    >
                        ✕
                    </button>
                )}
            </div>
        );
    }
);
BgPresetCard.displayName = "BgPresetCard";

const CustomImageButton = memo(({ onImageSelected }: { onImageSelected: (filePath: string) => void }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const handleClick = useCallback(() => fileRef.current?.click(), []);
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const filePath = getApi().getPathForFile(file);
            if (!filePath) return;
            onImageSelected(filePath);
            if (fileRef.current) fileRef.current.value = "";
        },
        [onImageSelected]
    );

    return (
        <>
            <input
                ref={fileRef}
                type="file"
                accept="image/*,.gif"
                onChange={handleChange}
                style={{ display: "none" }}
            />
            <button
                onClick={handleClick}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "6px",
                    borderRadius: "8px",
                    border: "1px dashed var(--border-color)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    background: "transparent",
                    minHeight: "70px",
                    outline: "none",
                }}
                onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-color)";
                    (e.currentTarget as HTMLElement).style.background =
                        "rgba(var(--accent-color-rgb, 88, 193, 66), 0.05)";
                }}
                onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
            >
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--secondary-text-color)"
                    strokeWidth="1.5"
                >
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: "9px", color: "var(--secondary-text-color)" }}>Add Image</span>
            </button>
        </>
    );
});
CustomImageButton.displayName = "CustomImageButton";

// Native OS color picker + Text input for RGB/Gradients
const CustomColorButton = memo(({ onColorSubmit }: { onColorSubmit: (css: string) => void }) => {
    const colorRef = useRef<HTMLInputElement>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState("");

    const handleColorClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        colorRef.current?.click();
    }, []);

    const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    }, []);

    const handleSave = useCallback(() => {
        const val = inputValue.trim();
        if (val) {
            onColorSubmit(val);
            setInputValue("");
            setIsEditing(false);
        }
    }, [inputValue, onColorSubmit]);

    if (!isEditing) {
        return (
            <button
                onClick={() => setIsEditing(true)}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "6px",
                    borderRadius: "8px",
                    border: "1px dashed var(--border-color)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    background: "transparent",
                    minHeight: "70px",
                    outline: "none",
                    width: "100%",
                }}
                onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-color)";
                    (e.currentTarget as HTMLElement).style.background =
                        "rgba(var(--accent-color-rgb, 88, 193, 66), 0.05)";
                }}
                onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="9" stroke="var(--secondary-text-color)" />
                    <circle cx="12" cy="8" r="2" fill="#ff6b6b" />
                    <circle cx="8.5" cy="13" r="2" fill="#4ecdc4" />
                    <circle cx="15.5" cy="13" r="2" fill="#ffe66d" />
                </svg>
                <span style={{ fontSize: "9px", color: "var(--secondary-text-color)" }}>Add Color</span>
            </button>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                padding: "6px",
                borderRadius: "8px",
                border: "1px solid var(--accent-color)",
                background: "rgba(var(--accent-color-rgb, 88, 193, 66), 0.05)",
                position: "relative",
            }}
        >
            <input
                ref={colorRef}
                type="color"
                value={inputValue.startsWith("#") ? inputValue : "#1a1a2e"}
                onChange={handleColorChange}
                style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
            />

            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <div
                    onClick={handleColorClick}
                    style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "4px",
                        background: inputValue || "#1a1a2e",
                        cursor: "pointer",
                        border: "1px solid var(--border-color)",
                        flexShrink: 0,
                    }}
                    title="Open native color picker"
                />
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave();
                        if (e.key === "Escape") setIsEditing(false);
                    }}
                    placeholder="#hex, rgb(..)"
                    autoFocus
                    style={{
                        width: "100%",
                        padding: "4px 6px",
                        borderRadius: "4px",
                        border: "1px solid var(--border-color)",
                        background: "var(--form-element-bg-color)",
                        color: "var(--main-text-color)",
                        fontSize: "10px",
                        outline: "none",
                        fontFamily: "monospace",
                    }}
                />
            </div>

            <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
                <button
                    onClick={handleSave}
                    disabled={!inputValue.trim()}
                    style={{
                        flex: 1,
                        padding: "3px",
                        borderRadius: "4px",
                        border: "1px solid var(--accent-color)",
                        background: "rgba(var(--accent-color-rgb, 88, 193, 66), 0.15)",
                        color: "var(--accent-color)",
                        fontSize: "9px",
                        cursor: inputValue.trim() ? "pointer" : "not-allowed",
                        opacity: inputValue.trim() ? 1 : 0.5,
                    }}
                >
                    Save
                </button>
                <button
                    onClick={() => setIsEditing(false)}
                    style={{
                        flex: 1,
                        padding: "3px",
                        borderRadius: "4px",
                        border: "1px solid var(--border-color)",
                        background: "transparent",
                        color: "var(--secondary-text-color)",
                        fontSize: "9px",
                        cursor: "pointer",
                    }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
});
CustomColorButton.displayName = "CustomColorButton";

// Apply preset meta (bg keys) to the current tab
function applyBgToTab(tabId: string, bgValue: string | null, opacity?: number) {
    const bgMeta: MetaType = {};
    if (bgValue) {
        bgMeta["bg"] = bgValue;
        bgMeta["bg:opacity"] = opacity ?? 0.6;
    } else {
        bgMeta["bg"] = null;
        bgMeta["bg:opacity"] = null;
        bgMeta["bg:blendmode"] = null;
    }
    RpcApi.SetMetaCommand(TabRpcClient, { oref: `tab:${tabId}`, meta: bgMeta });
}

// Helper: read, modify, write bg.json
async function updateBgJson(fn: (presets: Record<string, any>) => Record<string, any>): Promise<void> {
    const configDir = getApi().getConfigDir();
    const path = `${configDir}/presets/bg.json`;
    let presets: Record<string, any> = {};
    try {
        const d = await RpcApi.FileReadCommand(TabRpcClient, { info: { path } });
        const c = d?.data64 ? base64ToString(d.data64) : "";
        if (c.trim()) presets = JSON.parse(c);
    } catch {
        /* doesn't exist */
    }
    presets = fn(presets);
    await RpcApi.FileWriteCommand(TabRpcClient, {
        info: { path },
        data64: stringToBase64(JSON.stringify(presets, null, 2)),
    });
}

const BackgroundPicker = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const presets = fullConfig?.presets ?? {};
    const tabId = useAtomValue(atoms.staticTabId);

    const builtinKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const [k, v] of Object.entries(presets)) {
            if (!k.startsWith("bg@")) continue;
            const order = (v as any)?.["display:order"] ?? 999;
            if (order < 50 && !k.startsWith("bg@custom-") && !k.startsWith("bg@new-")) {
                keys.add(k);
            }
        }
        return keys;
    }, [presets]);

    const bgPresets = useMemo(() => {
        return Object.entries(presets)
            .filter(([k, v]) => {
                if (!k.startsWith("bg@")) return false;
                const bg = (v as any)?.["bg"];
                if (bg && /url\s*\(/i.test(bg) && !k.startsWith("bg@custom-")) return false;
                return true;
            })
            .sort(([, a], [, b]) => {
                const oa = (a as any)["display:order"] ?? 999;
                const ob = (b as any)["display:order"] ?? 999;
                return oa - ob;
            });
    }, [presets]);

    const tabPreset = useSettingValue("tab:preset") ?? "";

    const selectPreset = useCallback(
        (key: string, preset: MetaType) => {
            writeSetting("tab:preset", key);
            applyBgToTab(tabId, preset["bg"] as string, preset["bg:opacity"] as number);
        },
        [tabId]
    );

    const clearPreset = useCallback(() => {
        writeSetting("tab:preset", null);
        applyBgToTab(tabId, null);
    }, [tabId]);

    const deletePreset = useCallback(
        async (keyToDelete: string) => {
            try {
                await updateBgJson((p) => {
                    delete p[keyToDelete];
                    return p;
                });
                if (tabPreset === keyToDelete) {
                    writeSetting("tab:preset", null);
                    applyBgToTab(tabId, null);
                }
            } catch (e) {
                console.error("Failed to delete preset:", e);
            }
        },
        [tabId, tabPreset]
    );

    const handleCustomImage = useCallback(
        async (filePath: string) => {
            try {
                const normalized = filePath.replace(/\\/g, "/");
                const cssUrl = `url('${normalized}')`;
                const key = `bg@custom-${Date.now()}`;
                await updateBgJson((p) => {
                    const n = Object.keys(p).filter((k) => k.startsWith("bg@custom-")).length;
                    p[key] = {
                        "bg:*": true,
                        bg: cssUrl,
                        "bg:opacity": 0.6,
                        "display:name": `Custom BG ${n + 1}`,
                        "display:order": 100 + n,
                    };
                    return p;
                });
                writeSetting("tab:preset", key);
                applyBgToTab(tabId, cssUrl, 0.6);
            } catch (e) {
                console.error("Failed to save custom image:", e);
                const normalized = filePath.replace(/\\/g, "/");
                applyBgToTab(tabId, `url('${normalized}')`, 0.6);
            }
        },
        [tabId]
    );

    const handleCustomColor = useCallback(
        async (cssValue: string) => {
            try {
                const key = `bg@custom-color-${Date.now()}`;
                await updateBgJson((p) => {
                    const n = Object.keys(p).filter((k) => k.startsWith("bg@custom-color-")).length;
                    p[key] = {
                        "bg:*": true,
                        bg: cssValue,
                        "bg:opacity": 0.8,
                        "display:name": `Color ${n + 1}`,
                        "display:order": 200 + n,
                    };
                    return p;
                });
                writeSetting("tab:preset", key);
                applyBgToTab(tabId, cssValue, 0.8);
            } catch (e) {
                console.error("Failed to save custom color:", e);
                applyBgToTab(tabId, cssValue, 0.8);
            }
        },
        [tabId]
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 @[500px]:grid-cols-4 @[700px]:grid-cols-5">
                {bgPresets.map(([key, preset]) => (
                    <BgPresetCard
                        key={key}
                        presetKey={key}
                        preset={preset}
                        isActive={tabPreset === key}
                        onSelect={() => selectPreset(key, preset)}
                        onDelete={!builtinKeys.has(key) ? () => deletePreset(key) : undefined}
                    />
                ))}
                <CustomImageButton onImageSelected={handleCustomImage} />
                <CustomColorButton onColorSubmit={handleCustomColor} />
            </div>
            {tabPreset && tabPreset !== "bg@default" && (
                <button
                    onClick={clearPreset}
                    style={{
                        alignSelf: "flex-start",
                        padding: "4px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-color)",
                        fontSize: "11px",
                        color: "var(--secondary-text-color)",
                        background: "transparent",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "var(--hover-bg-color)";
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                >
                    ✕ Clear Background
                </button>
            )}
        </div>
    );
});
BackgroundPicker.displayName = "BackgroundPicker";

export { BackgroundPicker };
