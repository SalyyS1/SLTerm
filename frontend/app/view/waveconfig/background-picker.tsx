// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Background preset picker with live CSS previews + custom image support

import { atoms, getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useSettingValue, writeSetting } from "@/app/view/waveconfig/setting-controls";
import { base64ToString, stringToBase64 } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useMemo, useRef, useState } from "react";

const BgPresetCard = memo(
    ({
        presetKey,
        preset,
        isActive,
        isCustom,
        onSelect,
        onDelete,
    }: {
        presetKey: string;
        preset: MetaType;
        isActive: boolean;
        isCustom?: boolean;
        onSelect: () => void;
        onDelete?: () => void;
    }) => {
        const [hovered, setHovered] = useState(false);
        const bgStyle: React.CSSProperties = {};
        if (preset["bg"]) {
            bgStyle.background = preset["bg"] as string;
            bgStyle.backgroundSize = "cover";
            bgStyle.backgroundPosition = "center";
        }
        bgStyle.opacity = (preset["bg:opacity"] as number) ?? 0.5;
        if (preset["bg:blendmode"]) {
            bgStyle.backgroundBlendMode = preset["bg:blendmode"] as string;
        }

        const displayName = (preset as any)["display:name"] || presetKey.replace("bg@", "");

        return (
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
                    position: "relative",
                }}
                onMouseEnter={(e) => {
                    setHovered(true);
                    if (!isActive) {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-color)";
                        (e.currentTarget as HTMLElement).style.transform = "scale(1.03)";
                    }
                }}
                onMouseLeave={(e) => {
                    setHovered(false);
                    if (!isActive) {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
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
                            top: "2px",
                            right: "2px",
                            width: "16px",
                            height: "16px",
                            borderRadius: "50%",
                            background: "rgba(229, 77, 46, 0.85)",
                            color: "#fff",
                            fontSize: "9px",
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
                <div
                    style={{
                        width: "100%",
                        height: "48px",
                        borderRadius: "5px",
                        overflow: "hidden",
                        background: "#111",
                    }}
                >
                    <div style={{ ...bgStyle, width: "100%", height: "100%", opacity: 1 }}>
                        <div style={{ ...bgStyle, width: "100%", height: "100%" }} />
                    </div>
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
        );
    }
);
BgPresetCard.displayName = "BgPresetCard";

const CustomImageButton = memo(({ onImageSelected }: { onImageSelected: (path: string) => void }) => {
    const fileRef = useRef<HTMLInputElement>(null);

    const handleClick = useCallback(() => {
        fileRef.current?.click();
    }, []);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) {
                // Use file:// protocol for local images
                const filePath = `url('file://${file.path?.replace(/\\/g, "/")}')`;
                onImageSelected(filePath);
            }
        },
        [onImageSelected]
    );

    return (
        <>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
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
                <span style={{ fontSize: "9px", color: "var(--secondary-text-color)" }}>Custom Image</span>
            </button>
        </>
    );
});
CustomImageButton.displayName = "CustomImageButton";

const BackgroundPicker = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const presets = fullConfig?.presets ?? {};
    const bgPresets = useMemo(() => {
        return Object.entries(presets)
            .filter(([k]) => k.startsWith("bg@"))
            .sort(([, a], [, b]) => {
                const oa = (a as any)["display:order"] ?? 999;
                const ob = (b as any)["display:order"] ?? 999;
                return oa - ob;
            });
    }, [presets]);

    const tabPreset = useSettingValue("tab:preset") ?? "";

    const handleCustomImage = useCallback(async (cssUrl: string) => {
        const configDir = getApi().getConfigDir();
        const filePath = `${configDir}/presets/bg.json`;

        // Read existing presets
        let userPresets: Record<string, any> = {};
        try {
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: filePath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            if (content.trim()) {
                userPresets = JSON.parse(content);
            }
        } catch {
            // File may not exist yet
        }

        // Create unique preset key and add entry
        const key = `bg@custom-${Date.now()}`;
        userPresets[key] = {
            "bg:*": true,
            bg: cssUrl,
            "bg:opacity": 0.3,
            "display:name": "Custom Image",
            "display:order": 100,
        };

        // Write back
        await RpcApi.FileWriteCommand(TabRpcClient, {
            info: { path: filePath },
            data64: stringToBase64(JSON.stringify(userPresets, null, 2)),
        });

        // Activate the preset
        writeSetting("tab:preset", key);
    }, []);

    const handleDeleteCustomPreset = useCallback(
        async (presetKey: string) => {
            const configDir = getApi().getConfigDir();
            const filePath = `${configDir}/presets/bg.json`;

            let userPresets: Record<string, any> = {};
            try {
                const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                    info: { path: filePath },
                });
                const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
                if (content.trim()) {
                    userPresets = JSON.parse(content);
                }
            } catch {
                return;
            }

            delete userPresets[presetKey];

            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: { path: filePath },
                data64: stringToBase64(JSON.stringify(userPresets, null, 2)),
            });

            // If deleted preset was active, clear it
            if (tabPreset === presetKey) {
                writeSetting("tab:preset", null);
            }
        },
        [tabPreset]
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
                        isCustom={key.startsWith("bg@custom-")}
                        onSelect={() => writeSetting("tab:preset", key)}
                        onDelete={() => handleDeleteCustomPreset(key)}
                    />
                ))}
                <CustomImageButton onImageSelected={handleCustomImage} />
            </div>
            {tabPreset && tabPreset !== "bg@default" && (
                <button
                    onClick={() => writeSetting("tab:preset", null)}
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
