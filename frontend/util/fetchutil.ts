// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Utility to abstract the fetch function so the Electron net module can be used when available.

import { getWebServerEndpoint } from "./endpoints";
import { getAuthKey } from "./getenv";

let net: Electron.Net;

if (typeof window === "undefined") {
    try {
        import("electron").then(({ net: electronNet }) => (net = electronNet));
    } catch (e) {
        // do nothing
    }
}

/**
 * Attaches the auth key to requests aimed at our own server.
 *
 * Electron injected X-AuthKey into every request from the renderer; no other
 * shell can, so the header is set here instead. Scoped to the local server so a
 * call to a third-party API can never carry the secret.
 */
function withAuthHeader(input: string | GlobalRequest | URL, init?: RequestInit): RequestInit | undefined {
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.startsWith(getWebServerEndpoint())) {
        return init;
    }
    const authKey = getAuthKey();
    if (!authKey) {
        return init;
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-AuthKey", authKey);
    return { ...init, headers };
}

export function fetch(input: string | GlobalRequest | URL, init?: RequestInit): Promise<Response> {
    const authedInit = withAuthHeader(input, init);
    if (net) {
        return net.fetch(input.toString(), authedInit);
    } else {
        return globalThis.fetch(input, authedInit);
    }
}
