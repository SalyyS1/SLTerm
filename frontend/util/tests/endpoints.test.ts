// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthKeyQueryParam, withAuthKey } from "../endpoints";

/** Stands in for the host bridge the shell installs on window. */
function stubHostAuthKey(authKey: string | null) {
    vi.stubGlobal("window", { api: { getAuthKey: () => authKey } });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("withAuthKey", () => {
    it("appends the key as the first query parameter", () => {
        stubHostAuthKey("deadbeef");
        expect(withAuthKey("http://127.0.0.1:1/wave/stream-file")).toBe(
            `http://127.0.0.1:1/wave/stream-file?${AuthKeyQueryParam}=deadbeef`
        );
    });

    it("appends the key to a URL that already has parameters", () => {
        stubHostAuthKey("deadbeef");
        expect(withAuthKey("http://127.0.0.1:1/wave/stream-file?path=%2Ftmp%2Fa.png")).toBe(
            `http://127.0.0.1:1/wave/stream-file?path=%2Ftmp%2Fa.png&${AuthKeyQueryParam}=deadbeef`
        );
    });

    it("escapes a key that is not URL-safe", () => {
        stubHostAuthKey("a b&c=d");
        expect(withAuthKey("http://127.0.0.1:1/x")).toBe(`http://127.0.0.1:1/x?${AuthKeyQueryParam}=a%20b%26c%3Dd`);
    });

    it("leaves the URL alone when the host has no key", () => {
        stubHostAuthKey(null);
        expect(withAuthKey("http://127.0.0.1:1/x")).toBe("http://127.0.0.1:1/x");
    });

    it("leaves the URL alone outside a webview, where there is no host bridge", () => {
        vi.stubGlobal("window", undefined);
        expect(withAuthKey("http://127.0.0.1:1/x")).toBe("http://127.0.0.1:1/x");
    });
});
