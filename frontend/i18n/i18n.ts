// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import vi from "./locales/vi.json";

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        vi: { translation: vi },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: {
        escapeValue: false,
    },
});

export default i18n;

// Helper to change language at runtime
export function changeLanguage(lang: string) {
    i18n.changeLanguage(lang);
}

export function getCurrentLanguage(): string {
    return i18n.language;
}
