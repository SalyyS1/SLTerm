// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { redactTerminalOutput } from "../output-redactor";

describe("redactTerminalOutput", () => {
    it("leaves clean terminal transcripts untouched", () => {
        const line = "\x1b[32mPASS\x1b[0m pkg/sshaudit (0.014s)\n";
        const res = redactTerminalOutput(line);
        expect(res.modified).toBe(false);
        expect(res.redactionCount).toBe(0);
        expect(res.redactedText).toBe(line);
        expect(res.countsByLabel).toEqual({});
    });

    it("redacts API keys, URL passwords, Bearer headers, and PEM blocks with deterministic digests", () => {
        const ghToken = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
        const openAiKey = "sk-proj-" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
        const stripeKey = "sk_live_" + "0123456789abcdefghijklmnop";
        const pgUrl = "postgresql://appuser:MyS3cretPass99@db.prod.internal:5432/core";
        const pem =
            "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----";

        const raw = [
            `export GITHUB_TOKEN=${ghToken}`,
            `curl -H "Authorization: Bearer ${ghToken}" https://api.github.com/user`,
            `OPENAI_API_KEY=${openAiKey}`,
            `STRIPE_SECRET_KEY=${stripeKey}`,
            `DATABASE_URL=${pgUrl}`,
            pem,
        ].join("\n");

        const res = redactTerminalOutput(raw);
        expect(res.modified).toBe(true);
        expect(res.redactedText).not.toContain(ghToken);
        expect(res.redactedText).not.toContain(openAiKey);
        expect(res.redactedText).not.toContain(stripeKey);
        expect(res.redactedText).not.toContain("MyS3cretPass99");
        expect(res.redactedText).not.toContain("b3BlbnNzaC1rZXk");
        expect(res.redactedText).toContain("postgresql://appuser:[REDACTED:url-userinfo-secret#");
        expect(res.redactedText).toContain("@db.prod.internal:5432/core");
        expect(res.countsByLabel["github-token"]).toBe(2);
        expect(res.countsByLabel["openai-api-key"]).toBe(1);
        expect(res.countsByLabel["stripe-secret-key"]).toBe(1);
        expect(res.countsByLabel["url-userinfo-secret"]).toBe(1);
        expect(res.countsByLabel["pem-private-key"]).toBe(1);

        // Both occurrences of ghToken receive the exact same correlation tag.
        const tagMatches = res.redactedText.match(/\[REDACTED:github-token#[0-9a-f]{8}\]/g) ?? [];
        expect(tagMatches.length).toBe(2);
        expect(tagMatches[0]).toBe(tagMatches[1]);

        // Re-running on already redacted text is idempotent.
        const second = redactTerminalOutput(res.redactedText);
        expect(second.modified).toBe(false);
        expect(second.redactionCount).toBe(0);
        expect(second.redactedText).toBe(res.redactedText);
    });

    it("preserves outer ANSI SGR colors and catches SGR-split syntax-highlighted tokens", () => {
        const key = "sk-proj-" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
        const wrapped = `\x1b[36mKEY=\x1b[32m${key}\x1b[0m`;
        const splitMidToken = `SPLIT=sk-proj-\x1b[33mAbCdEfGhIjKlMnOpQrSt\x1b[0mUvWxYz0123456789`;

        const r1 = redactTerminalOutput(wrapped);
        expect(r1.redactedText).toMatch(/^\x1b\[36mKEY=\x1b\[32m\[REDACTED:openai-api-key#[0-9a-f]{8}\]\x1b\[0m$/);

        const r2 = redactTerminalOutput(splitMidToken);
        expect(r2.redactedText).not.toContain("AbCdEfGhIjKlMnOpQrSt");
        expect(r2.countsByLabel["openai-api-key"]).toBe(1);
    });

    it("supports omitHashSuffix option", () => {
        const aws = "AKIAIOSFODNN7EXAMPLE";
        const res = redactTerminalOutput(`AWS=${aws}`, { omitHashSuffix: true });
        expect(res.redactedText).toBe("AWS=[REDACTED:aws-access-key-id]");
    });
});
