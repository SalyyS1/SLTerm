// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * The registry of things the app can be told to do.
 *
 * Every global action used to be an anonymous closure in a keybinding map, which
 * meant nothing could enumerate them: no id to rebind, no label to show, no way
 * to put the same action in a menu and a palette without writing it twice. This
 * gives each one an id and a label, and keeps the closure as the handler.
 *
 * Three later features read from here rather than duplicating the list — the
 * application menu, the command palette, and user-editable keybindings — so an
 * action registered once is reachable from all of them. Anything not registered
 * is detectable, which is what makes those ports safe to do mechanically.
 */

/** What a command does. Returns true when it handled the request. */
export type CommandHandler = (event?: WaveKeyboardEvent) => boolean;

export type CommandDef = {
    /** Stable identifier. Used by keybindings, menus and the palette. */
    id: string;
    /** Human-readable, shown in menus and the palette. */
    label: string;
    /**
     * Default binding in the app's own key grammar (`Cmd:Shift:d`), or null for
     * a command reachable only from a menu or the palette.
     *
     * "Default" matters: user keybindings layer over this, so the registry keeps
     * what the app shipped with rather than what is currently bound.
     */
    defaultBinding: string | null;
    /** Grouping for menus and palette sections. */
    group?: string;
    handler: CommandHandler;
};

const registry = new Map<string, CommandDef>();

/**
 * Registers a command.
 *
 * Registering the same id twice is a programming error, not a merge: two
 * handlers under one id means one of them silently never runs. It throws, so the
 * mistake surfaces at startup where it is one line to find, rather than as a
 * keybinding that quietly stopped working.
 */
export function registerCommand(def: CommandDef): void {
    if (registry.has(def.id)) {
        throw new Error(`duplicate command id ${def.id}`);
    }
    registry.set(def.id, def);
}

export function getCommand(id: string): CommandDef | undefined {
    return registry.get(id);
}

/** Every registered command, in registration order. */
export function allCommands(): CommandDef[] {
    return Array.from(registry.values());
}

/**
 * Runs a command by id.
 *
 * Returns false for an unknown id rather than throwing: the callers are menus
 * and keybindings, where a stale id should be inert, not fatal.
 */
export function runCommand(id: string, event?: WaveKeyboardEvent): boolean {
    const command = registry.get(id);
    if (command == null) {
        console.error(`no command registered as ${id}`);
        return false;
    }
    return command.handler(event);
}

/**
 * Default bindings as a binding-string → id map.
 *
 * The shape the keybinding layer wants: it merges user overrides on top, so it
 * needs to look up by chord rather than by id. A command with no default
 * binding is absent.
 */
export function defaultBindings(): Map<string, string> {
    const out = new Map<string, string>();
    for (const command of registry.values()) {
        if (command.defaultBinding != null) {
            out.set(command.defaultBinding, command.id);
        }
    }
    return out;
}

/** Clears the registry. Tests only — the app registers once at startup. */
export function resetCommandsForTest(): void {
    registry.clear();
}
