// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    allCommands,
    defaultBindings,
    getCommand,
    registerCommand,
    resetCommandsForTest,
    runCommand,
} from "../commands";

describe("command registry", () => {
    beforeEach(() => {
        resetCommandsForTest();
    });

    it("runs a registered command and reports whether it handled the request", () => {
        const handler = vi.fn(() => true);
        registerCommand({ id: "tab:next", label: "Next Tab", defaultBinding: "Cmd:]", handler });

        expect(runCommand("tab:next")).toBe(true);
        expect(handler).toHaveBeenCalledOnce();
    });

    it("passes the keyboard event through, so handlers can inspect modifiers", () => {
        // activateSearch declines when Ctrl is held in a terminal, so a handler
        // that never sees the event cannot make that decision.
        const handler = vi.fn((event?: WaveKeyboardEvent) => event?.control === true);
        registerCommand({ id: "block:search", label: "Search", defaultBinding: "Cmd:f", handler });

        expect(runCommand("block:search", { control: true } as WaveKeyboardEvent)).toBe(true);
        expect(runCommand("block:search", { control: false } as WaveKeyboardEvent)).toBe(false);
    });

    it("returns false for an unknown id instead of throwing", () => {
        // A stale id in a menu or a user's keybindings file should be inert.
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(runCommand("does:not:exist")).toBe(false);
        spy.mockRestore();
    });

    it("rejects a duplicate id rather than letting one handler win silently", () => {
        registerCommand({ id: "dup", label: "First", defaultBinding: null, handler: () => true });
        expect(() =>
            registerCommand({ id: "dup", label: "Second", defaultBinding: null, handler: () => true })
        ).toThrow(/duplicate command id dup/);
        expect(getCommand("dup")?.label).toBe("First");
    });

    it("exposes default bindings keyed by chord, for the keybinding layer to override", () => {
        registerCommand({ id: "tab:next", label: "Next Tab", defaultBinding: "Cmd:]", handler: () => true });
        registerCommand({ id: "tab:prev", label: "Previous Tab", defaultBinding: "Cmd:[", handler: () => true });
        registerCommand({ id: "app:about", label: "About", defaultBinding: null, handler: () => true });

        const bindings = defaultBindings();
        expect(bindings.get("Cmd:]")).toBe("tab:next");
        expect(bindings.get("Cmd:[")).toBe("tab:prev");
        // A menu-only command contributes no chord.
        expect(bindings.size).toBe(2);
    });

    it("enumerates every command, which is what makes the menu port checkable", () => {
        registerCommand({ id: "a", label: "A", defaultBinding: null, group: "File", handler: () => true });
        registerCommand({ id: "b", label: "B", defaultBinding: "Cmd:b", group: "View", handler: () => true });

        expect(allCommands().map((c) => c.id)).toEqual(["a", "b"]);
        expect(allCommands().map((c) => c.group)).toEqual(["File", "View"]);
    });
});
