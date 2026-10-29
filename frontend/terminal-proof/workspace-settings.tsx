import { useEffect, useRef, useState } from "react";
import { AppearanceEditor } from "./appearance-editor";
import { ShortcutEditor } from "./shortcut-editor";
import { appearanceFor, shortcutsFor, type WorkspacePreferences } from "./workspace-preferences";
import { validateShortcutBindings } from "./workspace-shortcuts";
import type { useWorkspacePreferences } from "./use-workspace-preferences";
import { parseLegacyProfileJson, type LegacyImportPreview } from "./legacy-profile-import";

export function WorkspaceSettings({ preferences, workspaceId, workspaceName, close }: {
    preferences: ReturnType<typeof useWorkspacePreferences>; workspaceId?: string; workspaceName?: string; close: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const [draft, setDraft] = useState<WorkspacePreferences>(preferences.value);
    const [scope, setScope] = useState("global");
    const [tab, setTab] = useState("appearance");
    const [busy, setBusy] = useState(false);
    const [assetBusy, setAssetBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [legacyImport, setLegacyImport] = useState<LegacyImportPreview | null>(null);
    const legacyInput = useRef<HTMLInputElement>(null);
    const local = scope === "workspace" && workspaceId;
    const settings = appearanceFor(draft, local || undefined);
    const bindings = shortcutsFor(draft, local || undefined);
    useEffect(() => { ref.current?.showModal(); }, []);
    return <dialog ref={ref} className="app-dialog settings-dialog" aria-labelledby="settings-title"
        onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
        <div className="dialog-heading"><h2 id="settings-title">Tùy chỉnh SLTerm</h2>
            <button className="button" disabled={busy} onClick={close}>Đóng</button></div>
        <div className="settings-controls">
            <label>Áp dụng cho <select aria-label="Phạm vi tùy chỉnh" value={scope} disabled={busy} onChange={(event) => setScope(event.target.value)}>
                <option value="global">Mặc định chung</option><option value="workspace" disabled={!workspaceId}>{workspaceName ?? "Workspace"}</option>
            </select></label>
            <div className="settings-tabs"><button className="button" aria-pressed={tab === "appearance"} onClick={() => setTab("appearance")}>Giao diện</button>
                <button className="button" aria-pressed={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>Phím tắt</button></div>
            {local && <><p className="field-hint">{draft.overrides[local]?.[tab === "appearance" ? "appearance" : "shortcuts"] ? "Đang dùng tùy chỉnh riêng." : "Đang kế thừa mặc định chung. Chỉnh để ghi đè nhóm này."}</p>
                <button className="button" disabled={busy} onClick={() => setDraft((value) => ({ ...value, overrides: { ...value.overrides,
                    [local]: { ...value.overrides[local], [tab === "appearance" ? "appearance" : "shortcuts"]: undefined } } }))}>Dùng lại mặc định chung</button></>}
        </div>
        <fieldset className="settings-content" disabled={busy}>
            {tab === "appearance" ? <AppearanceEditor value={settings} assets={preferences.assets} onImport={async (file, kind) => {
                setAssetBusy(true);
                try { return await preferences.importAsset(file, kind); } finally { setAssetBusy(false); }
            }}
                onChange={(appearance) => setDraft((value) => local ? { ...value, overrides: { ...value.overrides, [local]: { ...value.overrides[local], appearance } } } : { ...value, appearance })} />
                : <ShortcutEditor value={bindings} onChange={(shortcuts) => setDraft((value) => local ? { ...value, overrides: { ...value.overrides, [local]: { ...value.overrides[local], shortcuts } } } : { ...value, shortcuts })} />}
        </fieldset>
        <section className="settings-import" aria-label="Nhập profile SLTerm cũ">
            <h3>Nhập profile cũ</h3>
            <p className="field-hint">Chỉ đọc JSON bạn chọn. SLTerm chỉ lấy font, cỡ chữ, scrollback và theme; secrets, lệnh, connections và process cũ không được chạy hoặc sao chép.</p>
            <input ref={legacyInput} type="file" accept="application/json,.json" hidden onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                try { setError(null); setLegacyImport(parseLegacyProfileJson(file.name, await file.text())); }
                catch (failure) { setLegacyImport(null); setError(String(failure)); }
            }} />
            <button className="button" disabled={busy || assetBusy} onClick={() => legacyInput.current?.click()}>Chọn JSON profile cũ</button>
            {legacyImport && <div className="settings-import-preview" role="status">
                <strong>{legacyImport.sourceName}</strong>
                <span>{legacyImport.importedFields.length ? `Đọc được: ${legacyImport.importedFields.join(", ")}.` : "Không có setting được hỗ trợ."}</span>
                {legacyImport.skippedFields.length > 0 && <span>Bỏ qua: {legacyImport.skippedFields.join(", ")}.</span>}
                {legacyImport.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                {legacyImport.importedFields.length > 0 && <button className="button button-ghost" onClick={() => setDraft((value) => local
                    ? { ...value, overrides: { ...value.overrides, [local]: { ...value.overrides[local], appearance: { ...settings, ...legacyImport.appearance } } } }
                    : { ...value, appearance: { ...value.appearance, ...legacyImport.appearance } })}>Áp dụng vào bản nháp</button>}
            </div>}
        </section>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions"><span className="field-hint">Ảnh/font được lưu local. Chọn Lưu để áp dụng.</span>
            <button className="button" disabled={busy} onClick={close}>Hủy</button>
            <button className="button button-primary" disabled={busy || assetBusy || !preferences.writable} onClick={async () => {
                setBusy(true); setError(null);
                try {
                    const issues = [draft.shortcuts, ...Object.values(draft.overrides).flatMap((item) => item.shortcuts ? [item.shortcuts] : [])].flatMap(validateShortcutBindings);
                    if (issues.length) throw new Error(issues[0].message);
                    await preferences.commit((current) => ({ ...current, appearance: draft.appearance, shortcuts: draft.shortcuts, overrides: draft.overrides }));
                    close();
                } catch (failure) { setError(String(failure)); setBusy(false); }
            }}>{busy ? "Đang lưu…" : "Lưu tùy chỉnh"}</button></div>
    </dialog>;
}
