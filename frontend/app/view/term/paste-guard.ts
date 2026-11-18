// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Clipboard paste sanitization, VT100 visual-deception simulation, and threat
 * analysis for interactive terminal sessions.
 *
 * Pasting untrusted text from a browser, chat log, or document into an
 * interactive shell carries seven distinct risks:
 * 1. Bracketed-paste breakout (`ESC [ 201 ~` or 8-bit C1 `0x9B 201 ~`), which
 *    prematurely closes xterm's bracketed paste envelope so trailing newlines
 *    execute immediately as shell commands.
 * 2. OSC 52 clipboard read/write sequences (`ESC ] 52 ; ... BEL/ST` or C1
 *    `0x9D 52 ; ...`), which can query or overwrite the host system clipboard
 *    if echoed back to the terminal emulator.
 * 3. DCS / APC / PM / SOS control strings (`ESC P`, `ESC _`, `ESC ^`, `ESC X`
 *    and C1 `0x90`, `0x9F`, `0x9E`, `0x98`), which smuggle device-specific
 *    terminal commands.
 * 4. Pastejacking visual deception (CSI `ESC[2K`, `ESC[A`, bare `\r`, or `\x08`
 *    backspace overwrites where the rendered prompt line hides executed tokens).
 * 5. Trojan Source Unicode bidirectional control characters (`U+202A..U+202E`,
 *    `U+2066..U+2069`, `U+061C`) that reorder displayed tokens.
 * 6. Zero-width & Plane-14 tag character smuggling (`U+200B..U+200D`,
 *    `U+2060..U+2064`, interior `U+FEFF`, `U+E0000..U+E007F`) that alter CLI
 *    arguments or hostnames invisibly, plus obfuscated pipe-to-shell payloads.
 * 7. Accidental paste of live credentials (API keys, cloud tokens, JWTs, PEM
 *    private keys) into shell history or remote SSH PTY streams without logging
 *    the secret value itself.
 */

export type PasteWarningKind =
    | "bracketed_paste_breakout"
    | "osc52_clipboard_hijack"
    | "dcs_control_string"
    | "ansi_escape_smuggling"
    | "visual_line_deception"
    | "bidi_trojan_source"
    | "zero_width_smuggling"
    | "obfuscated_shell_exec"
    | "secret_exposure";

export type PasteWarning = {
    kind: PasteWarningKind;
    summary: string;
    /** Non-sensitive metadata such as matched credential provider names. */
    matchedLabels?: string[];
};

export type PasteAnalysisResult = {
    /**
     * Text with bracketed-paste breakout markers, OSC 52 clipboard sequences,
     * and DCS/APC/PM/SOS device control strings unconditionally neutralized.
     */
    sanitizedText: string;
    /** True when one or more dangerous control envelopes were stripped. */
    modified: boolean;
    /** Simulated visible terminal output after CR/BS/CSI line-editing rules. */
    simulatedDisplay: string;
    /** True when terminal line-editing controls hide non-whitespace payload tokens. */
    deceptiveDisplay: boolean;
    /** Structured, secret-redacted warnings describing detected risks. */
    warnings: PasteWarning[];
};

// Matches both 7-bit (`ESC [ 200 ~`, `ESC [ 201 ~`) and 8-bit C1 (`0x9B 200 ~`,
// `0x9B 201 ~`) bracketed-paste start/end markers.
const BRACKETED_PASTE_MARKER_RE = /(?:\x1b\[|\x9b)20[01]~/g;

// Matches 7-bit (`ESC ] 52 ; ...`) and 8-bit C1 (`0x9D 52 ; ...`) OSC 52
// clipboard read/write sequences terminated by BEL (`0x07`), ST (`ESC \`), C1 ST
// (`0x9C`), or end-of-string (unterminated smuggling attempt).
const OSC52_SEQUENCE_RE = /(?:\x1b\]|\x9d)52;[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)/g;

// Matches 7-bit (`ESC P`, `ESC X`, `ESC ^`, `ESC _`) and 8-bit C1 (`0x90`,
// `0x98`, `0x9E`, `0x9F`) DCS/SOS/PM/APC control strings terminated by ST or BEL.
const DCS_APC_STRING_RE = /(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g;

// Matches remaining ESC (`0x1B`), 8-bit C1 CSI/OSC (`0x9B`, `0x9D`), backspace /
// DEL (`0x08`, `0x7F`), or bare carriage return (`\r` not followed by `\n` or end)
// used in pastejacking payloads to overwrite rendered prompt lines.
const ESCAPE_SMUGGLING_RE = /[\x08\x1b\x7f\x9b\x9d]|\r(?!\n|$)/;

// Matches Unicode bidirectional override/isolate controls used in Trojan Source.
const BIDI_CONTROL_RE = /[\u061c\u202a-\u202e\u2066-\u2069]/;

// Matches zero-width spaces/joiners, invisible formatters, interior BOMs, and
// Plane-14 Unicode tag characters (`U+E0000..U+E007F`).
const ZERO_WIDTH_SMUGGLING_RE = /(?:[\u200b-\u200f\u2060-\u2064\u{e0000}-\u{e007f}]|(?<=.)\ufeff)/u;

// Matches high-risk obfuscated shell execution idioms (base64 decode piped to a
// shell, curl/wget piped directly to a shell, or Punycode xn-- domains in fetchers).
const OBFUSCATED_EXEC_PATTERNS: readonly { label: string; regex: RegExp }[] = [
    {
        label: "base64-decode-pipe-shell",
        regex: /\bbase64\s+(?:-d|--decode)\b[^\n|]*\|\s*(?:ba|z|da|k)?sh\b/i,
    },
    {
        label: "network-fetch-pipe-shell",
        regex: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i,
    },
    {
        label: "punycode-domain-command",
        regex: /\b(?:curl|wget|ssh|scp|git\s+clone)\b[^\n]*\bxn--[a-z0-9-]+/i,
    },
];

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
        label: "google-api-key",
        regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    },
    {
        label: "huggingface-token",
        regex: /\bhf_[A-Za-z0-9]{34,}\b/,
    },
    {
        label: "npm-access-token",
        regex: /\bnpm_[A-Za-z0-9]{36}\b/,
    },
    {
        label: "slack-token",
        regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
    },
    {
        label: "jwt-bearer-token",
        regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    },
    {
        label: "pem-private-key",
        regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    },
];

/**
 * Simulate how a standard VT100/xterm terminal renders `input` after applying
 * carriage return (`\r`), backspace (`\x08`/`\x7f`), cursor-up (`CSI A`/`CSI F`),
 * and erase-in-line (`CSI K`/`CSI 2K`) sequences.
 */
export function simulateTerminalDisplay(input: string): string {
    if (!input) {
        return "";
    }
    const lines: string[][] = [[]];
    let row = 0;
    let col = 0;

    const ensureRow = (r: number) => {
        while (lines.length <= r) {
            lines.push([]);
        }
    };

    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        const code = input.charCodeAt(i);

        if (ch === "\r") {
            if (input[i + 1] === "\n") {
                row++;
                ensureRow(row);
                col = 0;
                i += 2;
                continue;
            }
            col = 0;
            i++;
            continue;
        }
        if (ch === "\n") {
            row++;
            ensureRow(row);
            col = 0;
            i++;
            continue;
        }
        if (code === 0x08 || code === 0x7f) {
            if (col > 0) {
                col--;
            }
            i++;
            continue;
        }

        // 7-bit ESC [...] or 8-bit C1 CSI (0x9B)
        if (code === 0x1b || code === 0x9b) {
            const isCsi = code === 0x9b || input[i + 1] === "[";
            const isOsc = code === 0x1b && input[i + 1] === "]";
            if (isCsi) {
                let j = code === 0x9b ? i + 1 : i + 2;
                let params = "";
                while (j < input.length && input.charCodeAt(j) >= 0x20 && input.charCodeAt(j) <= 0x3f) {
                    params += input[j];
                    j++;
                }
                const finalByte = j < input.length ? input[j] : "";
                const n = Math.max(parseInt(params || "1", 10) || 1, 1);
                if (finalByte === "K") {
                    const mode = parseInt(params || "0", 10) || 0;
                    const curLine = lines[row];
                    if (mode === 2) {
                        lines[row] = [];
                    } else if (mode === 1) {
                        for (let k = 0; k <= Math.min(col, curLine.length - 1); k++) {
                            curLine[k] = " ";
                        }
                    } else {
                        curLine.length = Math.min(col, curLine.length);
                    }
                } else if (finalByte === "A") {
                    row = Math.max(0, row - n);
                } else if (finalByte === "F") {
                    row = Math.max(0, row - n);
                    col = 0;
                } else if (finalByte === "G") {
                    col = Math.max(0, n - 1);
                } else if (finalByte === "D") {
                    col = Math.max(0, col - n);
                } else if (finalByte === "J" && (params === "2" || params === "3")) {
                    lines.length = 1;
                    lines[0] = [];
                    row = 0;
                    col = 0;
                }
                i = j < input.length ? j + 1 : j;
                continue;
            }
            if (isOsc) {
                let j = i + 2;
                while (j < input.length) {
                    if (input.charCodeAt(j) === 0x07 || input.charCodeAt(j) === 0x9c) {
                        j++;
                        break;
                    }
                    if (input.charCodeAt(j) === 0x1b && input[j + 1] === "\\") {
                        j += 2;
                        break;
                    }
                    j++;
                }
                i = j;
                continue;
            }
            i += 2;
            continue;
        }

        // Skip Plane-14 Unicode tag characters (surrogate pair 0xDB40 + 0xDC00..0xDC7F)
        if (code === 0xdb40 && i + 1 < input.length) {
            const lo = input.charCodeAt(i + 1);
            if (lo >= 0xdc00 && lo <= 0xdc7f) {
                i += 2;
                continue;
            }
        }

        // Skip non-printable C0 controls (except tab) and zero-width / BiDi controls
        if ((code < 0x20 && ch !== "\t") || BIDI_CONTROL_RE.test(ch) || /[\u200b-\u200f\u2060-\u2064\ufeff]/.test(ch)) {
            i++;
            continue;
        }

        const curLine = lines[row];
        while (curLine.length < col) {
            curLine.push(" ");
        }
        curLine[col] = ch;
        col++;
        i++;
    }

    return lines.map((chars) => chars.join("").replace(/\s+$/g, "")).join("\n");
}

function stripEscapeSequencesPlain(input: string): string {
    return input
        .replace(/(?:\x1b\[|\x9b)[\x20-\x3f]*[\x40-\x7e]/g, "")
        .replace(/(?:\x1b\])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)/g, "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, "")
        .replace(/\r(?!\n)/g, "\n");
}

function hasVisualLineDeception(sanitizedText: string, simulatedDisplay: string): boolean {
    if (!ESCAPE_SMUGGLING_RE.test(sanitizedText)) {
        return false;
    }
    const rawTokens = stripEscapeSequencesPlain(sanitizedText)
        .split(/\s+/)
        .filter((t) => t.length >= 2);
    if (rawTokens.length === 0) {
        return false;
    }
    for (const tok of rawTokens) {
        if (!simulatedDisplay.includes(tok)) {
            return true;
        }
    }
    return false;
}

/**
 * Neutralize bracketed-paste breakout, OSC 52 clipboard hijack, and DCS/APC
 * control strings, then analyze pasted text for visual pastejacking deception,
 * Trojan Source BiDi controls, zero-width smuggling, obfuscated pipe-to-shell
 * idioms, and live credential exposure.
 *
 * Warning payloads never echo raw clipboard contents or matched secret values.
 */
export function sanitizeAndAnalyzePaste(text: string): PasteAnalysisResult {
    if (!text) {
        return {
            sanitizedText: "",
            modified: false,
            simulatedDisplay: "",
            deceptiveDisplay: false,
            warnings: [],
        };
    }

    const warnings: PasteWarning[] = [];
    let strippedBreakout = false;
    let strippedOsc52 = false;
    let strippedDcs = false;

    let sanitizedText = text.replace(BRACKETED_PASTE_MARKER_RE, () => {
        strippedBreakout = true;
        return "";
    });

    sanitizedText = sanitizedText.replace(OSC52_SEQUENCE_RE, () => {
        strippedOsc52 = true;
        return "";
    });

    sanitizedText = sanitizedText.replace(DCS_APC_STRING_RE, () => {
        strippedDcs = true;
        return "";
    });

    const modified = strippedBreakout || strippedOsc52 || strippedDcs;

    if (strippedBreakout) {
        warnings.push({
            kind: "bracketed_paste_breakout",
            summary: "Removed bracketed-paste boundary escape sequence from clipboard payload.",
        });
    }

    if (strippedOsc52) {
        warnings.push({
            kind: "osc52_clipboard_hijack",
            summary: "Removed OSC 52 terminal clipboard read/write escape sequence from clipboard payload.",
        });
    }

    if (strippedDcs) {
        warnings.push({
            kind: "dcs_control_string",
            summary: "Removed DCS/APC/PM/SOS terminal device control string from clipboard payload.",
        });
    }

    const simulatedDisplay = simulateTerminalDisplay(sanitizedText);
    const deceptiveDisplay = hasVisualLineDeception(sanitizedText, simulatedDisplay);

    if (ESCAPE_SMUGGLING_RE.test(sanitizedText)) {
        warnings.push({
            kind: "ansi_escape_smuggling",
            summary: "Clipboard payload contains terminal escape or line-overwrite control characters.",
        });
    }

    if (deceptiveDisplay) {
        warnings.push({
            kind: "visual_line_deception",
            summary: "Terminal line-editing controls conceal executed command tokens from visible prompt output.",
        });
    }

    if (BIDI_CONTROL_RE.test(sanitizedText)) {
        warnings.push({
            kind: "bidi_trojan_source",
            summary: "Clipboard payload contains Unicode bidirectional override or isolate characters.",
        });
    }

    if (ZERO_WIDTH_SMUGGLING_RE.test(sanitizedText)) {
        warnings.push({
            kind: "zero_width_smuggling",
            summary: "Clipboard payload contains invisible zero-width or Plane-14 tag characters.",
        });
    }

    const matchedExecLabels: string[] = [];
    for (const rule of OBFUSCATED_EXEC_PATTERNS) {
        if (rule.regex.test(sanitizedText)) {
            matchedExecLabels.push(rule.label);
        }
    }
    if (matchedExecLabels.length > 0) {
        warnings.push({
            kind: "obfuscated_shell_exec",
            summary: `Clipboard payload matches high-risk shell execution pattern(s): ${matchedExecLabels.join(", ")}.`,
            matchedLabels: matchedExecLabels,
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
        simulatedDisplay,
        deceptiveDisplay,
        warnings,
    };
}

type PasteSarifRuleSpec = {
    id: string;
    name: string;
    level: "error" | "warning";
    securitySeverity: string;
    shortDescription: string;
};

const PASTE_SARIF_RULES: Record<PasteWarningKind, PasteSarifRuleSpec> = {
    bracketed_paste_breakout: {
        id: "SLTP001",
        name: "BracketedPasteBreakout",
        level: "error",
        securitySeverity: "9.3",
        shortDescription: "Bracketed-paste boundary escape sequence closes paste envelope early",
    },
    osc52_clipboard_hijack: {
        id: "SLTP002",
        name: "Osc52ClipboardHijack",
        level: "error",
        securitySeverity: "8.6",
        shortDescription: "OSC 52 terminal clipboard read or write sequence in pasted text",
    },
    dcs_control_string: {
        id: "SLTP003",
        name: "DcsDeviceControlString",
        level: "error",
        securitySeverity: "8.1",
        shortDescription: "DCS, APC, PM, or SOS device control string in pasted text",
    },
    ansi_escape_smuggling: {
        id: "SLTP004",
        name: "AnsiEscapeSmuggling",
        level: "warning",
        securitySeverity: "6.4",
        shortDescription: "Terminal escape or line-overwrite control characters in clipboard payload",
    },
    visual_line_deception: {
        id: "SLTP005",
        name: "VisualLineDeception",
        level: "error",
        securitySeverity: "8.9",
        shortDescription: "VT100 line-editing controls conceal executed command tokens from visible output",
    },
    bidi_trojan_source: {
        id: "SLTP006",
        name: "TrojanSourceBiDiControl",
        level: "error",
        securitySeverity: "8.2",
        shortDescription: "Unicode bidirectional override or isolate control characters in clipboard payload",
    },
    zero_width_smuggling: {
        id: "SLTP007",
        name: "ZeroWidthOrTagSmuggling",
        level: "warning",
        securitySeverity: "6.2",
        shortDescription: "Invisible zero-width or Plane-14 tag characters in clipboard payload",
    },
    obfuscated_shell_exec: {
        id: "SLTP008",
        name: "ObfuscatedShellExecution",
        level: "warning",
        securitySeverity: "7.0",
        shortDescription: "High-risk obfuscated pipe-to-shell or Punycode execution pattern",
    },
    secret_exposure: {
        id: "SLTP009",
        name: "ClipboardCredentialExposure",
        level: "warning",
        securitySeverity: "7.4",
        shortDescription: "Live API token, bearer credential, or private key detected in clipboard payload",
    },
};

/**
 * Serialize a `PasteAnalysisResult` into an OASIS SARIF v2.1.0 object without
 * embedding raw clipboard contents or matched credential values.
 */
export function exportPasteAnalysisSarif(
    analysis: PasteAnalysisResult,
    artifactUri = "clipboard://paste-buffer"
): Record<string, unknown> {
    const orderedKinds = Object.keys(PASTE_SARIF_RULES) as PasteWarningKind[];
    const rules = orderedKinds.map((kind) => {
        const spec = PASTE_SARIF_RULES[kind];
        return {
            id: spec.id,
            name: spec.name,
            shortDescription: { text: spec.shortDescription },
            defaultConfiguration: { level: spec.level },
            properties: {
                "security-severity": spec.securitySeverity,
                tags: ["security", "terminal", "paste-guard"],
            },
        };
    });

    const results = analysis.warnings.map((w) => {
        const ruleIndex = orderedKinds.indexOf(w.kind);
        const spec = PASTE_SARIF_RULES[w.kind];
        return {
            ruleId: spec.id,
            ruleIndex,
            level: spec.level,
            message: { text: w.summary },
            locations: [
                {
                    physicalLocation: {
                        artifactLocation: { uri: artifactUri },
                        region: { startLine: 1, startColumn: 1 },
                    },
                },
            ],
        };
    });

    return {
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
        runs: [
            {
                tool: {
                    driver: {
                        name: "slterm-paste-guard",
                        version: "0.22.0",
                        informationUri: "https://github.com/SalyyS1/SLTerm",
                        rules,
                    },
                },
                invocations: [{ executionSuccessful: true }],
                results,
            },
        ],
    };
}
