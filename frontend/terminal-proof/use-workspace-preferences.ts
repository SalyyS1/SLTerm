import { useCallback, useRef, useState } from "react";
import { importAppearanceAsset, loadAppearanceFont, type PreviewAsset } from "./appearance-assets";
import { listAssets, loadPreferences, putAsset, savePreferences } from "./preview-preferences-store";
import { newPreferences, parsePreferences, type WorkspacePreferences } from "./workspace-preferences";

export function useWorkspacePreferences() {
    const [value, setValue] = useState(newPreferences);
    const [assets, setAssets] = useState<PreviewAsset[]>([]);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const current = useRef(value);
    const writable = useRef(false);
    const loading = useRef<Promise<WorkspacePreferences> | null>(null);
    const existed = useRef(false);
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const load = useCallback(() => loading.current ??= (async () => {
        try {
            const [raw, storedAssets] = await Promise.all([loadPreferences(), listAssets()]);
            const next = parsePreferences(raw);
            existed.current = raw !== null;
            for (const asset of storedAssets.filter((item) => item.kind === "font")) await loadAppearanceFont(asset);
            current.current = next;
            setValue(next); setAssets(storedAssets); writable.current = true; setReady(true);
            return next;
        } catch (failure) {
            setError(String(failure)); setReady(true);
            throw failure;
        }
    })(), []);
    // Mutators run against the latest committed document, so descriptor autosaves cannot overwrite settings.
    const commit = useCallback((update: (value: WorkspacePreferences) => WorkspacePreferences) => {
        const operation = queue.current.catch(() => {}).then(async () => {
            if (!writable.current) throw new Error("Tùy chỉnh chưa đọc được; chưa ghi đè dữ liệu đã lưu.");
            const next = update(current.current);
            await savePreferences(next);
            current.current = next; setValue(next); setError(null);
        });
        queue.current = operation;
        operation.catch((failure) => setError(String(failure)));
        return operation;
    }, []);
    const importAsset = async (file: File, kind: "background" | "font") => {
        if (!writable.current) throw new Error("Chưa mở được kho tùy chỉnh.");
        const asset = await importAppearanceAsset(file, kind);
        if (kind === "font") await loadAppearanceFont(asset);
        await putAsset(asset);
        setAssets((items) => [...items, asset]);
        return asset;
    };
    const flush = () => queue.current;
    return { value, assets, ready, error, load, commit, importAsset, flush, existed, writable: writable.current };
}
