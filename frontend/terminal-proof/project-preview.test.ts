import { describe, expect, it } from "vitest";
import { isPreviewableProjectPath, PREVIEW_CSP, projectPreviewDocument } from "./project-preview";

describe("project preview isolation", () => {
    it("only previews static HTML documents", () => {
        expect(isPreviewableProjectPath("index.html")).toBe(true);
        expect(isPreviewableProjectPath("page.xhtml")).toBe(true);
        expect(isPreviewableProjectPath("README.md")).toBe(false);
        expect(isPreviewableProjectPath("script.ts")).toBe(false);
    });

    it("injects a restrictive policy without mutating source markup", () => {
        const source = "<html><head><title>Demo</title></head><body><h1>Tiếng Việt</h1></body></html>";
        const preview = projectPreviewDocument(source);
        expect(preview).toContain(`<meta http-equiv=\"Content-Security-Policy\" content=\"${PREVIEW_CSP}\">`);
        expect(preview).toContain("<h1>Tiếng Việt</h1>");
        expect(preview).toContain("connect-src 'none'");
    });

    it("wraps fragments in a document with the same policy", () => {
        const preview = projectPreviewDocument("<style>body{color:red}</style><p>hello</p>");
        expect(preview).toMatch(/^<!doctype html><html><head>/i);
        expect(preview).toContain("<p>hello</p>");
    });
});
