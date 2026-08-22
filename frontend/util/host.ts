// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Resolution of the shell hosting this frontend.
 *
 * The frontend reaches its shell through exactly one contract (HostApi, declared
 * in types/custom.d.ts) resolved in exactly one place (here). That is what turns
 * replacing the shell from a rewrite into adding a module beside
 * electron-host.ts and one branch below.
 */

import { findElectronHost } from "./electron-host";
import { findTauriHost } from "./tauri-host";

/**
 * Finds the host, or null when there is none.
 *
 * There legitimately is none in the Electron main process and under a test
 * runner, where code shared with the renderer still has to work. Resolved per
 * call rather than cached: the lookup is a property read, and caching it would
 * mean the first call in a process decided the answer for every later one.
 */
export function findHostApi(): HostApi | null {
    // Tauri first: its snapshot is unambiguous, and during the transition a build
    // could carry both shells' bridges.
    return findTauriHost() ?? findElectronHost();
}

/**
 * Returns the host, failing loudly when the shell did not install one.
 *
 * Without the throw, a missing bridge surfaces as "cannot read properties of
 * undefined" from whichever feature happened to touch the host first, which says
 * nothing about the actual cause.
 */
export function getHostApi(): HostApi {
    const host = findHostApi();
    if (host == null) {
        throw new Error("no shell host on window.api: the frontend cannot run without one");
    }
    return host;
}
