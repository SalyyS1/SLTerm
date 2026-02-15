// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Visual editor for connections.json — card-list layout with expand/collapse

import { Toggle } from "@/app/element/toggle";
import { getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isWindows } from "@/util/platformutil";
import { base64ToString, stringToBase64 } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";

type ConnKeywords = {
    "conn:wshenabled"?: boolean;
    "conn:askbeforewshinstall"?: boolean;
    "conn:wshpath"?: string;
    "conn:shellpath"?: string;
    "conn:ignoresshconfig"?: boolean;
    "display:hidden"?: boolean;
    "display:order"?: number;
    "term:fontsize"?: number;
    "term:fontfamily"?: string;
    "term:theme"?: string;
    "ssh:user"?: string;
    "ssh:hostname"?: string;
    "ssh:port"?: string;
    "ssh:identityfile"?: string[];
    "ssh:batchmode"?: boolean;
    "ssh:pubkeyauthentication"?: boolean;
    "ssh:passwordauthentication"?: boolean;
    "cmd:env"?: Record<string, string>;
    [key: string]: any;
};

type ConnectionsData = Record<string, ConnKeywords>;

const FIELD_GROUPS = [
    {
        title: "SSH",
        fields: [
            { key: "ssh:hostname", label: "Hostname", type: "text" as const },
            { key: "ssh:user", label: "User", type: "text" as const },
            { key: "ssh:port", label: "Port", type: "text" as const, placeholder: "22" },
            { key: "ssh:identityfile", label: "Identity File", type: "text" as const },
        ],
    },
    {
        title: "Terminal",
        fields: [
            { key: "term:fontfamily", label: "Font Family", type: "text" as const },
            { key: "term:fontsize", label: "Font Size", type: "number" as const },
            { key: "term:theme", label: "Theme", type: "text" as const },
        ],
    },
    {
        title: "Shell",
        fields: [
            { key: "conn:shellpath", label: "Shell Path", type: "text" as const },
            { key: "conn:wshpath", label: "WSH Path", type: "text" as const },
        ],
    },
    {
        title: "Options",
        fields: [
            { key: "conn:wshenabled", label: "WSH Enabled", type: "toggle" as const },
            { key: "conn:askbeforewshinstall", label: "Ask Before WSH Install", type: "toggle" as const },
            { key: "conn:ignoresshconfig", label: "Ignore SSH Config", type: "toggle" as const },
            { key: "ssh:batchmode", label: "Batch Mode", type: "toggle" as const },
            { key: "ssh:pubkeyauthentication", label: "Public Key Auth", type: "toggle" as const },
            { key: "ssh:passwordauthentication", label: "Password Auth", type: "toggle" as const },
            { key: "display:hidden", label: "Hidden", type: "toggle" as const },
        ],
    },
];

// ---- Card component for a single connection ----
const ConnectionCard = memo(
    ({
        connName,
        connData,
        isExpanded,
        onToggle,
        onUpdate,
        onDelete,
        onRename,
    }: {
        connName: string;
        connData: ConnKeywords;
        isExpanded: boolean;
        onToggle: () => void;
        onUpdate: (key: string, value: any) => void;
        onDelete: () => void;
        onRename: (newName: string) => void;
    }) => {
        const [isEditing, setIsEditing] = useState(false);
        const [editName, setEditName] = useState(connName);

        const hostname = connData["ssh:hostname"] || "";
        const user = connData["ssh:user"] || "";
        const port = connData["ssh:port"] || "22";
        const isHidden = connData["display:hidden"] || false;

        const subtitle = hostname
            ? `${user ? user + "@" : ""}${hostname}${port !== "22" ? ":" + port : ""}`
            : "No host configured";

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
                    <i
                        className="fa fa-server"
                        style={{ color: "var(--accent-color)", fontSize: "14px", width: "16px" }}
                    />
                    <div style={{ flex: 1, textAlign: "left" }}>
                        {isEditing ? (
                            <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onBlur={() => {
                                    if (editName.trim() && editName !== connName) {
                                        onRename(editName.trim());
                                    }
                                    setIsEditing(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        if (editName.trim() && editName !== connName) {
                                            onRename(editName.trim());
                                        }
                                        setIsEditing(false);
                                    }
                                    if (e.key === "Escape") {
                                        setEditName(connName);
                                        setIsEditing(false);
                                    }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                                className="text-sm"
                                style={{
                                    background: "var(--form-element-bg-color)",
                                    border: "1px solid var(--accent-color)",
                                    borderRadius: "4px",
                                    padding: "2px 6px",
                                    color: "var(--main-text-color)",
                                    outline: "none",
                                    width: "100%",
                                    maxWidth: "200px",
                                }}
                            />
                        ) : (
                            <>
                                <div style={{ fontWeight: 600, fontSize: "13px" }}>{connName}</div>
                                <div
                                    style={{ fontSize: "11px", color: "var(--secondary-text-color)", marginTop: "1px" }}
                                >
                                    {subtitle}
                                </div>
                            </>
                        )}
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
                            gap: "14px",
                            borderTop: "1px solid var(--border-color)",
                            animation: "fadeIn 0.15s ease",
                        }}
                    >
                        {FIELD_GROUPS.map((group) => (
                            <div key={group.title}>
                                <div
                                    style={{
                                        fontSize: "10px",
                                        fontWeight: 600,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                        color: "var(--accent-color)",
                                        marginBottom: "8px",
                                    }}
                                >
                                    {group.title}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    {group.fields.map((field) => {
                                        const val = connData[field.key];

                                        if (field.type === "toggle") {
                                            return (
                                                <div
                                                    key={field.key}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        gap: "8px",
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            fontSize: "12px",
                                                            color: "var(--secondary-text-color)",
                                                        }}
                                                    >
                                                        {field.label}
                                                    </span>
                                                    <Toggle
                                                        checked={!!val}
                                                        onChange={(v) => onUpdate(field.key, v || undefined)}
                                                    />
                                                </div>
                                            );
                                        }

                                        return (
                                            <div
                                                key={field.key}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    gap: "8px",
                                                }}
                                            >
                                                <span
                                                    style={{ fontSize: "12px", color: "var(--secondary-text-color)" }}
                                                >
                                                    {field.label}
                                                </span>
                                                <input
                                                    type={field.type === "number" ? "number" : "text"}
                                                    value={
                                                        Array.isArray(val)
                                                            ? val.join(", ")
                                                            : val != null
                                                              ? String(val)
                                                              : ""
                                                    }
                                                    placeholder={(field as any).placeholder || ""}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        if (v === "") {
                                                            onUpdate(field.key, undefined);
                                                        } else if (field.type === "number") {
                                                            onUpdate(field.key, Number(v));
                                                        } else {
                                                            onUpdate(field.key, v);
                                                        }
                                                    }}
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
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        {/* Action buttons */}
                        <div
                            style={{
                                display: "flex",
                                gap: "8px",
                                marginTop: "4px",
                                borderTop: "1px solid var(--border-color)",
                                paddingTop: "10px",
                            }}
                        >
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsEditing(true);
                                    setEditName(connName);
                                }}
                                className="text-xs cursor-pointer"
                                style={{
                                    padding: "4px 10px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--border-color)",
                                    background: "transparent",
                                    color: "var(--secondary-text-color)",
                                    transition: "all 0.15s ease",
                                }}
                                onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "var(--hover-bg-color)";
                                }}
                                onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "transparent";
                                }}
                            >
                                <i className="fa fa-pencil" style={{ marginRight: "4px" }} />
                                Rename
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete connection "${connName}"?`)) {
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
                                Delete
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }
);
ConnectionCard.displayName = "ConnectionCard";

// ---- Main editor ----
const ConnectionsEditor = memo(({ model }: { model: any }) => {
    const [connections, setConnections] = useState<ConnectionsData>({});
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const configDir = getApi().getConfigDir();
    const filePath = `${configDir}/connections.json`;

    // Load connections data
    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: filePath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            if (content.trim()) {
                setConnections(JSON.parse(content));
            } else {
                setConnections({});
            }
        } catch (err: any) {
            setError(`Failed to load: ${err.message || String(err)}`);
            setConnections({});
        } finally {
            setLoading(false);
        }
    }, [filePath]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Save connections data
    const saveData = useCallback(
        async (data: ConnectionsData) => {
            setSaving(true);
            setError(null);
            try {
                // Clean up undefined values
                const cleaned: ConnectionsData = {};
                for (const [key, val] of Object.entries(data)) {
                    const cleanedConn: ConnKeywords = {};
                    for (const [k, v] of Object.entries(val)) {
                        if (v !== undefined && v !== "") {
                            cleanedConn[k] = v;
                        }
                    }
                    if (Object.keys(cleanedConn).length > 0) {
                        cleaned[key] = cleanedConn;
                    } else {
                        cleaned[key] = {};
                    }
                }

                const formatted = JSON.stringify(cleaned, null, 2);
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: filePath },
                    data64: stringToBase64(formatted),
                });
                setConnections(cleaned);
            } catch (err: any) {
                setError(`Failed to save: ${err.message || String(err)}`);
            } finally {
                setSaving(false);
            }
        },
        [filePath]
    );

    const handleAddConnection = useCallback(() => {
        const baseName = isWindows() ? "new-connection" : "user@host";
        let name = baseName;
        let i = 1;
        while (connections[name]) {
            name = `${baseName}-${i++}`;
        }
        const newConns = { ...connections, [name]: {} };
        setConnections(newConns);
        setExpandedKey(name);
        saveData(newConns);
    }, [connections, saveData]);

    const handleUpdate = useCallback(
        (connName: string, fieldKey: string, value: any) => {
            const updated = {
                ...connections,
                [connName]: {
                    ...connections[connName],
                    [fieldKey]: value,
                },
            };
            setConnections(updated);
            saveData(updated);
        },
        [connections, saveData]
    );

    const handleDelete = useCallback(
        (connName: string) => {
            const { [connName]: _, ...rest } = connections;
            setConnections(rest);
            if (expandedKey === connName) setExpandedKey(null);
            saveData(rest);
        },
        [connections, expandedKey, saveData]
    );

    const handleRename = useCallback(
        (oldName: string, newName: string) => {
            if (connections[newName]) {
                setError(`Connection "${newName}" already exists`);
                return;
            }
            const updated: ConnectionsData = {};
            for (const [key, val] of Object.entries(connections)) {
                if (key === oldName) {
                    updated[newName] = val;
                } else {
                    updated[key] = val;
                }
            }
            setConnections(updated);
            if (expandedKey === oldName) setExpandedKey(newName);
            saveData(updated);
        },
        [connections, expandedKey, saveData]
    );

    const connEntries = Object.entries(connections).sort((a, b) => {
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
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>
                        {isWindows() ? "SSH Hosts & WSL Distros" : "SSH Hosts"}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--secondary-text-color)" }}>
                        {connEntries.length} connection{connEntries.length !== 1 ? "s" : ""}
                    </div>
                </div>
                <button
                    onClick={handleAddConnection}
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
                    Add Connection
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
                    <button
                        onClick={() => setError(null)}
                        style={{
                            marginLeft: "8px",
                            background: "none",
                            border: "none",
                            color: "var(--error-color)",
                            cursor: "pointer",
                        }}
                    >
                        ×
                    </button>
                </div>
            )}

            {/* Saving indicator */}
            {saving && (
                <div style={{ fontSize: "11px", color: "var(--accent-color)", textAlign: "center" }}>
                    <i className="fa fa-spinner fa-spin" style={{ marginRight: "4px" }} />
                    Saving...
                </div>
            )}

            {/* Connection cards */}
            {connEntries.length === 0 ? (
                <div
                    style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--secondary-text-color)",
                        fontSize: "13px",
                    }}
                >
                    <i
                        className="fa fa-server"
                        style={{ fontSize: "32px", marginBottom: "12px", display: "block", opacity: 0.3 }}
                    />
                    No connections configured yet.
                    <br />
                    Click "Add Connection" to get started.
                </div>
            ) : (
                connEntries.map(([name, data]) => (
                    <ConnectionCard
                        key={name}
                        connName={name}
                        connData={data}
                        isExpanded={expandedKey === name}
                        onToggle={() => setExpandedKey(expandedKey === name ? null : name)}
                        onUpdate={(key, value) => handleUpdate(name, key, value)}
                        onDelete={() => handleDelete(name)}
                        onRename={(newName) => handleRename(name, newName)}
                    />
                ))
            )}
        </div>
    );
});
ConnectionsEditor.displayName = "ConnectionsEditor";

export { ConnectionsEditor };
