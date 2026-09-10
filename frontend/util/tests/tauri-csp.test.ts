import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("packaged Tauri CSP", () => {
    it("is explicit and does not regress to permissive sources", () => {
        const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"));
        const csp = config.app.security.csp;
        expect(typeof csp).toBe("string");
        expect(csp).not.toBe("");
        expect(csp).not.toContain("null");
        expect(csp).not.toMatch(/(?:default-src|script-src|connect-src|frame-src|img-src)\s+[^;]*(?:^|\s)\*(?:\s|;|$)/);
        expect(csp).not.toContain("unsafe-eval");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("connect-src 'self' ipc: http://127.0.0.1:* ws://127.0.0.1:*");
        expect(csp).toContain("frame-src http://127.0.0.1:*");
        expect(csp).toContain("worker-src 'self' blob:");
    });
});
