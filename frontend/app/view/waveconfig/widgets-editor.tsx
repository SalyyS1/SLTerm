// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Visual editor for widgets.json — card-list layout with icon preview

import { getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, makeIconClass, stringToBase64 } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";

type WidgetDef = {
    "display:order"?: number;
    "display:hidden"?: boolean;
    icon?: string;
    color?: string;
    label?: string;
    description?: string;
    blockdef?: {
        meta?: Record<string, any>;
    };
};

type WidgetsData = Record<string, WidgetDef>;

const PRESET_WIDGETS = [
    { id: "terminal", icon: "square-terminal", label: "terminal", view: "term", controller: "shell" },
    { id: "files", icon: "folder", label: "files", view: "preview", file: "~" },
    { id: "web", icon: "globe", label: "web", view: "web" },
    { id: "sysinfo", icon: "chart-line", label: "sysinfo", view: "sysinfo" },
];

// Popular FontAwesome icons for quick pick
const POPULAR_ICONS = [
    "square-terminal",
    "folder",
    "globe",
    "chart-line",
    "code",
    "database",
    "server",
    "cloud",
    "book",
    "music",
    "image",
    "video",
    "gamepad",
    "rocket",
    "bolt",
    "star",
    "heart",
    "shield",
    "gear",
    "cube",
    "terminal",
    "laptop-code",
    "network-wired",
    "diagram-project",
];

// ---- Single widget card ----
const WidgetCard = memo(
    ({
        widgetKey,
        widget,
        isExpanded,
        onToggle,
        onUpdate,
        onDelete,
    }: {
        widgetKey: string;
        widget: WidgetDef;
        isExpanded: boolean;
        onToggle: () => void;
        onUpdate: (key: string, value: any) => void;
        onDelete: () => void;
    }) => {
        const icon = widget.icon || "cube";
        const label = widget.label || widgetKey.replace(/^(defwidget@|widget@)/, "");
        const isHidden = widget["display:hidden"] || false;
        const color = widget.color || "var(--accent-color)";

        return (
            <div
                style={{
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    overflow: "hidden",
                    animation: "fadeIn 0.2s ease",
                    opacity: isHidden ? 0.5 : 1,
                }}
            >
                {/* Header */}
                <button
                    onClick={onToggle}
                    style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 14px",
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
                    <i className={makeIconClass(icon, false)} style={{ color, fontSize: "16px", width: "20px" }} />
                    <div style={{ flex: 1, textAlign: "left" }}>
                        <div style={{ fontWeight: 600, fontSize: "13px" }}>{label}</div>
                        {widget.description && (
                            <div style={{ fontSize: "11px", color: "var(--secondary-text-color)", marginTop: "1px" }}>
                                {widget.description}
                            </div>
                        )}
                    </div>
                    {isHidden && (
                        <span
                            style={{
                                fontSize: "10px",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background: "rgba(255,255,255,0.06)",
                                color: "var(--secondary-text-color)",
                            }}
                        >
                            hidden
                        </span>
                    )}
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
                        {/* Icon picker */}
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
                                APPEARANCE
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                {/* Icon text field */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>Icon</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                        <i className={makeIconClass(icon, false)} style={{ color, fontSize: "14px" }} />
                                        <input
                                            type="text"
                                            value={icon}
                                            onChange={(e) => onUpdate("icon", e.target.value || undefined)}
                                            placeholder="fa icon name..."
                                            className="text-sm"
                                            style={{
                                                width: "140px",
                                                padding: "4px 8px",
                                                borderRadius: "4px",
                                                background: "var(--form-element-bg-color)",
                                                border: "1px solid var(--form-element-border-color)",
                                                color: "var(--main-text-color)",
                                                outline: "none",
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Quick icon picker */}
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                    {POPULAR_ICONS.map((iconName) => (
                                        <button
                                            key={iconName}
                                            onClick={() => onUpdate("icon", iconName)}
                                            title={iconName}
                                            className="cursor-pointer"
                                            style={{
                                                width: "28px",
                                                height: "28px",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                borderRadius: "4px",
                                                border:
                                                    icon === iconName
                                                        ? "1px solid var(--accent-color)"
                                                        : "1px solid var(--border-color)",
                                                background:
                                                    icon === iconName ? "rgba(103, 230, 214, 0.1)" : "transparent",
                                                color:
                                                    icon === iconName
                                                        ? "var(--accent-color)"
                                                        : "var(--secondary-text-color)",
                                                fontSize: "12px",
                                                transition: "all 0.1s ease",
                                            }}
                                            onMouseEnter={(e) => {
                                                if (icon !== iconName)
                                                    (e.currentTarget as HTMLElement).style.background =
                                                        "var(--hover-bg-color)";
                                            }}
                                            onMouseLeave={(e) => {
                                                if (icon !== iconName)
                                                    (e.currentTarget as HTMLElement).style.background = "transparent";
                                            }}
                                        >
                                            <i className={makeIconClass(iconName, false)} />
                                        </button>
                                    ))}
                                </div>

                                {/* Label */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>
                                        Label
                                    </span>
                                    <input
                                        type="text"
                                        value={label}
                                        onChange={(e) => onUpdate("label", e.target.value || undefined)}
                                        className="text-sm"
                                        style={{
                                            width: "180px",
                                            padding: "4px 8px",
                                            borderRadius: "4px",
                                            background: "var(--form-element-bg-color)",
                                            border: "1px solid var(--form-element-border-color)",
                                            color: "var(--main-text-color)",
                                            outline: "none",
                                        }}
                                    />
                                </div>

                                {/* Color */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>
                                        Color
                                    </span>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                        <input
                                            type="color"
                                            value={widget.color || "#67e6d6"}
                                            onChange={(e) => onUpdate("color", e.target.value)}
                                            style={{
                                                width: "28px",
                                                height: "28px",
                                                borderRadius: "4px",
                                                border: "1px solid var(--form-element-border-color)",
                                                cursor: "pointer",
                                                background: "transparent",
                                            }}
                                        />
                                        <input
                                            type="text"
                                            value={widget.color || ""}
                                            onChange={(e) => onUpdate("color", e.target.value || undefined)}
                                            placeholder="#hex or css color"
                                            className="text-sm"
                                            style={{
                                                width: "120px",
                                                padding: "4px 8px",
                                                borderRadius: "4px",
                                                background: "var(--form-element-bg-color)",
                                                border: "1px solid var(--form-element-border-color)",
                                                color: "var(--main-text-color)",
                                                outline: "none",
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Description */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>
                                        Description
                                    </span>
                                    <input
                                        type="text"
                                        value={widget.description || ""}
                                        onChange={(e) => onUpdate("description", e.target.value || undefined)}
                                        placeholder="Optional..."
                                        className="text-sm"
                                        style={{
                                            width: "180px",
                                            padding: "4px 8px",
                                            borderRadius: "4px",
                                            background: "var(--form-element-bg-color)",
                                            border: "1px solid var(--form-element-border-color)",
                                            color: "var(--main-text-color)",
                                            outline: "none",
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Options */}
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
                                OPTIONS
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>
                                        Order
                                    </span>
                                    <input
                                        type="number"
                                        value={widget["display:order"] ?? 0}
                                        onChange={(e) => onUpdate("display:order", Number(e.target.value))}
                                        className="text-sm"
                                        style={{
                                            width: "60px",
                                            padding: "4px 8px",
                                            borderRadius: "4px",
                                            background: "var(--form-element-bg-color)",
                                            border: "1px solid var(--form-element-border-color)",
                                            color: "var(--main-text-color)",
                                            outline: "none",
                                        }}
                                    />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}>
                                        Hidden
                                    </span>
                                    <button
                                        onClick={() => onUpdate("display:hidden", !isHidden || undefined)}
                                        className="cursor-pointer"
                                        style={{
                                            padding: "3px 10px",
                                            borderRadius: "4px",
                                            border: `1px solid ${isHidden ? "var(--accent-color)" : "var(--border-color)"}`,
                                            background: isHidden ? "rgba(103, 230, 214, 0.1)" : "transparent",
                                            color: isHidden ? "var(--accent-color)" : "var(--secondary-text-color)",
                                            fontSize: "11px",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        {isHidden ? "Yes" : "No"}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Delete button */}
                        <div
                            style={{
                                borderTop: "1px solid var(--border-color)",
                                paddingTop: "10px",
                            }}
                        >
                            <button
                                onClick={() => {
                                    if (confirm(`Delete widget "${label}"?`)) {
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
                                Delete Widget
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }
);
WidgetCard.displayName = "WidgetCard";

// ---- Main editor ----
const WidgetsEditor = memo(({ model }: { model: any }) => {
    const [widgets, setWidgets] = useState<WidgetsData>({});
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPresets, setShowPresets] = useState(false);

    const configDir = getApi().getConfigDir();
    const filePath = `${configDir}/widgets.json`;

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: filePath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            if (content.trim()) {
                setWidgets(JSON.parse(content));
            } else {
                setWidgets({});
            }
        } catch (err: any) {
            setError(`Failed to load: ${err.message || String(err)}`);
            setWidgets({});
        } finally {
            setLoading(false);
        }
    }, [filePath]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const saveData = useCallback(
        async (data: WidgetsData) => {
            setSaving(true);
            setError(null);
            try {
                const cleaned: WidgetsData = {};
                for (const [key, val] of Object.entries(data)) {
                    const w: WidgetDef = {};
                    for (const [k, v] of Object.entries(val)) {
                        if (v !== undefined && v !== "") {
                            (w as any)[k] = v;
                        }
                    }
                    cleaned[key] = w;
                }

                const formatted = JSON.stringify(cleaned, null, 2);
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: filePath },
                    data64: stringToBase64(formatted),
                });
                setWidgets(cleaned);
            } catch (err: any) {
                setError(`Failed to save: ${err.message || String(err)}`);
            } finally {
                setSaving(false);
            }
        },
        [filePath]
    );

    const handleAddFromPreset = useCallback(
        (preset: (typeof PRESET_WIDGETS)[0]) => {
            const key = `widget@${preset.id}`;
            let finalKey = key;
            let i = 1;
            while (widgets[finalKey]) {
                finalKey = `${key}-${i++}`;
            }

            const meta: Record<string, any> = { view: preset.view };
            if (preset.controller) meta.controller = preset.controller;
            if ((preset as any).file) meta.file = (preset as any).file;

            const newWidget: WidgetDef = {
                icon: preset.icon,
                label: preset.label,
                "display:order": Object.keys(widgets).length,
                blockdef: { meta },
            };

            const updated = { ...widgets, [finalKey]: newWidget };
            setWidgets(updated);
            setExpandedKey(finalKey);
            setShowPresets(false);
            saveData(updated);
        },
        [widgets, saveData]
    );

    const handleAddCustom = useCallback(() => {
        let key = "widget@custom";
        let i = 1;
        while (widgets[key]) {
            key = `widget@custom-${i++}`;
        }

        const newWidget: WidgetDef = {
            icon: "cube",
            label: "custom",
            "display:order": Object.keys(widgets).length,
            blockdef: { meta: { view: "term", controller: "shell" } },
        };

        const updated = { ...widgets, [key]: newWidget };
        setWidgets(updated);
        setExpandedKey(key);
        setShowPresets(false);
        saveData(updated);
    }, [widgets, saveData]);

    const handleUpdate = useCallback(
        (widgetKey: string, fieldKey: string, value: any) => {
            const updated = {
                ...widgets,
                [widgetKey]: {
                    ...widgets[widgetKey],
                    [fieldKey]: value,
                },
            };
            setWidgets(updated);
            saveData(updated);
        },
        [widgets, saveData]
    );

    const handleDelete = useCallback(
        (widgetKey: string) => {
            const { [widgetKey]: _, ...rest } = widgets;
            setWidgets(rest);
            if (expandedKey === widgetKey) setExpandedKey(null);
            saveData(rest);
        },
        [widgets, expandedKey, saveData]
    );

    const widgetEntries = Object.entries(widgets).sort((a, b) => {
        const orderA = a[1]["display:order"] ?? 0;
        const orderB = b[1]["display:order"] ?? 0;
        return orderA - orderB;
    });

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
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>Sidebar Widgets</div>
                    <div style={{ fontSize: "11px", color: "var(--secondary-text-color)" }}>
                        {widgetEntries.length} widget{widgetEntries.length !== 1 ? "s" : ""}
                    </div>
                </div>
                <button
                    onClick={() => setShowPresets(!showPresets)}
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
                    Add Widget
                </button>
            </div>

            {/* Preset picker */}
            {showPresets && (
                <div
                    style={{
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        padding: "12px",
                        background: "var(--panel-bg-color)",
                        animation: "fadeIn 0.15s ease",
                    }}
                >
                    <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>Add from preset</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {PRESET_WIDGETS.map((preset) => (
                            <button
                                key={preset.id}
                                onClick={() => handleAddFromPreset(preset)}
                                className="cursor-pointer"
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "6px 10px",
                                    borderRadius: "6px",
                                    border: "1px solid var(--border-color)",
                                    background: "transparent",
                                    color: "var(--main-text-color)",
                                    fontSize: "12px",
                                    transition: "all 0.15s ease",
                                }}
                                onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "var(--hover-bg-color)";
                                }}
                                onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "transparent";
                                }}
                            >
                                <i
                                    className={makeIconClass(preset.icon, false)}
                                    style={{ color: "var(--accent-color)" }}
                                />
                                {preset.label}
                            </button>
                        ))}
                        <button
                            onClick={handleAddCustom}
                            className="cursor-pointer"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "6px 10px",
                                borderRadius: "6px",
                                border: "1px dashed var(--border-color)",
                                background: "transparent",
                                color: "var(--secondary-text-color)",
                                fontSize: "12px",
                                transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.background = "var(--hover-bg-color)";
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.background = "transparent";
                            }}
                        >
                            <i className="fa fa-plus" />
                            Custom
                        </button>
                    </div>
                </div>
            )}

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

            {/* Widget cards */}
            {widgetEntries.length === 0 ? (
                <div
                    style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--secondary-text-color)",
                        fontSize: "13px",
                    }}
                >
                    <i
                        className="fa fa-cubes"
                        style={{ fontSize: "32px", marginBottom: "12px", display: "block", opacity: 0.3 }}
                    />
                    No widgets configured yet.
                    <br />
                    Click "Add Widget" to get started.
                </div>
            ) : (
                widgetEntries.map(([key, data]) => (
                    <WidgetCard
                        key={key}
                        widgetKey={key}
                        widget={data}
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
WidgetsEditor.displayName = "WidgetsEditor";

export { WidgetsEditor };
