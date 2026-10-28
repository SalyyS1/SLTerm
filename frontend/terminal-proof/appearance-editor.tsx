import { useEffect, useRef, useState } from "react";
import { loadAppearanceFont, type PreviewAsset } from "./appearance-assets";
import { appearancePresets, type ColorToken } from "./appearance-presets";
import { defaultAppearance, normalizeAppearance, resolvedAppearanceColors, type AppearanceSettings } from "./appearance-settings";
import "./appearance-editor.css";

export type AppearanceEditorProps = {
    value: AppearanceSettings;
    onChange: (next: AppearanceSettings) => void;
    assets: PreviewAsset[];
    onImport: (file: File, kind: PreviewAsset["kind"]) => Promise<PreviewAsset>;
    onRemoveAsset?: (id: string) => void | Promise<void>;
};
const colorLabels: Record<ColorToken, string> = { bg: "Nền workspace", surface: "Thanh công cụ", surfaceRaised: "Bề mặt nổi", surfaceHover: "Di chuột", text: "Chữ", textMuted: "Chữ phụ", line: "Viền", accent: "Màu nhấn", terminalBg: "Nền terminal", terminalFg: "Chữ terminal", selection: "Vùng chọn" };

/** Controlled draft: the owning dialog decides scope, save, cancel, and inheritance. */
export function AppearanceEditor({ value, onChange, assets, onImport, onRemoveAsset }: AppearanceEditorProps) {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true);
    const current = useRef(value);
    current.current = value;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const change = (patch: Partial<AppearanceSettings>) => onChange(normalizeAppearance({ ...current.current, ...patch }));
    const colors = resolvedAppearanceColors(value);
    async function run(task: () => Promise<void>) {
        setBusy(true); setError(null);
        try { await task(); } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { if (mounted.current) setBusy(false); }
    }
    async function chooseFont(id: string) {
        if (!id) { change({ terminalFontAssetId: "", terminalFontFamily: defaultAppearance.terminalFontFamily }); return; }
        const asset = assets.find((candidate) => candidate.id === id && candidate.kind === "font");
        if (!asset) throw new Error("Font asset was not found.");
        const family = await loadAppearanceFont(asset);
        if (mounted.current) change({ terminalFontAssetId: asset.id, terminalFontFamily: `"${family}", monospace` });
    }
    async function importFile(file: File, kind: PreviewAsset["kind"]) {
        const asset = await onImport(file, kind);
        const font = kind === "font" ? await loadAppearanceFont(asset) : undefined;
        if (!mounted.current) return;
        change(kind === "background" ? { backgroundAssetId: asset.id } : { terminalFontAssetId: asset.id, terminalFontFamily: `"${font}", monospace` });
    }
    const number = (key: keyof AppearanceSettings, label: string, min: number, max: number, step = 1) => <label className="appearance-field" key={key}>
        <span>{label}</span><input type="number" min={min} max={max} step={step} value={value[key] as number} onChange={(event) => {
            if (event.currentTarget.value !== "") change({ [key]: event.currentTarget.valueAsNumber });
        }} />
    </label>;
    const upload = (kind: PreviewAsset["kind"]) => <label className="appearance-field appearance-upload">
        <span>{kind === "background" ? "Tải ảnh từ máy (tối đa 8 MiB)" : "Tải font từ máy (tối đa 4 MiB)"}</span>
        <input type="file" disabled={busy} accept={kind === "background" ? ".png,.jpg,.jpeg,.webp,.gif" : ".ttf,.otf,.woff,.woff2"} onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (file) void run(() => importFile(file, kind));
        }} />
    </label>;
    return <div className="appearance-editor" aria-busy={busy}>
        <div className="appearance-heading"><h3>Giao diện</h3><button type="button" className="button" disabled={busy} onClick={() => onChange(normalizeAppearance(defaultAppearance))}>Khôi phục mặc định</button></div>
        {error && <p className="appearance-error" role="alert">{error}</p>}
        {busy && <p className="field-hint" role="status">Đang kiểm tra và tải file…</p>}
        <label className="appearance-field"><span>Theme có sẵn</span><select value={value.themeId} onChange={(event) => change({ themeId: event.currentTarget.value, colors: {} })}>
            {appearancePresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name} · {preset.mode}</option>)}
        </select></label>
        <div className="appearance-swatch-preview" style={{ background: colors.terminalBg, color: colors.terminalFg, fontFamily: value.terminalFontFamily, fontSize: value.terminalFontSize, lineHeight: value.lineHeight, letterSpacing: value.letterSpacing }} aria-label="Xem trước terminal">
            <span style={{ color: colors.accent }}>PS C:\Workspace&gt;</span> Write-Output "Hello, terminal"<br />Hello, terminal<span className="appearance-cursor" data-style={value.cursorStyle} data-blink={value.cursorBlink} style={{ borderColor: colors.accent, background: value.cursorStyle === "block" ? colors.accent : undefined }} />
        </div>
        <details><summary>Tùy chỉnh màu</summary><div className="appearance-color-grid">
            {(Object.keys(colorLabels) as ColorToken[]).map((key) => <label className="appearance-color" key={key}><span>{colorLabels[key]}</span><input type="color" aria-label={colorLabels[key]} value={colors[key]} onChange={(event) => change({ colors: { ...value.colors, [key]: event.currentTarget.value } })} /><button type="button" className="button button-ghost" disabled={!value.colors[key]} onClick={() => { const next = { ...value.colors }; delete next[key]; change({ colors: next }); }}>Đặt lại</button></label>)}
        </div></details>
        <fieldset><legend>Phông chữ</legend><div className="appearance-grid">
            <label className="appearance-field"><span>Họ font terminal</span><input value={value.terminalFontAssetId ? assets.find((asset) => asset.id === value.terminalFontAssetId)?.name ?? "Font đã tải lên" : value.terminalFontFamily} disabled={Boolean(value.terminalFontAssetId)} title={value.terminalFontAssetId ? "Chọn font hệ thống bên dưới để nhập họ font thủ công" : undefined} maxLength={240} onChange={(event) => change({ terminalFontFamily: event.currentTarget.value, terminalFontAssetId: "" })} /></label>
            <label className="appearance-field"><span>Họ font giao diện</span><input value={value.uiFontFamily} maxLength={240} onChange={(event) => change({ uiFontFamily: event.currentTarget.value })} /></label>
            <label className="appearance-field"><span>Font terminal đã tải lên</span><select disabled={busy} value={value.terminalFontAssetId ?? ""} onChange={(event) => { const id = event.currentTarget.value; void run(() => chooseFont(id)); }}><option value="">Font hệ thống</option>{assets.filter((asset) => asset.kind === "font").map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label>
            {upload("font")}
            {number("terminalFontSize", "Cỡ chữ terminal (px)", 8, 40)}{number("uiFontSize", "Cỡ chữ giao diện (px)", 10, 24)}
            {number("lineHeight", "Chiều cao dòng", 1, 2.5, .05)}{number("letterSpacing", "Khoảng cách chữ (px)", -2, 10, .1)}
        </div></fieldset>
        <fieldset><legend>Terminal và giao diện</legend><div className="appearance-grid">
            <label className="appearance-field"><span>Con trỏ</span><select value={value.cursorStyle} onChange={(event) => change({ cursorStyle: event.currentTarget.value as AppearanceSettings["cursorStyle"] })}><option value="bar">Thanh dọc</option><option value="block">Khối</option><option value="underline">Gạch dưới</option></select></label>
            <label className="appearance-check"><input type="checkbox" checked={value.cursorBlink} onChange={(event) => change({ cursorBlink: event.currentTarget.checked })} />Nhấp nháy con trỏ</label>
            {number("scrollback", "Số dòng lưu khi cuộn", 100, 100000, 100)}
            <label className="appearance-field"><span>Mật độ</span><select value={value.density} onChange={(event) => change({ density: event.currentTarget.value as AppearanceSettings["density"] })}><option value="compact">Gọn</option><option value="comfortable">Thoáng</option></select></label>
            {number("radius", "Bo góc (px)", 0, 24)}{number("terminalOpacity", "Độ đậm nền terminal", 0, 1, .05)}
        </div></fieldset>
        <fieldset><legend>Ảnh nền workspace</legend><div className="appearance-grid">
            <label className="appearance-field"><span>Ảnh</span><select value={value.backgroundAssetId ?? ""} onChange={(event) => change({ backgroundAssetId: event.currentTarget.value })}><option value="">Không dùng ảnh</option>{assets.filter((asset) => asset.kind === "background").map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label>
            {upload("background")}
            <label className="appearance-field"><span>Cách căn ảnh</span><select value={value.backgroundFit} onChange={(event) => change({ backgroundFit: event.currentTarget.value as AppearanceSettings["backgroundFit"] })}><option value="cover">Lấp đầy</option><option value="contain">Vừa khung</option><option value="tile">Lặp ảnh</option></select></label>
            {number("backgroundOpacity", "Độ đậm ảnh", 0, 1, .05)}{number("backgroundBlur", "Làm mờ ảnh (px)", 0, 20)}
        </div></fieldset>
        {onRemoveAsset && assets.length > 0 && <details><summary>Quản lý ảnh và font đã tải</summary><ul className="appearance-assets">{assets.map((asset) => <li key={asset.id}><span>{asset.name}<small>{asset.kind} · {(asset.blob.size / 1024).toFixed(0)} KiB</small></span><button type="button" className="button" disabled={busy} onClick={() => void run(async () => {
            await onRemoveAsset(asset.id);
            if (mounted.current) change({ ...(current.current.backgroundAssetId === asset.id ? { backgroundAssetId: "" } : {}), ...(current.current.terminalFontAssetId === asset.id ? { terminalFontAssetId: "", terminalFontFamily: defaultAppearance.terminalFontFamily } : {}) });
        })}>Xóa</button></li>)}</ul></details>}
    </div>;
}
