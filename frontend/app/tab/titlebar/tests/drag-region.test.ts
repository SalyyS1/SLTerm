// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { shouldStartDrag } from "../drag-region";

/** Minimal stand-in for the parts of an element the guard inspects. */
function targetMatching(selectors: string[]): EventTarget {
    return {
        closest: (selector: string) => {
            const wanted = selector.split(",").map((s) => s.trim());
            return wanted.some((w) => selectors.includes(w)) ? {} : null;
        },
    } as unknown as EventTarget;
}

const plainArea = targetMatching([]);

describe("titlebar drag guard", () => {
    it("drags on a primary-button press over empty title area", () => {
        expect(shouldStartDrag({ button: 0, buttons: 1, target: plainArea })).toBe(true);
    });

    it("ignores the right button, which opens a context menu", () => {
        expect(shouldStartDrag({ button: 2, buttons: 2, target: plainArea })).toBe(false);
    });

    it("ignores the middle button, which pastes on Linux", () => {
        expect(shouldStartDrag({ button: 1, buttons: 4, target: plainArea })).toBe(false);
    });

    it("ignores a press with a second button already held", () => {
        // buttons is a bitmask of everything down; 3 means left+right. Starting a
        // drag here hands the OS a gesture the user did not ask for.
        expect(shouldStartDrag({ button: 0, buttons: 3, target: plainArea })).toBe(false);
    });

    it("does not drag from a button, so window controls and the add-tab button still click", () => {
        // startDragging swallows the matching mouseup, so a drag started here
        // would mean the click never fires at all.
        expect(shouldStartDrag({ button: 0, buttons: 1, target: targetMatching(["button"]) })).toBe(false);
    });

    it("does not drag from an input, so the workspace name stays editable", () => {
        expect(shouldStartDrag({ button: 0, buttons: 1, target: targetMatching(["input"]) })).toBe(false);
    });

    it("honours the .no-drag opt-out for anything else interactive", () => {
        expect(shouldStartDrag({ button: 0, buttons: 1, target: targetMatching([".no-drag"]) })).toBe(false);
    });

    it("does not drag when the event has no usable target", () => {
        expect(shouldStartDrag({ button: 0, buttons: 1, target: null })).toBe(false);
    });
});
