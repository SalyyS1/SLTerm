// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0s

import { getWebServerEndpoint } from "@/util/endpoints";
import { boundNumber, isBlank } from "@/util/util";

function encodeFileURL(file: string) {
    const webEndpoint = getWebServerEndpoint();
    const fileUri = formatRemoteUri(file, "local");
    return webEndpoint + `/wave/stream-file?path=${encodeURIComponent(fileUri)}&no404=1`;
}

// Allow CSS color values, gradients, and local file url() backgrounds
// Blocks http/https/data URLs for security — only local paths allowed
export function processBackgroundUrls(cssText: string): string {
    if (isBlank(cssText)) {
        return null;
    }
    cssText = cssText.trim();
    if (cssText.endsWith(";")) {
        cssText = cssText.slice(0, -1);
    }
    const attrRe = /^background(-image)?\s*:\s*/i;
    cssText = cssText.replace(attrRe, "");

    // Process url() references — only allow local file paths
    cssText = cssText.replace(/url\(\s*['"]?(.*?)['"]?\s*\)/gi, (_match, rawUrl: string) => {
        const url = rawUrl.trim();
        // Block remote URLs
        if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("data:")) {
            return "none";
        }
        // Allow app-relative static asset URLs
        if (url.startsWith("/backgrounds/") || url.startsWith("/assets/")) {
            return `url('${url}')`;
        }
        // Allow file:// URLs (absolute only)
        if (url.startsWith("file://")) {
            const path = url.slice(7);
            if (!path.startsWith("/") && !/^[a-zA-Z]:(\/|\\)/.test(path)) {
                return "none";
            }
            return `url('${encodeFileURL(path)}')`;
        }
        // Allow absolute paths
        if (url.startsWith("/") || url.startsWith("~/") || /^[a-zA-Z]:(\/|\\)/.test(url)) {
            return `url('${encodeFileURL(url)}')`;
        }
        return "none";
    });
    return cssText;
}

export function computeBgStyleFromMeta(meta: MetaType, defaultOpacity: number = null): React.CSSProperties {
    const bgAttr = meta?.["bg"];
    if (isBlank(bgAttr)) {
        return null;
    }
    try {
        const processedBg = processBackgroundUrls(bgAttr);
        if (processedBg == null) {
            return null;
        }
        const rtn: React.CSSProperties = {};
        // For url() images, use backgroundImage (not background shorthand which resets size/position)
        if (/url\s*\(/i.test(processedBg)) {
            rtn.backgroundImage = processedBg;
            rtn.backgroundSize = "cover";
            rtn.backgroundPosition = "center";
            rtn.backgroundRepeat = "no-repeat";
        } else {
            rtn.background = processedBg;
        }
        rtn.opacity = boundNumber(meta["bg:opacity"], 0, 1) ?? defaultOpacity;
        if (!isBlank(meta?.["bg:blendmode"])) {
            rtn.backgroundBlendMode = meta["bg:blendmode"];
        }
        return rtn;
    } catch (e) {
        console.error("error processing background", e);
        return null;
    }
}

export function formatRemoteUri(path: string, connection: string): string {
    connection = connection ?? "local";
    return `wsh://${connection}/${path}`;
}
