// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Clipboard paste sanitization and threat analysis for terminal sessions.
 *
 * Pasting untrusted text from a browser or document into an interactive shell
 * carries four distinct risks:
 * 1. Bracketed-paste breakout (`ESC [ 201 ~` or 8-bit C1 `0x9B 201 ~`), which
 *    prematurely closes xterm's bracketed paste envelope so trailing newlines
 *    execute immediately as shell commands.
 * 2. Pastejacking escape smuggling (CSI/OSC/DCS sequences or bare CR line
 *    overwrites that disguise what appears on screen).
 * 3. Trojan Source Unicode bidirectional control characters (`U+202A..U+202E`,
 *    `U+2066..U+2069`, `U+061C`) that reorder displayed tokens relative to what
 *    the shell interpreter executes.
 * 4. Accidental paste of live credentials (API keys, cloud tokens, PEM private
 *    keys) into shell history or remote SSH PTY streams without logging the
 *    secret value itself.
 */

export type PasteWarningKind =
    | "bracketed_paste_breakout"
    | "ansi_escape_smuggling"
    | "bidi_trojan_source"
    | "secret_exposure";

export type PasteWarning = {
    kind: PasteWarningKind;
    summary: string;
    /** Non-sensitive metadata such as matched credential provider names. */
    matchedLabels?: string[];
};

export type PasteAnalysisResult = {
    /** Text with bracketed-paste breakout markers unconditionally neutralized. */
    sanitizedText: string;
    /** True when one or more breakout sequences were removed from `sanitizedText`. */
    modified: boolean;
    /** Structured, secret-redacted warnings describing detected risks. */
    warnings: PasteWarning[];
};

// Matches both 7-bit (`ESC [ 200 ~`, `ESC [ 201 ~`) and 8-bit C1 (`0x9B 200 ~`,
// `0x9B 201 ~`) bracketed-paste start/end markers.
const BRACKETED_PASTE_MARKER_RE = /(?:\x1b\[|\x9b)20[01]~/g;

// Matches remaining ESC (`0x1B`), 8-bit C1 CSI/OSC/DCS (`0x90`, `0x9B`, `0x9D`),
// backspace (`0x08`), or bare carriage return (`\r` not followed by `\n` or end)
// used in classic pastejacking payloads to overwrite rendered prompt lines.
const ESCAPE_SMUGGLING_RE = /[\x08\x1b\x90\x9b\x9d]|\r(?!\n|$)/;

// Matches Unicode bidirectional override/isolate controls used in Trojan Source.
const BIDI_CONTROL_RE = /[\u061c\u202a-\u202e\u2066-\u2069]/;

type SecretPattern = {
    label: string;
    regex: RegExp;
};

const SECRET_PATTERNS: readonly SecretPattern[] = [
    {
        label: "openai-api-key",
        regex: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/,
    },
    {
        label: "anthropic-api-key",
        regex: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{20,}\b/,
    },
    {
        label: "github-token",
        regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/,
    },
    {
        label: "aws-access-key-id",
        regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    },
    {
        label: "slack-token",
        regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
    },
    {
        label: "pem-private-key",
        regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    },
];

/**
 * Neutralize bracketed-paste breakout sequences and analyze pasted text for
 * pastejacking, Trojan Source BiDi controls, and live credential exposure.
 *
 * Warning payloads never echo raw clipboard contents or matched secret values.
 */
export function sanitizeAndAnalyzePaste(text: string): PasteAnalysisResult {
    if (!text) {
        return { sanitizedText: "", modified: false, warnings: [] };
    }

    const warnings: PasteWarning[] = [];
    let modified = false;

    const sanitizedText = text.replace(BRACKETED_PASTE_MARKER_RE, () => {
        modified = true;
        return "";
    });

    if (modified) {
        warnings.push({
            kind: "bracketed_paste_breakout",
            summary: "Removed bracketed-paste boundary escape sequence from clipboard payload.",
        });
    }

    if (ESCAPE_SMUGGLING_RE.test(sanitizedText)) {
        warnings.push({
            kind: "ansi_escape_smuggling",
            summary: "Clipboard payload contains terminal escape or line-overwrite control characters.",
        });
    }

    if (BIDI_CONTROL_RE.test(sanitizedText)) {
        warnings.push({
            kind: "bidi_trojan_source",
            summary: "Clipboard payload contains Unicode bidirectional override or isolate characters.",
        });
    }

    const matchedSecrets: string[] = [];
    for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(sanitizedText)) {
            matchedSecrets.push(pattern.label);
        }
    }
    if (matchedSecrets.length > 0) {
        warnings.push({
            kind: "secret_exposure",
            summary: `Clipboard payload matches ${matchedSecrets.length} credential pattern(s): ${matchedSecrets.join(", ")}.`,
            matchedLabels: matchedSecrets,
        });
    }

    return {
        sanitizedText,
        modified,
        warnings,
    };
}
