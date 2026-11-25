// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatChangelogMarkdown, parseMessageSegments } from "../../../workspace/studio-markdown";

describe("parseMessageSegments (Rem Aqua Studio chat renderer)", () => {
    it("splits prose, fenced code blocks, and diff blocks cleanly", () => {
        const input = [
            "Here is the fix:",
            "```diff",
            "-oldLine()",
            "+newLine()",
            "```",
            "Run `go test ./...` next.",
        ].join("\n");

        const segs = parseMessageSegments(input);
        expect(segs).toHaveLength(3);
        expect(segs[0]).toEqual({ kind: "text", lang: undefined, content: "Here is the fix:" });
        expect(segs[1]).toEqual({ kind: "code", lang: "diff", content: "-oldLine()\n+newLine()" });
        expect(segs[2]).toEqual({ kind: "text", lang: undefined, content: "Run `go test ./...` next." });
    });

    it("handles unclosed code fences gracefully without dropping content", () => {
        const segs = parseMessageSegments("```ts\nconst x = 1;");
        expect(segs).toHaveLength(1);
        expect(segs[0].kind).toBe("code");
        expect(segs[0].lang).toBe("ts");
        expect(segs[0].content).toBe("const x = 1;");
    });

    it("returns empty array for blank input", () => {
        expect(parseMessageSegments("")).toEqual([]);
    });

    it("formats categorized Release Changelog Markdown from commits", () => {
        const md = formatChangelogMarkdown(
            [
                { shortHash: "abc1234", subject: "feat(studio): add live web preview", author: "Saly" },
                { shortHash: "def5678", subject: "fix(vcs): handle branch format flag", author: "Saly" },
                { shortHash: "999aaaa", subject: "chore: bump version", author: "Saly" },
            ],
            "SLTerm v0.48.0"
        );
        expect(md).toContain("## SLTerm v0.48.0");
        expect(md).toContain("### ✨ Features");
        expect(md).toContain("feat(studio): add live web preview (`abc1234` · Saly)");
        expect(md).toContain("### 🐛 Fixes");
        expect(md).toContain("### 🔧 Improvements & Chores");
    });
});
