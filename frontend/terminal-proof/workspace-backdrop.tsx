import { useEffect, useState } from "react";
import { createBackgroundUrl, type PreviewAsset } from "./appearance-assets";
import type { AppearanceSettings } from "./appearance-settings";

export function WorkspaceBackdrop({ settings, assets }: { settings: AppearanceSettings; assets: PreviewAsset[] }) {
    const [url, setUrl] = useState<string>();
    const asset = assets.find((item) => item.id === settings.backgroundAssetId && item.kind === "background");
    useEffect(() => {
        if (!asset) { setUrl(undefined); return; }
        const resource = createBackgroundUrl(asset); setUrl(resource.url);
        return resource.dispose;
    }, [asset]);
    return url ? <div className="workspace-backdrop" aria-hidden="true" style={{ backgroundImage: `url("${url}")`,
        backgroundSize: settings.backgroundFit === "tile" ? "auto" : settings.backgroundFit,
        backgroundRepeat: settings.backgroundFit === "tile" ? "repeat" : "no-repeat",
        opacity: settings.backgroundOpacity, filter: `blur(${settings.backgroundBlur}px)` }} /> : null;
}
