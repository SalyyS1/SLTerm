import { describe, expect, it } from "vitest";
import { isPreviewableProjectPath, PREVIEW_CSP, projectPreviewDocument } from "./project-preview";

describe("project preview isolation", () => {
    it("only previews static HTML documents", () => {
        expect(isPreviewableProjectPath("index.html")).toBe(true);
        expect(isPreviewableProjectPath("page.xhtml")).toBe(true);
        expect(isPreviewableProjectPath("README.md")).toBe(false);
        expect(isPreviewableProjectPath("script.ts")).toBe(false);
    });

    it("sanitizes active elements, navigation, and network-bearing markup", () => {
        const source = `<!doctype html><html><head>
            <base href="https://evil.example/">
            <meta http-equiv="refresh" content="0;url=https://evil.example/refresh">
            <link rel="stylesheet" href="https://evil.example/style.css">
            <style>@import url(https://evil.example/import.css); body { background: url(https://evil.example/bg.png); color: red; }</style>
        </head><body onload="window.top.pwned = true">
            <script>window.top.pwned = true</script><iframe src="https://evil.example/frame"></iframe>
            <a href="https://evil.example/anchor" target="_blank">anchor</a>
            <img src="https://evil.example/image.png" srcset="https://evil.example/a.png 1x" onerror="window.top.pwned = true">
            <p style="background-image:url(https://evil.example/inline.png); color: blue">visible</p>
        </body></html>`;
        const preview = projectPreviewDocument(source);
        expect(preview).toContain("visible");
        expect(preview).not.toMatch(/<script|<iframe|<base|<meta[^>]+refresh|<link\b/i);
        expect(preview).not.toMatch(/evil\.example|onload=|onerror=|\bhref=/i);
        expect(preview).toMatch(/color:\s*red/);
        expect(preview).toMatch(/color:\s*blue/);
        expect(preview).toContain("script-src 'none'");
        expect(preview).toContain("connect-src 'none'");
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

    it("keeps data URLs for static images and strips srcset", () => {
        const preview = projectPreviewDocument('<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw=" srcset="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw= 1x">');
        expect(preview).toContain("src=\"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw=\"");
        expect(preview).not.toContain("srcset");
        expect(projectPreviewDocument('<img src="data:text/html,<script>alert(1)</script>">')).not.toContain("data:text/html");
    });
});
