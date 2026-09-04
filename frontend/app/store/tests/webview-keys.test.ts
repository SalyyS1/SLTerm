// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isBrowserAccelerator } from "../webview-keys";

type Chord = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };

function chord(c: Chord) {
    return { ctrlKey: false, metaKey: false, shiftKey: false, ...c };
}

describe("browser accelerator detection", () => {
    it("catches every route to a reload, which would destroy open terminals", () => {
        expect(isBrowserAccelerator(chord({ key: "F5" }))).toBe(true);
        expect(isBrowserAccelerator(chord({ key: "r", ctrlKey: true }))).toBe(true);
        expect(isBrowserAccelerator(chord({ key: "r", metaKey: true }))).toBe(true);
    });

    it("matches the uppercase key that arrives when Shift is held", () => {
        // With Shift down the browser reports "R", not "r". Comparing only
        // against the lowercase form is why Ctrl+Shift chords appear not to fire.
        expect(isBrowserAccelerator(chord({ key: "R", ctrlKey: true, shiftKey: true }))).toBe(true);
        expect(isBrowserAccelerator(chord({ key: "F", ctrlKey: true, shiftKey: true }))).toBe(true);
        expect(isBrowserAccelerator(chord({ key: "P", ctrlKey: true, shiftKey: true }))).toBe(true);
    });

    it("catches find-on-page, which would search the DOM instead of the scrollback", () => {
        expect(isBrowserAccelerator(chord({ key: "f", ctrlKey: true }))).toBe(true);
        expect(isBrowserAccelerator(chord({ key: "F3" }))).toBe(true);
    });

    it("catches print", () => {
        expect(isBrowserAccelerator(chord({ key: "p", ctrlKey: true }))).toBe(true);
    });

    it("leaves ordinary typing alone", () => {
        expect(isBrowserAccelerator(chord({ key: "r" }))).toBe(false);
        expect(isBrowserAccelerator(chord({ key: "f" }))).toBe(false);
        expect(isBrowserAccelerator(chord({ key: "a", ctrlKey: true }))).toBe(false);
        expect(isBrowserAccelerator(chord({ key: "Enter" }))).toBe(false);
    });

    it("leaves the app's own chords alone", () => {
        // Ctrl+C and Ctrl+V reach the terminal; they are not browser features.
        expect(isBrowserAccelerator(chord({ key: "c", ctrlKey: true }))).toBe(false);
        expect(isBrowserAccelerator(chord({ key: "v", ctrlKey: true }))).toBe(false);
    });
});
