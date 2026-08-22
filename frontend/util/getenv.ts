// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { findHostApi } from "./host";

function getProcess(): NodeJS.Process {
    return globalThis.process;
}

/**
 * Gets an environment variable from the host process, either directly or via IPC if called from the browser.
 * @param paramName The name of the environment variable to attempt to retrieve.
 * @returns The value of the environment variable or null if not present.
 */
export function getEnv(paramName: string): string {
    const host = findHostApi();
    if (host != null) {
        return host.getEnv(paramName);
    }
    // No shell bridge: this is the main process or a test runner, where the
    // variables are simply in our own environment.
    const proc = getProcess();
    if (proc != null) {
        return proc.env[paramName];
    }
    return null;
}

/**
 * Gets the shared secret every request to the local server has to present.
 *
 * The host process generates it and the server never accepts a request without
 * it, so a page loaded outside the app cannot reach the API on the loopback port.
 */
export function getAuthKey(): string {
    return findHostApi()?.getAuthKey() ?? null;
}
