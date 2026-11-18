// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Terminal scrollback, clipboard export, and session log credential redactor.
 *
 * Replaces live credentials across 12 secret families (OpenAI, Anthropic,
 * GitHub, AWS IAM, Google API, HuggingFace, npm, Slack, Stripe, JWTs, URL
 * userinfo credentials, Bearer headers, and PEM private key blocks) with
 * deterministic correlation placeholders (`[REDACTED:<label>#<digest>]`) while
 * preserving surrounding ANSI SGR terminal color sequences and never leaking
 * raw secret values into returned metadata.
 */

export type OutputRedactionOptions = {
    /**
     * Omit the 8-hex-character correlation digest suffix (`#a1b2c3d4`) and emit
     * `[REDACTED:<label>]` only.
     */
    omitHashSuffix?: boolean;
};

export type OutputRedactionResult = {
    redactedText: string;
    modified: boolean;
    redactionCount: number;
    countsByLabel: Record<string, number>;
};

type RedactionRule = {
    label: string;
    regex: RegExp;
    /**
     * When true, `regex` must capture `(prefix)(secret)(optionalSuffix)` so the
     * protocol/header prefix and trailing `@` delimiter remain intact.
     */
    preserveEnvelope?: boolean;
};

const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

const REDACTION_RULES: readonly RedactionRule[] = [
    {
        label: "pem-private-key",
        regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/g,
    },
    {
        label: "pem-private-key",
        regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/g,
    },
    {
        label: "openai-api-key",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "anthropic-api-key",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(sk-ant-api\d{2}-[A-Za-z0-9_-]{20,})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "github-token",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "aws-access-key-id",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "google-api-key",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(AIza[0-9A-Za-z_-]{35})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "huggingface-token",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(hf_[A-Za-z0-9]{34,})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "npm-access-token",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(npm_[A-Za-z0-9]{36})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "slack-token",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(xox[baprs]-[0-9A-Za-z-]{10,})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "stripe-secret-key",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))((?:sk|rk)_live_[0-9A-Za-z]{24,})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "jwt-bearer-token",
        regex: /((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
        preserveEnvelope: true,
    },
    {
        label: "url-userinfo-secret",
        regex: /((?:https?|ssh|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|amqp):\/\/[^/\s:@]+:)([^/\s@]{4,})(@)/g,
        preserveEnvelope: true,
    },
    {
        label: "authorization-bearer",
        regex: /(authorization\s*[:=]\s*bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi,
        preserveEnvelope: true,
    },
];

/**
 * Compute a deterministic 64-bit FNV-1a mix formatted as 8 lowercase hex chars
 * for synchronous browser/renderer correlation without async WebCrypto calls.
 */
function correlationDigestHex(label: string, secret: string): string {
    const seed = `slterm-redact-v1:${label}:${secret}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < seed.length; i++) {
        const c = seed.charCodeAt(i);
        h1 ^= c;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= c ^ (i & 0xff);
        h2 = Math.imul(h2, 0x85ebca6b);
    }
    const mixed = ((h1 ^ (h2 >>> 13)) >>> 0).toString(16).padStart(8, "0");
    return mixed;
}

function formatPlaceholder(label: string, secret: string, omitHashSuffix: boolean): string {
    if (omitHashSuffix) {
        return `[REDACTED:${label}]`;
    }
    return `[REDACTED:${label}#${correlationDigestHex(label, secret)}]`;
}

function hasUnredactedMatch(plain: string): boolean {
    for (const rule of REDACTION_RULES) {
        const re = new RegExp(rule.regex.source, rule.regex.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(plain)) !== null) {
            const candidate = rule.preserveEnvelope ? m[2] : m[0];
            if (candidate && !candidate.startsWith("[REDACTED:")) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Redact live credentials from terminal output, scrollback exports, or command
 * logs while keeping surrounding ANSI SGR escape sequences intact.
 */
export function redactTerminalOutput(
    input: string,
    options: OutputRedactionOptions = {}
): OutputRedactionResult {
    const countsByLabel: Record<string, number> = {};
    if (!input) {
        return {
            redactedText: "",
            modified: false,
            redactionCount: 0,
            countsByLabel,
        };
    }

    const omitHash = Boolean(options.omitHashSuffix);
    let redactionCount = 0;

    const runPass = (source: string): string => {
        let cur = source;
        for (const rule of REDACTION_RULES) {
            const re = new RegExp(rule.regex.source, rule.regex.flags);
            if (rule.preserveEnvelope) {
                cur = cur.replace(re, (full, prefix: string, secretVal: string, suffixOrOffset?: string | number) => {
                    if (!secretVal || secretVal.startsWith("[REDACTED:")) {
                        return full;
                    }
                    countsByLabel[rule.label] = (countsByLabel[rule.label] ?? 0) + 1;
                    redactionCount++;
                    const trailing = typeof suffixOrOffset === "string" ? suffixOrOffset : "";
                    return `${prefix}${formatPlaceholder(rule.label, secretVal, omitHash)}${trailing}`;
                });
            } else {
                cur = cur.replace(re, (match) => {
                    if (match.startsWith("[REDACTED:")) {
                        return match;
                    }
                    countsByLabel[rule.label] = (countsByLabel[rule.label] ?? 0) + 1;
                    redactionCount++;
                    return formatPlaceholder(rule.label, match, omitHash);
                });
            }
        }
        return cur;
    };

    let redactedText = runPass(input);

    // Handle syntax-highlighted terminal lines where SGR color codes split a secret mid-token.
    if (redactedText.includes("\x1b[")) {
        const plainProbe = redactedText.replace(ANSI_SGR_RE, "");
        if (hasUnredactedMatch(plainProbe)) {
            const lines = redactedText.split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes("\x1b[")) {
                    const stripped = lines[i].replace(ANSI_SGR_RE, "");
                    if (hasUnredactedMatch(stripped)) {
                        lines[i] = runPass(stripped);
                    }
                }
            }
            redactedText = lines.join("\n");
        }
    }

    return {
        redactedText,
        modified: redactionCount > 0,
        redactionCount,
        countsByLabel,
    };
}
