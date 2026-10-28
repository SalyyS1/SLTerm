export type PreviewAsset = { id: string; name: string; kind: "background" | "font"; mime: string; blob: Blob };
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;
export const MAX_FONT_BYTES = 4 * 1024 * 1024;
const fonts = new Map<string, Promise<FontFace>>();
const loadedFonts = new Map<string, FontFace>();
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);

export function fontFamilyForAsset(id: string): string {
    if (!validId(id)) throw new Error("Invalid font asset ID.");
    return `SLTermLocal_${id}`;
}
export function assertAssetMetadata(value: unknown): asserts value is PreviewAsset {
    const asset = value as PreviewAsset;
    if (!asset || !validId(asset.id) || typeof asset.name !== "string" || asset.name.length > 255 || !asset.name.trim() || !(asset.blob instanceof Blob)) throw new Error("Invalid stored asset.");
    const allowed = asset.kind === "background" ? ["image/png", "image/jpeg", "image/webp", "image/gif"] : asset.kind === "font" ? ["font/ttf", "font/otf", "font/woff", "font/woff2"] : [];
    const limit = asset.kind === "background" ? MAX_BACKGROUND_BYTES : MAX_FONT_BYTES;
    if (!allowed.includes(asset.mime) || asset.blob.size < 1 || asset.blob.size > limit) throw new Error("Unsupported asset type or size.");
}
function imageType(bytes: Uint8Array): string | undefined {
    const starts = (...prefix: number[]) => prefix.every((value, index) => bytes[index] === value);
    if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
    if (starts(255, 216, 255)) return "image/jpeg";
    if (starts(71, 73, 70, 56) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97) return "image/gif";
    if (starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
}
function fontType(bytes: Uint8Array): string | undefined {
    const signature = String.fromCharCode(...bytes.slice(0, 4));
    if (signature === "wOFF") return "font/woff";
    if (signature === "wOF2") return "font/woff2";
    if (signature === "OTTO") return "font/otf";
    if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return "font/ttf";
}
async function decodeBackground(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 16384 || image.naturalHeight > 16384 || image.naturalWidth * image.naturalHeight > 32000000) throw new Error("Background dimensions exceed the 32 megapixel limit.");
    } finally { URL.revokeObjectURL(url); }
}
export async function validateAppearanceAsset(asset: PreviewAsset): Promise<void> {
    assertAssetMetadata(asset);
    const bytes = new Uint8Array(await asset.blob.slice(0, 16).arrayBuffer());
    const detected = asset.kind === "background" ? imageType(bytes) : fontType(bytes);
    if (detected !== asset.mime) throw new Error("The file contents do not match the asset type.");
    if (asset.kind === "background") await decodeBackground(asset.blob);
    else await new FontFace(fontFamilyForAsset(asset.id), await asset.blob.arrayBuffer()).load();
}
export async function importAppearanceAsset(file: File, kind: PreviewAsset["kind"]): Promise<PreviewAsset> {
    const limit = kind === "background" ? MAX_BACKGROUND_BYTES : MAX_FONT_BYTES;
    if (!file.size || file.size > limit) throw new Error(`${kind === "font" ? "Font" : "Background"} must be smaller than ${limit / 1024 / 1024} MiB.`);
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    const types: Record<string, string> = kind === "background" ? { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } : { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
    const mime = types[extension];
    if (!mime) throw new Error(kind === "background" ? "Choose a PNG, JPEG, WebP, or GIF file." : "Choose a TTF, OTF, WOFF, or WOFF2 font.");
    const asset: PreviewAsset = { id: crypto.randomUUID(), name: file.name.slice(0, 255), kind, mime, blob: file.slice(0, file.size, mime) };
    await validateAppearanceAsset(asset);
    return asset;
}
/** Await before applying terminal options and requesting a terminal refit. */
export async function loadAppearanceFont(asset: PreviewAsset): Promise<string> {
    assertAssetMetadata(asset);
    if (asset.kind !== "font") throw new Error("Expected a font asset.");
    let pending = fonts.get(asset.id);
    if (!pending) {
        pending = (async () => {
            await validateAppearanceAsset(asset);
            const font = await new FontFace(fontFamilyForAsset(asset.id), await asset.blob.arrayBuffer()).load();
            document.fonts.add(font);
            loadedFonts.set(asset.id, font);
            return font;
        })();
        fonts.set(asset.id, pending);
        pending.catch(() => { if (fonts.get(asset.id) === pending) fonts.delete(asset.id); });
    }
    await pending;
    return fontFamilyForAsset(asset.id);
}
export async function releaseAppearanceFont(id: string): Promise<void> {
    const pending = fonts.get(id);
    if (pending) await pending.catch(() => undefined);
    const font = loadedFonts.get(id);
    if (font) document.fonts.delete(font);
    loadedFonts.delete(id);
    fonts.delete(id);
}
/** Caller owns the URL and must dispose when replacing the image or unmounting. */
export function createBackgroundUrl(asset: PreviewAsset): { url: string; dispose: () => void } {
    assertAssetMetadata(asset);
    if (asset.kind !== "background") throw new Error("Expected a background asset.");
    const url = URL.createObjectURL(asset.blob);
    return { url, dispose: () => URL.revokeObjectURL(url) };
}
