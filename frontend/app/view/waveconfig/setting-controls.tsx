// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Shared setting control primitives for the visual settings UI

import { Toggle } from "@/app/element/toggle";
import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";

export function useSettingValue<T extends keyof SettingsType>(key: T): SettingsType[T] {
    return useAtomValue(getSettingsKeyAtom(key));
}

export async function writeSetting(key: string, value: any): Promise<void> {
    try {
        await RpcApi.SetConfigCommand(TabRpcClient, { [key]: value } as any);
    } catch (e) {
        console.error(`writeSetting failed for key="${key}":`, e);
    }
}

export const ToggleSetting = memo(({ settingKey, label }: { settingKey: string; label: string }) => {
    const value = useSettingValue(settingKey as any) ?? false;
    return <Toggle checked={!!value} onChange={(v) => writeSetting(settingKey, v)} label={label} />;
});
ToggleSetting.displayName = "ToggleSetting";

export const NumberSetting = memo(
    ({ settingKey, label, min, max, step = 1 }: { settingKey: string; label: string; min?: number; max?: number; step?: number }) => {
        const value = useSettingValue(settingKey as any) ?? 0;
        return (
            <div className="flex items-center justify-between gap-3">
                <span className="text-secondary text-sm">{label}</span>
                <input
                    type="number"
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => writeSetting(settingKey, Number(e.target.value))}
                    className="w-20 px-2 py-1 rounded bg-[var(--form-element-bg-color)] border border-[var(--form-element-border-color)] text-[var(--main-text-color)] text-sm"
                />
            </div>
        );
    }
);
NumberSetting.displayName = "NumberSetting";
export const TextSetting = memo(
    ({ settingKey, label, placeholder }: { settingKey: string; label: string; placeholder?: string }) => {
        const value = useSettingValue(settingKey as any) ?? "";
        return (
            <div className="flex items-center justify-between gap-3">
                <span className="text-secondary text-sm">{label}</span>
                <input
                    type="text"
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => writeSetting(settingKey, e.target.value || null)}
                    className="w-48 px-2 py-1 rounded bg-[var(--form-element-bg-color)] border border-[var(--form-element-border-color)] text-[var(--main-text-color)] text-sm"
                />
            </div>
        );
    }
);
TextSetting.displayName = "TextSetting";

export const SliderSetting = memo(
    ({ settingKey, label, min = 0, max = 1, step = 0.05, displayMultiplier = 100, unit = "%" }: {
        settingKey: string; label: string; min?: number; max?: number; step?: number; displayMultiplier?: number; unit?: string;
    }) => {
        const value = useSettingValue(settingKey as any) ?? min;
        return (
            <div className="flex items-center justify-between gap-3">
                <span className="text-secondary text-sm">{label}</span>
                <div className="flex items-center gap-2">
                    <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={(e) => writeSetting(settingKey, Number(e.target.value))}
                        className="w-28 accent-[var(--accent-color)]"
                    />
                    <span className="text-xs text-muted-foreground w-12 text-right">
                        {Math.round(Number(value) * displayMultiplier)}{unit}
                    </span>
                </div>
            </div>
        );
    }
);
SliderSetting.displayName = "SliderSetting";

export const ColorSetting = memo(({ settingKey, label }: { settingKey: string; label: string }) => {
    const value = useSettingValue(settingKey as any) ?? "#000000";
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-secondary text-sm">{label}</span>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={value}
                    onChange={(e) => writeSetting(settingKey, e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border border-[var(--form-element-border-color)] bg-transparent"
                />
                <span className="text-xs text-muted-foreground font-mono">{value}</span>
            </div>
        </div>
    );
});
ColorSetting.displayName = "ColorSetting";

export const SettingsCategory = memo(({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => {
    const [open, setOpen] = useState(true);
    return (
        <div className="border border-border rounded-lg">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-[var(--panel-bg-color)] hover:bg-[var(--hover-bg-color)] cursor-pointer transition-colors"
            >
                <i className={`fa fa-${icon} text-sm text-[var(--accent-color)]`} />
                <span className="font-semibold text-sm">{title}</span>
                <i className={`fa fa-chevron-${open ? "up" : "down"} text-xs text-muted-foreground ml-auto`} />
            </button>
            {open && <div className="flex flex-col gap-3 px-4 py-3">{children}</div>}
        </div>
    );
});
SettingsCategory.displayName = "SettingsCategory";

const RestartBadge = memo(() => (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning">restart required</span>
));
RestartBadge.displayName = "RestartBadge";

export const RestartToggleSetting = memo(({ settingKey, label }: { settingKey: string; label: string }) => {
    const value = useSettingValue(settingKey as any) ?? false;
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <span className="text-secondary text-sm">{label}</span>
                <RestartBadge />
            </div>
            <Toggle checked={!!value} onChange={(v) => writeSetting(settingKey, v)} />
        </div>
    );
});
RestartToggleSetting.displayName = "RestartToggleSetting";
