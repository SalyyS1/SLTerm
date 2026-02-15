// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Main visual settings UI — assembles all setting categories and pickers

import { BackgroundPicker } from "@/app/view/waveconfig/background-picker";
import { FontPicker } from "@/app/view/waveconfig/font-picker";
import { LanguageSetting } from "@/app/view/waveconfig/language-setting";
import {
    ColorSetting,
    NumberSetting,
    RestartToggleSetting,
    SettingsCategory,
    SliderSetting,
    TextSetting,
    ToggleSetting,
} from "@/app/view/waveconfig/setting-controls";
import { ThemePicker } from "@/app/view/waveconfig/theme-picker";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { memo } from "react";
import { useTranslation } from "react-i18next";

const SettingsVisualContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const { t } = useTranslation();
    return (
        <div className="@container flex flex-col gap-4 p-4 overflow-y-auto h-full">
            <SettingsCategory title={t("settings.categories.language")} icon="language">
                <LanguageSetting />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.terminalTheme")} icon="palette">
                <ThemePicker />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.font")} icon="font">
                <FontPicker />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.tabBackground")} icon="image">
                <BackgroundPicker />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.appearance")} icon="eye">
                <RestartToggleSetting settingKey="window:transparent" label={t("settings.labels.transparency")} />
                <RestartToggleSetting settingKey="window:blur" label={t("settings.labels.blur")} />
                <SliderSetting settingKey="window:opacity" label={t("settings.labels.windowOpacity")} />
                <ColorSetting settingKey="window:bgcolor" label={t("settings.labels.backgroundColor")} />
                <NumberSetting
                    settingKey="window:tilegapsize"
                    label={t("settings.labels.tileGapSize")}
                    min={0}
                    max={20}
                />
                <SliderSetting
                    settingKey="window:magnifiedblockopacity"
                    label={t("settings.labels.magnifiedBlockOpacity")}
                />
                <ToggleSetting settingKey="window:reducedmotion" label={t("settings.labels.reducedMotion")} />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.terminal")} icon="terminal">
                <ToggleSetting settingKey="term:copyonselect" label={t("settings.labels.copyOnSelect")} />
                <ToggleSetting settingKey="term:disablewebgl" label={t("settings.labels.disableWebGL")} />
                <SliderSetting settingKey="term:transparency" label={t("settings.labels.terminalTransparency")} />
                <NumberSetting
                    settingKey="term:scrollback"
                    label={t("settings.labels.scrollbackLines")}
                    min={100}
                    max={100000}
                    step={100}
                />
                <ToggleSetting settingKey="term:allowbracketedpaste" label={t("settings.labels.bracketedPaste")} />
                <ToggleSetting settingKey="term:bellsound" label={t("settings.labels.bellSound")} />
                <ToggleSetting settingKey="term:bellindicator" label={t("settings.labels.bellIndicator")} />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.editor")} icon="code">
                <ToggleSetting settingKey="editor:minimapenabled" label={t("settings.labels.minimap")} />
                <ToggleSetting settingKey="editor:stickyscrollenabled" label={t("settings.labels.stickyScroll")} />
                <ToggleSetting settingKey="editor:wordwrap" label={t("settings.labels.wordWrap")} />
                <NumberSetting settingKey="editor:fontsize" label={t("settings.labels.fontSize")} min={4} max={64} />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.app")} icon="gear">
                <ToggleSetting settingKey="app:confirmquit" label={t("settings.labels.confirmQuit")} />
                <ToggleSetting settingKey="app:hideaibutton" label={t("settings.labels.hideAIButton")} />
                <TextSetting
                    settingKey="app:globalhotkey"
                    label={t("settings.labels.globalHotkey")}
                    placeholder="e.g. Ctrl+Space"
                />
            </SettingsCategory>

            <SettingsCategory title={t("settings.categories.web")} icon="globe">
                <TextSetting
                    settingKey="web:defaulturl"
                    label={t("settings.labels.defaultUrl")}
                    placeholder="https://..."
                />
                <TextSetting
                    settingKey="web:defaultsearch"
                    label={t("settings.labels.defaultSearch")}
                    placeholder="https://www.google.com/search?q=%s"
                />
            </SettingsCategory>
        </div>
    );
});
SettingsVisualContent.displayName = "SettingsVisualContent";

export { SettingsVisualContent };
