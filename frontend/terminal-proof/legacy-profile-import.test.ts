import { describe, expect, it } from "vitest";
import { parseLegacyProfileJson } from "./legacy-profile-import";

describe("legacy profile import", () => {
    it("whitelists terminal settings and normalizes unsafe values", () => {
        const preview = parseLegacyProfileJson("settings.json", JSON.stringify({ term: { fontsize: 99, fontfamily: "Cascadia Mono", scrollback: 50000 }, theme: "SLTerm Dark" }));
        expect(preview.appearance).toMatchObject({ terminalFontSize: 40, terminalFontFamily: "Cascadia Mono", scrollback: 50000, themeId: "slterm-dark" });
        expect(preview.importedFields).toEqual(expect.arrayContaining(["cỡ chữ terminal", "font terminal", "scrollback", "theme"]));
    });
    it("does not resolve environment references or import secrets, commands, connections, or workspaces", () => {
        const preview = parseLegacyProfileJson("profile.json", JSON.stringify({
            term: { fontsize: 14, apiToken: "$ENV:SECRET", command: "rm -rf /" },
            connections: { prod: { host: "prod", password: "secret" } },
            workspaces: [{ name: "prod", cwd: "C:/prod" }],
        }));
        expect(preview.appearance.terminalFontSize).toBe(14);
        expect(preview.skippedFields).toEqual(expect.arrayContaining(["apiToken", "command", "connections", "workspaces"]));
        expect(preview.warnings.join(" ")).toContain("đăng nhập/kết nối lại");
        expect(preview.warnings.join(" ")).toContain("chưa được chuyển tự động");
    });
    it("rejects malformed and oversized captures", () => {
        expect(() => parseLegacyProfileJson("bad.json", "{" )).toThrow("JSON hợp lệ");
        expect(() => parseLegacyProfileJson("huge.json", "x".repeat(4 * 1024 * 1024 + 1))).toThrow("4 MiB");
    });
});
