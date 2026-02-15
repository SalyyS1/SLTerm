// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { changeLanguage, getCurrentLanguage } from "@/i18n/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const LANGUAGES = [
    { code: "en", label: "English" },
    { code: "vi", label: "Tiếng Việt" },
];

const LanguageSetting = () => {
    const { t } = useTranslation();
    const [currentLang, setCurrentLang] = useState(getCurrentLanguage());

    const handleChange = async (lang: string) => {
        changeLanguage(lang);
        setCurrentLang(lang);
        // Save to settings
        try {
            await RpcApi.SetConfigCommand(TabRpcClient, {
                "app:language": lang,
            } as any);
        } catch (e) {
            console.error("Failed to save language setting:", e);
        }
    };

    return (
        <div className="flex items-center justify-between py-2 px-1">
            <label className="text-sm text-secondary">{t("settings.labels.language")}</label>
            <div className="flex gap-2">
                {LANGUAGES.map((lang) => (
                    <button
                        key={lang.code}
                        onClick={() => handleChange(lang.code)}
                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                            currentLang === lang.code
                                ? "bg-accent text-white"
                                : "bg-transparent border border-border text-secondary hover:bg-hoverbg hover:text-white"
                        }`}
                    >
                        {lang.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

LanguageSetting.displayName = "LanguageSetting";

export { LanguageSetting };
