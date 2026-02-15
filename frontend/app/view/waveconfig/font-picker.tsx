// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Font family and size picker with live preview — custom dropdown to fix z-index/overflow issues

import { NumberSetting, useSettingValue, writeSetting } from "@/app/view/waveconfig/setting-controls";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const BUILTIN_FONTS = [
    // Popular coding fonts (tight, monospace)
    "Hack",
    "JetBrains Mono",
    "Fira Code",
    "Cascadia Code",
    "Cascadia Mono",
    "Source Code Pro",
    "IBM Plex Mono",
    "Iosevka",
    "Roboto Mono",
    "Ubuntu Mono",
    "Inconsolata",
    // System monospace fonts
    "Consolas",
    "Menlo",
    "Monaco",
    "SF Mono",
    "DejaVu Sans Mono",
    "Droid Sans Mono",
    "Noto Sans Mono",
    "Courier New",
    "Liberation Mono",
    "Anonymous Pro",
    // Generic fallback
    "monospace",
];

const FontDropdown = memo(
    ({
        value,
        options,
        onChange,
    }: {
        value: string;
        options: { label: string; value: string }[];
        onChange: (val: string) => void;
    }) => {
        const [open, setOpen] = useState(false);
        const [search, setSearch] = useState("");
        const ref = useRef<HTMLDivElement>(null);
        const menuRef = useRef<HTMLDivElement>(null);
        const searchRef = useRef<HTMLInputElement>(null);

        useEffect(() => {
            if (!open) return;
            const handleClick = (e: MouseEvent) => {
                if (
                    ref.current &&
                    !ref.current.contains(e.target as Node) &&
                    menuRef.current &&
                    !menuRef.current.contains(e.target as Node)
                ) {
                    setOpen(false);
                    setSearch("");
                }
            };
            document.addEventListener("mousedown", handleClick);
            return () => document.removeEventListener("mousedown", handleClick);
        }, [open]);

        // Position the dropdown menu using fixed positioning to avoid any overflow clipping
        useEffect(() => {
            if (!open || !ref.current || !menuRef.current) return;
            const rect = ref.current.getBoundingClientRect();
            const menu = menuRef.current;
            menu.style.position = "fixed";
            menu.style.top = `${rect.bottom + 2}px`;
            menu.style.left = `${rect.left}px`;
            menu.style.width = `${Math.max(rect.width, 220)}px`;
            // Focus search input
            setTimeout(() => searchRef.current?.focus(), 50);
        }, [open]);

        const displayLabel = options.find((o) => o.value === value)?.label ?? value;

        const filteredOptions = search.trim()
            ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
            : options;

        return (
            <div ref={ref} className="relative" style={{ width: "14rem" }}>
                <button
                    type="button"
                    onClick={() => {
                        setOpen(!open);
                        if (open) setSearch("");
                    }}
                    className="w-full px-3 py-1.5 rounded text-left text-sm flex items-center justify-between cursor-pointer"
                    style={{
                        background: "var(--form-element-bg-color)",
                        border: "1px solid var(--form-element-border-color)",
                        color: "var(--main-text-color)",
                        transition: "border-color 0.15s ease",
                    }}
                >
                    <span style={{ fontFamily: value !== "__custom__" ? value : undefined }}>{displayLabel}</span>
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ flexShrink: 0, marginLeft: 8 }}>
                        <path
                            d="M1 1L5 5L9 1"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>
                {open && (
                    <div
                        ref={menuRef}
                        style={{
                            zIndex: 9999,
                            background: "var(--form-element-bg-color)",
                            border: "1px solid var(--form-element-border-color)",
                            borderRadius: "6px",
                            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                            overflow: "hidden",
                            animation: "dropdownFadeIn 0.15s ease",
                        }}
                    >
                        {/* Search filter */}
                        <div style={{ padding: "6px", borderBottom: "1px solid var(--form-element-border-color)" }}>
                            <input
                                ref={searchRef}
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search fonts..."
                                className="text-sm"
                                style={{
                                    width: "100%",
                                    padding: "4px 8px",
                                    background: "rgba(255,255,255,0.04)",
                                    border: "1px solid var(--form-element-border-color)",
                                    borderRadius: "4px",
                                    color: "var(--main-text-color)",
                                    outline: "none",
                                }}
                            />
                        </div>
                        {/* Font list */}
                        <div style={{ overflow: "auto", maxHeight: "280px" }}>
                            {filteredOptions.length === 0 && (
                                <div
                                    style={{
                                        padding: "8px 12px",
                                        color: "var(--secondary-text-color)",
                                        fontSize: "12px",
                                    }}
                                >
                                    No fonts found
                                </div>
                            )}
                            {filteredOptions.map((opt) => (
                                <div
                                    key={opt.value}
                                    onClick={() => {
                                        onChange(opt.value);
                                        setOpen(false);
                                        setSearch("");
                                    }}
                                    className="cursor-pointer text-sm"
                                    style={{
                                        padding: "6px 12px",
                                        color: opt.value === value ? "var(--accent-color)" : "var(--main-text-color)",
                                        background: opt.value === value ? "rgba(255,255,255,0.05)" : "transparent",
                                        fontFamily: opt.value !== "__custom__" ? opt.value : undefined,
                                        transition: "background 0.1s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                        (e.target as HTMLElement).style.background = "rgba(255,255,255,0.08)";
                                    }}
                                    onMouseLeave={(e) => {
                                        (e.target as HTMLElement).style.background =
                                            opt.value === value ? "rgba(255,255,255,0.05)" : "transparent";
                                    }}
                                >
                                    {opt.label}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }
);
FontDropdown.displayName = "FontDropdown";

const FontPicker = memo(() => {
    const currentFont = useSettingValue("term:fontfamily") ?? "Hack";
    const currentSize = useSettingValue("term:fontsize") ?? 12;
    const [customFont, setCustomFont] = useState("");
    const isCustom = !BUILTIN_FONTS.includes(currentFont);

    const handleFontChange = useCallback((font: string) => {
        if (font === "__custom__") return;
        writeSetting("term:fontfamily", font);
    }, []);

    const handleCustomApply = useCallback(() => {
        if (customFont.trim()) {
            writeSetting("term:fontfamily", customFont.trim());
        }
    }, [customFont]);

    const options = [
        ...BUILTIN_FONTS.map((f) => ({ label: f, value: f })),
        { label: "Custom...", value: "__custom__" },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-secondary text-sm">Font Family</span>
                <FontDropdown
                    value={isCustom ? "__custom__" : currentFont}
                    options={options}
                    onChange={handleFontChange}
                />
            </div>
            {isCustom && (
                <div className="flex items-center gap-2 ml-auto">
                    <input
                        type="text"
                        value={customFont || currentFont}
                        onChange={(e) => setCustomFont(e.target.value)}
                        placeholder="Font name..."
                        className="w-36 px-2 py-1 rounded bg-[var(--form-element-bg-color)] border border-[var(--form-element-border-color)] text-[var(--main-text-color)] text-sm"
                    />
                    <button
                        onClick={handleCustomApply}
                        className="px-2 py-1 rounded bg-[var(--accent-color)] text-[var(--button-text-color)] text-xs cursor-pointer hover:opacity-80"
                    >
                        Apply
                    </button>
                </div>
            )}
            <NumberSetting settingKey="term:fontsize" label="Font Size" min={4} max={64} />
            <div
                className="p-3 rounded border border-border text-sm"
                style={{ fontFamily: currentFont, fontSize: currentSize }}
            >
                The quick brown fox jumps over the lazy dog. 0123456789
            </div>
        </div>
    );
});
FontPicker.displayName = "FontPicker";

export { FontPicker };
