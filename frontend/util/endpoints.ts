// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { getAuthKey, getEnv } from "./getenv";
import { lazy } from "./util";

export const WebServerEndpointVarName = "WAVE_SERVER_WEB_ENDPOINT";
export const WSServerEndpointVarName = "WAVE_SERVER_WS_ENDPOINT";

export const getWebServerEndpoint = lazy(() => `http://${getEnv(WebServerEndpointVarName)}`);

export const getWSServerEndpoint = lazy(() => `ws://${getEnv(WSServerEndpointVarName)}`);

/** Query parameter pkg/authkey accepts in place of the X-AuthKey header. */
export const AuthKeyQueryParam = "authkey";

/**
 * Adds the auth key to a server URL the webview loads by itself.
 *
 * Under Electron every request had X-AuthKey injected by a session.webRequest
 * handler, so no URL had to carry it. No other shell can inject headers that
 * way, and a URL handed to <img>, <video> or an iframe could not carry one
 * regardless — the engine issues those loads, not our code. The server accepts
 * the key from either place, so subresource URLs pass it here.
 *
 * Programmatic requests keep using the header; see util/fetchutil.
 */
export function withAuthKey(url: string): string {
    const authKey = getAuthKey();
    if (!authKey) {
        return url;
    }
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}${AuthKeyQueryParam}=${encodeURIComponent(authKey)}`;
}
