// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
    cycleRemFxMode,
    cycleRemTheme,
    getRemFxMode,
    getRemTheme,
    setRemFxMode,
    setRemTheme,
} from "../../../element/rem-ambient";

function installMemoryStorage() {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
            store.set(k, String(v));
        },
        removeItem: (k: string) => {
            store.delete(k);
        },
        clear: () => store.clear(),
    };
}

describe("Rem Aqua workspace theme & ambient FX persistence", () => {
    beforeEach(() => {
        installMemoryStorage();
    });

    it("defaults to rem-aqua theme and cycles cleanly through all 3 Rem themes", () => {
        expect(getRemTheme()).toBe("rem-aqua");
        expect(cycleRemTheme()).toBe("rem-twilight");
        expect(getRemTheme()).toBe("rem-twilight");
        expect(cycleRemTheme()).toBe("glacier-mist");
        expect(cycleRemTheme()).toBe("rem-aqua");
    });

    it("persists explicit theme selections and ignores corrupt values", () => {
        setRemTheme("glacier-mist");
        expect(getRemTheme()).toBe("glacier-mist");
        (globalThis as any).localStorage.setItem("slterm-rem-theme", "invalid-theme");
        expect(getRemTheme()).toBe("rem-aqua");
    });

    it("defaults to calm FX mode and cycles through calm -> dreamy -> off -> calm", () => {
        expect(getRemFxMode()).toBe("calm");
        expect(cycleRemFxMode()).toBe("dreamy");
        expect(cycleRemFxMode()).toBe("off");
        expect(getRemFxMode()).toBe("off");
        expect(cycleRemFxMode()).toBe("calm");
        setRemFxMode("dreamy");
        expect(getRemFxMode()).toBe("dreamy");
    });
});
