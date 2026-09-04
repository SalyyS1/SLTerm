// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { shouldConfirmClose } from "../close-window";

function workspace(over: Partial<Workspace>): Workspace {
    return { oid: "ws", version: 1, name: "", icon: "", color: "", tabids: [], meta: {}, ...over } as Workspace;
}

describe("close confirmation", () => {
    it("warns when an unnamed workspace would lose several tabs", () => {
        expect(shouldConfirmClose(true, workspace({ tabids: ["a", "b"] }))).toBe(true);
    });

    it("does not warn for a single tab, which is not worth a prompt", () => {
        expect(shouldConfirmClose(true, workspace({ tabids: ["a"] }))).toBe(false);
    });

    it("does not warn for a named workspace, whose tabs survive the close", () => {
        expect(shouldConfirmClose(true, workspace({ name: "work", tabids: ["a", "b"] }))).toBe(false);
        expect(shouldConfirmClose(true, workspace({ icon: "star", tabids: ["a", "b"] }))).toBe(false);
    });

    it("respects the setting being off", () => {
        expect(shouldConfirmClose(false, workspace({ tabids: ["a", "b"] }))).toBe(false);
    });

    it("does not warn when there is no workspace to lose", () => {
        // Closing before the workspace loads must not prompt about nothing.
        expect(shouldConfirmClose(true, null)).toBe(false);
    });

    it("treats a missing tab list as nothing to lose", () => {
        expect(shouldConfirmClose(true, workspace({ tabids: undefined as unknown as string[] }))).toBe(false);
    });
});
