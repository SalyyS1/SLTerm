// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * The Electron shell's implementation of HostApi.
 *
 * Electron's preload script (`emain/preload.ts`) puts the whole surface on
 * `window.api` over contextBridge before the bundle runs, so there is nothing to
 * adapt here. The module exists to be the one place that knows *how* this shell
 * exposes itself — a different shell gets its own module beside this one rather
 * than an edit to the 25 files that call the host.
 */
export function findElectronHost(): ElectronApi | null {
    const win = globalThis.window as any;
    return win?.api ?? null;
}
