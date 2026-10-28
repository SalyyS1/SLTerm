import { describe, expect, it } from "vitest";
import { workspacePath } from "./workspace-path";

describe("workspace working directory", () => {
    it("accepts absolute drive and network paths as literal data", () => {
        for (const path of [
            "C:\\",
            "D:/Projects/tiếng Việt",
            "C:\\Path with spaces\\a; b",
            "\\\\host\\share",
            "\\\\host\\share\\src",
        ])
            expect(workspacePath("  " + path + "  ")).toBe(path);
    });
    it("rejects blank, drive-relative, rooted-relative and malformed network paths", () => {
        for (const path of ["", "  ", ".", "src", "C:src", "\\src", "/tmp", "\\\\host", "C:\\bad\0path"])
            expect(() => workspacePath(path)).toThrow();
    });
});
