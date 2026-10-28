import { describe, expect, it } from "vitest";
import { assertAssetMetadata, fontFamilyForAsset, importAppearanceAsset, MAX_BACKGROUND_BYTES, MAX_FONT_BYTES, validateAppearanceAsset, type PreviewAsset } from "./appearance-assets";
import { savePreferences } from "./preview-preferences-store";

const asset = (patch: Partial<PreviewAsset> = {}): PreviewAsset => ({ id: "test-image", name: "test.png", kind: "background", mime: "image/png", blob: new Blob(["invalid-image"]), ...patch });
describe("local asset boundaries", () => {
    it("rejects remote IDs, absent IDs, SVG, and unsupported blobs", () => {
        for (const value of [asset({ id: "../image" }), { ...asset(), id: undefined }, asset({ mime: "image/svg+xml" }), asset({ blob: new Blob() }), asset({ kind: "unknown" as "font" })]) expect(() => assertAssetMetadata(value)).toThrow();
        expect(() => assertAssetMetadata(asset())).not.toThrow();
        expect(() => fontFamilyForAsset("url(remote)")).toThrow();
        expect(fontFamilyForAsset("stable-id_42")).toBe("SLTermLocal_stable-id_42");
        expect(fontFamilyForAsset("stable-id")).not.toBe(fontFamilyForAsset("stable_id"));
    });
    it("bounds blob sizes before decoding", () => {
        expect(() => assertAssetMetadata(asset({ blob: new Blob([new Uint8Array(MAX_BACKGROUND_BYTES + 1)]) }))).toThrow();
        expect(() => assertAssetMetadata(asset({ kind: "font", mime: "font/woff2", blob: new Blob([new Uint8Array(MAX_FONT_BYTES + 1)]) }))).toThrow();
    });
    it("checks byte signatures rather than trusting file extensions or MIME", async () => {
        await expect(validateAppearanceAsset(asset())).rejects.toThrow("contents do not match");
        await expect(validateAppearanceAsset(asset({ kind: "font", mime: "font/ttf" }))).rejects.toThrow("contents do not match");
        await expect(importAppearanceAsset(new File(["<svg/>"], "vector.svg", { type: "image/svg+xml" }), "background")).rejects.toThrow("PNG");
        await expect(importAppearanceAsset(new File(["<svg/>"], "renamed.png", { type: "image/png" }), "background")).rejects.toThrow("contents do not match");
        await expect(importAppearanceAsset(new File(["not-a-font"], "renamed.woff2"), "font")).rejects.toThrow("contents do not match");
    });
    it("rejects preferences that cannot be stored before touching the database", async () => {
        const circular: Record<string, unknown> = {}; circular.self = circular;
        await expect(savePreferences(circular)).rejects.toThrow();
        await expect(savePreferences(undefined)).rejects.toThrow("must be JSON");
        await expect(savePreferences({ huge: "x".repeat(1024 * 1024) })).rejects.toThrow("smaller than");
    });
});
