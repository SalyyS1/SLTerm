// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Lexical and structural shell command & AI-agent execution risk firewall
 * (rules SLT011..SLT016) for interactive terminal sessions and browser triage.
 */

export type CommandRuleId = "SLT011" | "SLT012" | "SLT013" | "SLT014" | "SLT015" | "SLT016";

export type CommandSeverity = "error" | "warning" | "note";

export type CommandPolicyMode = "strict" | "balanced" | "permissive";

export type CommandActionVerdict = "allow" | "warn" | "require_approval" | "block";

export type CommandRuleDescriptor = {
    id: CommandRuleId;
    name: string;
    severity: CommandSeverity;
    securitySeverity: string;
    cwe: string;
    baseRisk: number;
    shortDescription: string;
    help: string;
};

export type CommandFinding = {
    ruleId: CommandRuleId;
    ruleName: string;
    severity: CommandSeverity;
    cwe: string;
    line: number;
    column: number;
    command: string;
    decodedLayer?: string;
    riskPoints: number;
    message: string;
    remediation: string;
};

export type CommandGuardReport = {
    source: string;
    policy: CommandPolicyMode;
    verdict: CommandActionVerdict;
    riskScore: number;
    segmentCount: number;
    errorCount: number;
    warningCount: number;
    unwrappedCommands: string[];
    findings: CommandFinding[];
};

export const CMDGUARD_RULES: readonly CommandRuleDescriptor[] = [
    {
        id: "SLT011",
        name: "DestructiveFilesystemOrDiskWipe",
        severity: "error",
        securitySeverity: "9.8",
        cwe: "CWE-78",
        baseRisk: 95,
        shortDescription: "Recursive root, home, or block-device destruction or shell fork bomb",
        help: "Scope recursive deletions to explicit relative build directories, validate non-empty variables (${DIR:?}) before appending /*, and never write directly to raw block devices or invoke --no-preserve-root.",
    },
    {
        id: "SLT012",
        name: "NetworkFetchOrEncodedPipeToShell",
        severity: "error",
        securitySeverity: "9.1",
        cwe: "CWE-829",
        baseRisk: 88,
        shortDescription: "Untrusted network payload or obfuscated Base64 stream piped directly into an interpreter",
        help: "Download remote scripts to a temporary file, verify SHA-256 checksums or cryptographic signatures, inspect contents, and execute without piping curl/wget or Base64 decoders directly into sh, bash, python, or Invoke-Expression.",
    },
    {
        id: "SLT013",
        name: "ReverseShellAndSocketPivot",
        severity: "error",
        securitySeverity: "9.6",
        cwe: "CWE-506",
        baseRisk: 96,
        shortDescription: "Interactive reverse shell or raw TCP/UDP socket stdio bind",
        help: "Block interactive shell bindings over /dev/tcp, netcat -e/-c, mkfifo socket relays, socat EXEC/SYSTEM, and inline python/perl/php/ruby socket-dup2 payloads; use audited SSH sessions instead.",
    },
    {
        id: "SLT014",
        name: "CredentialAndMetadataExfiltration",
        severity: "error",
        securitySeverity: "8.9",
        cwe: "CWE-200",
        baseRisk: 86,
        shortDescription: "Sensitive credential files, secret environment variables, or cloud IMDS tokens sent to an external sink",
        help: "Never transmit SSH keys, cloud credential files, .env secrets, process environment dumps, or 169.254.169.254 IMDS metadata responses to outbound HTTP, DNS, SCP, or raw socket endpoints.",
    },
    {
        id: "SLT015",
        name: "PrivilegeEscalationAndPersistenceTamper",
        severity: "warning",
        securitySeverity: "8.4",
        cwe: "CWE-269",
        baseRisk: 78,
        shortDescription: "SUID bit escalation, sudoers/authorized_keys/LD_PRELOAD persistence, or privileged container host escape",
        help: "Avoid setting SUID/SGID bits, mutating /etc/sudoers or ~/.ssh/authorized_keys, injecting LD_PRELOAD, or launching containers with --privileged, /var/run/docker.sock, or host root volume mounts.",
    },
    {
        id: "SLT016",
        name: "DestructiveGitAndGuardrailBypass",
        severity: "warning",
        securitySeverity: "7.2",
        cwe: "CWE-284",
        baseRisk: 62,
        shortDescription: "Unprotected git force-push, hard working-tree wipe, or --no-verify security hook bypass",
        help: "Prefer git push --force-with-lease on feature branches instead of --force on main/master, stash or branch before git reset --hard or git clean -fdx, and keep pre-commit/pre-push verification hooks enabled.",
    },
];

const RULE_MAP: Record<CommandRuleId, CommandRuleDescriptor> = Object.fromEntries(
    CMDGUARD_RULES.map((r) => [r.id, r])
) as Record<CommandRuleId, CommandRuleDescriptor>;

type SubScript = {
    kind: string;
    script: string;
    line: number;
    column: number;
};

type RedirectOp = {
    operator: string;
    target: string;
    line: number;
    column: number;
};

type ShellSegment = {
    envVars: string[];
    argv: string[];
    redirects: RedirectOp[];
    substitutions: SubScript[];
    connectorToNext: string;
    elevated: boolean;
    line: number;
    column: number;
};

type LexToken = {
    kind: "word" | "op" | "redir" | "subshell";
    value: string;
    subs: SubScript[];
    line: number;
    column: number;
};

const MAX_RECURSION_DEPTH = 4;

const FORK_BOMB_RE = /(?:^|[;&|]\s*)(?::\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:|([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*&)/m;
const UNGUARDED_VAR_ROOT_RE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\/\*?$/;
const RAW_BLOCK_DEV_RE = /^\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|vd[a-z]\d*|xvd[a-z]\d*|hd[a-z]\d*|mmcblk\d+(?:p\d+)?|disk\d+(?:s\d+)?|mem|kmem)$/i;
const OCTAL_SUID_RE = /^0?[2467][0-7]{3}$/;
const DEV_TCP_RE = /\/dev\/(?:tcp|udp)\/[^\s/]+\/\d+/i;
const IMDS_ENDPOINT_RE = /(?:169\.254\.169\.254|169\.254\.170\.2|100\.100\.100\.200|metadata\.google\.internal|\[fd00:ec2::254\])/i;
const SECRET_ENV_VAR_RE = /\$(?:\{)?(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|NPM_TOKEN|HF_TOKEN|STRIPE_SECRET_KEY|DATABASE_URL|SLACK_TOKEN|PRIVATE_KEY|SECRET_KEY)(?:\})?/i;

const CRITICAL_ROOTS = new Set([
    "/", "/*", "/.*",
    "~", "~/", "~/*",
    "$home", "${home}", "$home/", "${home}/", "$home/*", "${home}/*",
    "..", "../", "../*",
    "/root", "/root/*",
    "/etc", "/etc/*",
    "/boot", "/boot/*",
    "/usr", "/usr/*",
    "/var", "/var/*",
    "/bin", "/sbin", "/lib", "/lib64",
    "/system", "/users",
    "c:\\", "c:/", "c:\\*", "c:/*",
    "$env:userprofile", "$env:systemdrive",
]);

const NETWORK_FETCHERS = new Set([
    "curl", "wget", "fetch", "aria2c", "http", "https",
    "iwr", "irm", "invoke-webrequest", "invoke-restmethod",
]);

const SHELL_INTERPRETERS = new Set([
    "sh", "bash", "zsh", "dash", "ksh", "ash", "fish", "csh", "tcsh",
    "python", "python3", "python2",
    "perl", "ruby", "php", "node", "deno", "bun", "lua",
    "pwsh", "powershell", "iex", "invoke-expression",
]);

const OUTBOUND_SINKS = new Set([
    "curl", "wget", "http", "https",
    "scp", "rsync", "sftp", "ftp", "tftp",
    "nc", "ncat", "netcat", "socat",
    "dig", "nslookup", "host",
    "iwr", "irm", "invoke-webrequest", "invoke-restmethod",
]);

const SENSITIVE_FILE_NEEDLES = [
    ".ssh/id_",
    "/etc/shadow",
    "/etc/gshadow",
    "/proc/self/environ",
    ".aws/credentials",
    ".kube/config",
    ".docker/config.json",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    "application_default_credentials.json",
];

function baseCommandName(cmd: string): string {
    let cleaned = cmd.trim().replace(/\\/g, "/");
    const slash = cleaned.lastIndexOf("/");
    if (slash >= 0) cleaned = cleaned.slice(slash + 1);
    return cleaned.toLowerCase().replace(/\.exe$/, "");
}

function isEnvAssignment(word: string): boolean {
    const eq = word.indexOf("=");
    if (eq <= 0) return false;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(word.slice(0, eq));
}

function extractBalancedParen(s: string): [string, number] {
    let depth = 1;
    let i = 0;
    let inSingle = false;
    let inDouble = false;
    while (i < s.length) {
        const c = s[i];
        if (c === "\\" && !inSingle && i + 1 < s.length) {
            i += 2;
            continue;
        }
        if (c === "'" && !inDouble) {
            inSingle = !inSingle;
            i++;
            continue;
        }
        if (c === '"' && !inSingle) {
            inDouble = !inDouble;
            i++;
            continue;
        }
        if (!inSingle && !inDouble) {
            if (c === "(") depth++;
            else if (c === ")") {
                depth--;
                if (depth === 0) return [s.slice(0, i), i + 1];
            }
        }
        i++;
    }
    return [s, s.length];
}

function extractBacktick(s: string): [string, number] {
    let i = 0;
    while (i < s.length) {
        if (s[i] === "\\" && i + 1 < s.length) {
            i += 2;
            continue;
        }
        if (s[i] === "`") return [s.slice(0, i), i + 1];
        i++;
    }
    return [s, s.length];
}

function matchRedirection(rest: string): [string, number] {
    if (!rest) return ["", 0];
    let idx = 0;
    if (rest[0] >= "0" && rest[0] <= "9") idx = 1;
    if (idx >= rest.length) return ["", 0];
    const rem = rest.slice(idx);
    const prefixes = ["<<<", "&>>", "&>", ">>", ">|", ">&", "<>", "<&", "<<", ">", "<"];
    for (const p of prefixes) {
        if (rem.startsWith(p)) {
            if ((p === "<" || p === ">") && rem.length > 1 && rem[1] === "(") return ["", 0];
            let total = idx + p.length;
            if ((p === ">&" || p === "<&") && total < rest.length && rest[total] >= "0" && rest[total] <= "9") {
                total++;
            }
            return [rest.slice(0, total), total];
        }
    }
    return ["", 0];
}

function tokenizeShell(input: string): LexToken[] {
    const out: LexToken[] = [];
    let line = 1;
    let col = 1;
    let i = 0;
    const n = input.length;

    const advance = (step: number) => {
        for (let k = 0; k < step && i < n; k++) {
            if (input[i] === "\n") {
                line++;
                col = 1;
            } else {
                col++;
            }
            i++;
        }
    };

    while (i < n) {
        const ch = input[i];
        if (ch === "\\" && input[i + 1] === "\n") {
            advance(2);
            continue;
        }
        if (ch === "\\" && input[i + 1] === "\r" && input[i + 2] === "\n") {
            advance(3);
            continue;
        }
        if (ch === " " || ch === "\t" || ch === "\r") {
            advance(1);
            continue;
        }
        if (ch === "\n") {
            out.push({ kind: "op", value: "\n", subs: [], line, column: col });
            advance(1);
            continue;
        }
        if (ch === "#") {
            while (i < n && input[i] !== "\n") advance(1);
            continue;
        }

        const startLine = line;
        const startCol = col;

        if ((ch === "<" || ch === ">") && input[i + 1] === "(") {
            const kind = ch === "<" ? "procsub_in" : "procsub_out";
            advance(2);
            const [body, consumed] = extractBalancedParen(input.slice(i));
            advance(consumed);
            out.push({
                kind: "word",
                value: `${ch}(${body})`,
                subs: [{ kind, script: body, line: startLine, column: startCol }],
                line: startLine,
                column: startCol,
            });
            continue;
        }

        if (ch === "(") {
            advance(1);
            const [body, consumed] = extractBalancedParen(input.slice(i));
            advance(consumed);
            out.push({ kind: "subshell", value: body, subs: [], line: startLine, column: startCol });
            continue;
        }

        if (ch === "&" && input[i + 1] === "&") {
            advance(2);
            out.push({ kind: "op", value: "&&", subs: [], line: startLine, column: startCol });
            continue;
        }
        if (ch === "|" && input[i + 1] === "|") {
            advance(2);
            out.push({ kind: "op", value: "||", subs: [], line: startLine, column: startCol });
            continue;
        }
        if (ch === "|" && input[i + 1] === "&") {
            advance(2);
            out.push({ kind: "op", value: "|&", subs: [], line: startLine, column: startCol });
            continue;
        }
        if (ch === "|" || ch === ";") {
            advance(1);
            out.push({ kind: "op", value: ch, subs: [], line: startLine, column: startCol });
            continue;
        }
        if (ch === "&" && input[i + 1] !== ">") {
            advance(1);
            out.push({ kind: "op", value: "&", subs: [], line: startLine, column: startCol });
            continue;
        }

        const [redirOp, redirLen] = matchRedirection(input.slice(i));
        if (redirLen > 0) {
            advance(redirLen);
            out.push({ kind: "redir", value: redirOp, subs: [], line: startLine, column: startCol });
            continue;
        }

        let val = "";
        const subs: SubScript[] = [];

        while (i < n) {
            const c = input[i];
            if (c === "\\" && input[i + 1] === "\n") {
                advance(2);
                continue;
            }
            if (
                c === " " || c === "\t" || c === "\r" || c === "\n" ||
                c === "|" || c === ";" || c === "(" || c === ")" ||
                c === "&" || c === "<" || c === ">"
            ) {
                break;
            }
            if (c === "'") {
                advance(1);
                while (i < n && input[i] !== "'") {
                    val += input[i];
                    advance(1);
                }
                if (i < n && input[i] === "'") advance(1);
                continue;
            }
            if (c === '"') {
                advance(1);
                while (i < n && input[i] !== '"') {
                    if (input[i] === "\\" && i + 1 < n) {
                        val += input[i + 1];
                        advance(2);
                        continue;
                    }
                    if (input[i] === "$" && input[i + 1] === "(") {
                        const subLine = line;
                        const subCol = col;
                        advance(2);
                        const [body, consumed] = extractBalancedParen(input.slice(i));
                        advance(consumed);
                        subs.push({ kind: "cmdsub", script: body, line: subLine, column: subCol });
                        val += `$(${body})`;
                        continue;
                    }
                    if (input[i] === "`") {
                        const subLine = line;
                        const subCol = col;
                        advance(1);
                        const [body, consumed] = extractBacktick(input.slice(i));
                        advance(consumed);
                        subs.push({ kind: "backtick", script: body, line: subLine, column: subCol });
                        val += `\`${body}\``;
                        continue;
                    }
                    val += input[i];
                    advance(1);
                }
                if (i < n && input[i] === '"') advance(1);
                continue;
            }
            if (c === "$" && input[i + 1] === "(") {
                const subLine = line;
                const subCol = col;
                advance(2);
                const [body, consumed] = extractBalancedParen(input.slice(i));
                advance(consumed);
                subs.push({ kind: "cmdsub", script: body, line: subLine, column: subCol });
                val += `$(${body})`;
                continue;
            }
            if (c === "`") {
                const subLine = line;
                const subCol = col;
                advance(1);
                const [body, consumed] = extractBacktick(input.slice(i));
                advance(consumed);
                subs.push({ kind: "backtick", script: body, line: subLine, column: subCol });
                val += `\`${body}\``;
                continue;
            }
            if (c === "\\" && i + 1 < n) {
                val += input[i + 1];
                advance(2);
                continue;
            }
            val += c;
            advance(1);
        }

        out.push({ kind: "word", value: val, subs, line: startLine, column: startCol });
    }
    return out;
}

function unwrapCommandPrefixes(seg: ShellSegment): void {
    while (seg.argv.length > 0) {
        const head = baseCommandName(seg.argv[0]);
        if (head === "sudo" || head === "doas") {
            seg.elevated = true;
            let idx = 1;
            while (idx < seg.argv.length) {
                const arg = seg.argv[idx];
                if (arg === "--") {
                    idx++;
                    break;
                }
                if (arg.startsWith("-")) {
                    if (["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"].includes(arg) && idx + 1 < seg.argv.length) {
                        idx += 2;
                        continue;
                    }
                    idx++;
                    continue;
                }
                if (isEnvAssignment(arg)) {
                    seg.envVars.push(arg);
                    idx++;
                    continue;
                }
                break;
            }
            seg.argv = seg.argv.slice(idx);
        } else if (head === "env") {
            let idx = 1;
            while (idx < seg.argv.length) {
                const arg = seg.argv[idx];
                if (arg === "--") {
                    idx++;
                    break;
                }
                if (arg.startsWith("-")) {
                    if (["-u", "-C", "-S"].includes(arg) && idx + 1 < seg.argv.length) {
                        idx += 2;
                        continue;
                    }
                    idx++;
                    continue;
                }
                if (isEnvAssignment(arg)) {
                    seg.envVars.push(arg);
                    idx++;
                    continue;
                }
                break;
            }
            if (idx >= seg.argv.length) return;
            seg.argv = seg.argv.slice(idx);
        } else if (["command", "builtin", "nohup", "setsid", "time"].includes(head)) {
            let idx = 1;
            while (idx < seg.argv.length && seg.argv[idx].startsWith("-")) {
                if (seg.argv[idx] === "--") {
                    idx++;
                    break;
                }
                if (head === "command" && (seg.argv[idx] === "-v" || seg.argv[idx] === "-V")) return;
                idx++;
            }
            if (idx >= seg.argv.length) return;
            seg.argv = seg.argv.slice(idx);
        } else if (head === "timeout") {
            let idx = 1;
            while (idx < seg.argv.length && seg.argv[idx].startsWith("-")) {
                if ((seg.argv[idx] === "-k" || seg.argv[idx] === "-s") && idx + 1 < seg.argv.length) {
                    idx += 2;
                    continue;
                }
                idx++;
            }
            if (idx < seg.argv.length) idx++;
            if (idx >= seg.argv.length) return;
            seg.argv = seg.argv.slice(idx);
        } else if (head === "busybox") {
            if (seg.argv.length < 2 || seg.argv[1].startsWith("-")) return;
            seg.argv = seg.argv.slice(1);
        } else {
            return;
        }
    }
}

function parseShellSegments(script: string): ShellSegment[] {
    const tokens = tokenizeShell(script);
    if (tokens.length === 0) return [];
    const segments: ShellSegment[] = [];
    let cur: ShellSegment = {
        envVars: [],
        argv: [],
        redirects: [],
        substitutions: [],
        connectorToNext: "",
        elevated: false,
        line: 1,
        column: 1,
    };
    let active = false;

    const flush = (conn: string) => {
        if (!active) return;
        if (cur.argv.length > 0 || cur.envVars.length > 0 || cur.redirects.length > 0 || cur.substitutions.length > 0) {
            cur.connectorToNext = conn;
            segments.push(cur);
        }
        cur = { envVars: [], argv: [], redirects: [], substitutions: [], connectorToNext: "", elevated: false, line: 1, column: 1 };
        active = false;
    };

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.kind === "op") {
            flush(tok.value === "\n" ? ";" : tok.value);
        } else if (tok.kind === "subshell") {
            if (!active) {
                cur.line = tok.line;
                cur.column = tok.column;
                active = true;
            }
            cur.substitutions.push({ kind: "subshell", script: tok.value, line: tok.line, column: tok.column });
        } else if (tok.kind === "redir") {
            if (!active) {
                cur.line = tok.line;
                cur.column = tok.column;
                active = true;
            }
            let target = "";
            if (i + 1 < tokens.length && tokens[i + 1].kind === "word") {
                i++;
                target = tokens[i].value;
                cur.substitutions.push(...tokens[i].subs);
            }
            cur.redirects.push({ operator: tok.value, target, line: tok.line, column: tok.column });
        } else {
            if (!active) {
                cur.line = tok.line;
                cur.column = tok.column;
                active = true;
            }
            cur.substitutions.push(...tok.subs);
            if (cur.argv.length === 0 && isEnvAssignment(tok.value)) {
                cur.envVars.push(tok.value);
                continue;
            }
            cur.argv.push(tok.value);
        }
    }
    flush("");
    for (const seg of segments) unwrapCommandPrefixes(seg);
    return segments;
}

function decodeBase64Payload(encoded: string, allowUtf16Le: boolean): string | null {
    const trimmed = encoded.trim();
    if (trimmed.length < 8 || trimmed.length > 16384 || !/^[A-Za-z0-9+/_=-]+$/.test(trimmed)) {
        return null;
    }
    try {
        const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        let bytes: Uint8Array;
        if (typeof Buffer !== "undefined") {
            bytes = new Uint8Array(Buffer.from(padded, "base64"));
        } else {
            const bin = atob(padded);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        }
        if (bytes.length === 0) return null;

        if (allowUtf16Le && bytes.length % 2 === 0) {
            let zeroBytes = 0;
            for (const b of bytes) if (b === 0) zeroBytes++;
            if (zeroBytes >= Math.floor(bytes.length / 4)) {
                let u16 = "";
                for (let i = 0; i < bytes.length; i += 2) {
                    u16 += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
                }
                if (isPrintableScript(u16)) return u16.trim();
            }
        }
        const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (isPrintableScript(utf8)) return utf8.trim();
    } catch {
        return null;
    }
    return null;
}

function isPrintableScript(s: string): boolean {
    if (!s.trim()) return false;
    let printable = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c !== 0x7f)) printable++;
    }
    return printable * 100 >= s.length * 90;
}

function normalizeTargetPath(p: string): string {
    let low = p.trim().replace(/^["']|["']$/g, "").toLowerCase();
    if (low.length > 1 && low.endsWith("/") && low !== "~/" && low !== "../" && low !== "c:/" && !low.endsWith("}/")) {
        low = low.replace(/\/+$/, "") || "/";
    }
    return low;
}

function matchSensitiveCredentialFile(arg: string): string {
    const norm = arg.trim().toLowerCase().replace(/\\/g, "/");
    for (const needle of SENSITIVE_FILE_NEEDLES) {
        if (norm.includes(needle)) return arg;
    }
    const base = norm.includes("/") ? norm.slice(norm.lastIndexOf("/") + 1) : norm;
    if (
        base === ".env" ||
        (base.startsWith(".env.") && !base.endsWith(".example") && !base.endsWith(".sample") && !base.endsWith(".template"))
    ) {
        return arg;
    }
    return "";
}

function matchPersistencePath(target: string): string {
    const norm = target.trim().toLowerCase().replace(/\\/g, "/");
    for (const needle of [
        "/etc/sudoers",
        "/etc/passwd",
        "/etc/shadow",
        "/etc/ld.so.preload",
        "/etc/crontab",
        "/etc/cron.",
        ".ssh/authorized_keys",
    ]) {
        if (norm.includes(needle)) return target;
    }
    return "";
}

function isPayloadDecoder(seg: ShellSegment): boolean {
    if (seg.argv.length === 0) return false;
    const cmd = baseCommandName(seg.argv[0]);
    if (cmd === "base64") return seg.argv.slice(1).some((a) => a === "-d" || a === "-D" || a === "--decode");
    if (cmd === "xxd") return seg.argv.slice(1).some((a) => ["-r", "-p", "-rp", "-pr"].includes(a));
    if (cmd === "openssl" && (seg.argv[1] === "enc" || seg.argv[1] === "base64")) {
        return seg.argv.slice(2).includes("-d");
    }
    return false;
}

function detectCredentialSource(seg: ShellSegment): string {
    if (seg.argv.length === 0) return "";
    const cmd = baseCommandName(seg.argv[0]);
    if (cmd === "env" || cmd === "printenv" || (cmd === "export" && seg.argv.length === 2 && seg.argv[1] === "-p")) {
        return `process environment dump (${cmd})`;
    }
    if (["cat", "head", "tail", "less", "more", "base64", "tar", "zip", "grep"].includes(cmd)) {
        for (const a of seg.argv.slice(1)) {
            const matched = matchSensitiveCredentialFile(a);
            if (matched) return `credential file '${matched}'`;
        }
    }
    for (const a of seg.argv.slice(1)) {
        if (SECRET_ENV_VAR_RE.test(a)) return "secret environment variable";
    }
    return "";
}

function formatSegmentSummary(seg: ShellSegment): string {
    const parts: string[] = [];
    if (seg.elevated) parts.push("sudo");
    parts.push(...seg.envVars, ...seg.argv);
    for (const r of seg.redirects) {
        parts.push(r.target ? `${r.operator} ${r.target}` : r.operator);
    }
    return parts.join(" ");
}

function computeVerdict(policy: CommandPolicyMode, errors: number, warnings: number): CommandActionVerdict {
    if (errors === 0 && warnings === 0) return "allow";
    if (policy === "strict") return "block";
    if (policy === "permissive") return errors > 0 ? "require_approval" : "warn";
    return errors > 0 ? "block" : "require_approval";
}

/**
 * Evaluate a shell command or multi-line script against rules SLT011..SLT016.
 */
export function analyzeShellCommand(
    script: string,
    options?: { policy?: CommandPolicyMode; source?: string }
): CommandGuardReport {
    const policy: CommandPolicyMode = options?.policy ?? "balanced";
    const source = options?.source ?? "inline";
    const findings: CommandFinding[] = [];
    const unwrappedCommands: string[] = [];
    const seenKeys = new Set<string>();
    let segmentCount = 0;

    const recordUnwrapped = (entry: string) => {
        if (!unwrappedCommands.includes(entry)) unwrappedCommands.push(entry);
    };

    const addFinding = (
        ruleId: CommandRuleId,
        severityOverride: CommandSeverity | null,
        line: number,
        column: number,
        cmdText: string,
        layer: string,
        message: string
    ) => {
        const desc = RULE_MAP[ruleId];
        const sev = severityOverride ?? desc.severity;
        const trimmedCmd = cmdText.trim().length > 180 ? `${cmdText.trim().slice(0, 177)}...` : cmdText.trim();
        const key = `${ruleId}:${line}:${trimmedCmd}:${layer}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        findings.push({
            ruleId,
            ruleName: desc.name,
            severity: sev,
            cwe: desc.cwe,
            line: Math.max(1, line),
            column: Math.max(1, column),
            command: trimmedCmd,
            decodedLayer: layer || undefined,
            riskPoints: desc.baseRisk,
            message,
            remediation: desc.help,
        });
    };

    const analyzeLayer = (text: string, layerLabel: string, baseLine: number, depth: number) => {
        if (depth > MAX_RECURSION_DEPTH || !text.trim()) return;

        const bombMatch = FORK_BOMB_RE.exec(text);
        if (bombMatch && bombMatch.index !== undefined) {
            const ln = baseLine + text.slice(0, bombMatch.index).split("\n").length - 1;
            addFinding(
                "SLT011",
                null,
                ln,
                1,
                bombMatch[0].trim(),
                layerLabel,
                "Recursive shell fork bomb definition will exhaust host PID and CPU tables."
            );
        }

        const segments = parseShellSegments(text);
        if (depth === 0) segmentCount += segments.length;

        let i = 0;
        while (i < segments.length) {
            const pipeStart = i;
            while (i < segments.length && (segments[i].connectorToNext === "|" || segments[i].connectorToNext === "|&")) {
                i++;
            }
            const pipeEnd = Math.min(i, segments.length - 1);
            const pipeline = segments.slice(pipeStart, pipeEnd + 1);
            inspectPipeline(pipeline, layerLabel, baseLine, depth);
            i = pipeEnd + 1;
        }
    };

    const inspectPipeline = (pipeline: ShellSegment[], layerLabel: string, baseLine: number, depth: number) => {
        if (pipeline.length === 0) return;
        for (const seg of pipeline) {
            const adjLine = baseLine > 1 ? baseLine + seg.line - 1 : seg.line;
            inspectSingleSegment(seg, adjLine, layerLabel, depth);
        }

        const adjPipeLine = baseLine > 1 ? baseLine + pipeline[0].line - 1 : pipeline[0].line;
        const pipeSummary = pipeline.map(formatSegmentSummary).join(" | ");
        let hasNetFetch = false;
        let hasDecoder = false;
        let literalEchoArg = "";
        let hasCredSource = false;
        let credSourceDesc = "";

        for (let stageIdx = 0; stageIdx < pipeline.length; stageIdx++) {
            const seg = pipeline[stageIdx];
            if (seg.argv.length === 0) continue;
            const cmd = baseCommandName(seg.argv[0]);

            if (NETWORK_FETCHERS.has(cmd)) {
                hasNetFetch = true;
                for (const a of seg.argv) {
                    const m = IMDS_ENDPOINT_RE.exec(a);
                    if (m) {
                        addFinding(
                            "SLT014",
                            null,
                            adjPipeLine,
                            pipeline[0].column,
                            pipeSummary,
                            layerLabel,
                            `Command queries cloud Instance Metadata Service (${m[0]}) for workload credentials.`
                        );
                    }
                }
            }
            if (cmd === "echo" || cmd === "printf") {
                for (const a of seg.argv.slice(1)) {
                    if (!a.startsWith("-") && a.length >= 8) literalEchoArg = a;
                }
            }
            if (isPayloadDecoder(seg)) hasDecoder = true;
            const src = detectCredentialSource(seg);
            if (src) {
                hasCredSource = true;
                credSourceDesc = src;
            }

            if (stageIdx > 0 && SHELL_INTERPRETERS.has(cmd)) {
                if (hasNetFetch) {
                    addFinding(
                        "SLT012",
                        null,
                        adjPipeLine,
                        pipeline[0].column,
                        pipeSummary,
                        layerLabel,
                        `Pipeline streams unverified network response directly into interpreter '${cmd}'.`
                    );
                }
                if (hasDecoder) {
                    addFinding(
                        "SLT012",
                        null,
                        adjPipeLine,
                        pipeline[0].column,
                        pipeSummary,
                        layerLabel,
                        `Pipeline decodes obfuscated data and pipes it directly into interpreter '${cmd}'.`
                    );
                    if (literalEchoArg) {
                        const decoded = decodeBase64Payload(literalEchoArg, false);
                        if (decoded) {
                            recordUnwrapped(`base64-pipe: ${decoded}`);
                            analyzeLayer(decoded, "base64-pipe", adjPipeLine, depth + 1);
                        }
                    }
                }
            }

            if (stageIdx > 0) {
                const prevCmd = pipeline[stageIdx - 1].argv[0] ? baseCommandName(pipeline[stageIdx - 1].argv[0]) : "";
                if (["nc", "ncat", "netcat", "openssl"].includes(prevCmd) && SHELL_INTERPRETERS.has(cmd)) {
                    addFinding(
                        "SLT013",
                        null,
                        adjPipeLine,
                        pipeline[0].column,
                        pipeSummary,
                        layerLabel,
                        `Remote socket stream from '${prevCmd}' is wired directly into interactive interpreter '${cmd}'.`
                    );
                }
                if (SHELL_INTERPRETERS.has(prevCmd) && ["nc", "ncat", "netcat"].includes(cmd)) {
                    addFinding(
                        "SLT013",
                        null,
                        adjPipeLine,
                        pipeline[0].column,
                        pipeSummary,
                        layerLabel,
                        `Interactive interpreter '${prevCmd}' stdout is piped into network socket tool '${cmd}'.`
                    );
                }
            }

            if (stageIdx > 0 && hasCredSource && OUTBOUND_SINKS.has(cmd)) {
                addFinding(
                    "SLT014",
                    null,
                    adjPipeLine,
                    pipeline[0].column,
                    pipeSummary,
                    layerLabel,
                    `Pipeline reads ${credSourceDesc} and streams it to outbound network command '${cmd}'.`
                );
            }

            if (stageIdx > 0 && cmd === "crontab" && hasNetFetch) {
                addFinding(
                    "SLT015",
                    "error",
                    adjPipeLine,
                    pipeline[0].column,
                    pipeSummary,
                    layerLabel,
                    "Remote payload is piped directly into crontab for persistent scheduled execution."
                );
            }
        }
    };

    const inspectSingleSegment = (seg: ShellSegment, line: number, layerLabel: string, depth: number) => {
        const cmdText = formatSegmentSummary(seg);

        for (const envAssign of seg.envVars) {
            const upper = envAssign.toUpperCase();
            if (upper.startsWith("LD_PRELOAD=") || upper.startsWith("DYLD_INSERT_LIBRARIES=")) {
                addFinding(
                    "SLT015",
                    "error",
                    line,
                    seg.column,
                    cmdText,
                    layerLabel,
                    `Dynamic linker hijack variable '${envAssign.split("=")[0]}' injects shared libraries into child processes.`
                );
            }
        }

        for (const redir of seg.redirects) {
            const target = redir.target.trim();
            if (DEV_TCP_RE.test(target)) {
                addFinding(
                    "SLT013",
                    null,
                    line,
                    redir.column,
                    cmdText,
                    layerLabel,
                    `Shell redirection opens raw socket '${target}' for interactive reverse-shell transport.`
                );
            }
            if (redir.operator.includes(">") && RAW_BLOCK_DEV_RE.test(target)) {
                addFinding(
                    "SLT011",
                    null,
                    line,
                    redir.column,
                    cmdText,
                    layerLabel,
                    `Output redirection '${redir.operator} ${target}' overwrites raw block or kernel memory device.`
                );
            }
            if (redir.operator.includes(">")) {
                const persist = matchPersistencePath(target);
                if (persist) {
                    addFinding(
                        "SLT015",
                        "error",
                        line,
                        redir.column,
                        cmdText,
                        layerLabel,
                        `Output redirection mutates privileged authentication or persistence file '${persist}'.`
                    );
                }
            }
        }

        for (const sub of seg.substitutions) {
            const subLine = sub.line > 1 && seg.line > 0 ? line + (sub.line - seg.line) : line;
            analyzeLayer(sub.script, sub.kind, subLine, depth + 1);
        }

        if (seg.argv.length === 0) return;
        const cmd = baseCommandName(seg.argv[0]);
        const args = seg.argv.slice(1);

        for (const a of seg.argv) {
            if (DEV_TCP_RE.test(a)) {
                addFinding(
                    "SLT013",
                    null,
                    line,
                    seg.column,
                    cmdText,
                    layerLabel,
                    `Command references virtual socket path '${a}' for raw network pivoting.`
                );
            }
        }

        // Unwrap nested execution wrappers
        if (["sh", "bash", "zsh", "dash", "ksh", "ash"].includes(cmd)) {
            for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if ((a === "-c" || (a.startsWith("-") && !a.startsWith("--") && a.includes("c"))) && i + 1 < args.length) {
                    recordUnwrapped(`${cmd} -c: ${args[i + 1]}`);
                    analyzeLayer(args[i + 1], `${cmd} -c`, line, depth + 1);
                    break;
                }
            }
        } else if (cmd === "eval" && args.length > 0) {
            const inner = args.join(" ");
            recordUnwrapped(`eval: ${inner}`);
            analyzeLayer(inner, "eval", line, depth + 1);
        } else if (cmd === "pwsh" || cmd === "powershell") {
            for (let i = 0; i < args.length; i++) {
                const low = args[i].toLowerCase();
                if (["-encodedcommand", "-enc", "-ec", "-e"].includes(low) && i + 1 < args.length) {
                    addFinding(
                        "SLT012",
                        null,
                        line,
                        seg.column,
                        cmdText,
                        layerLabel,
                        "PowerShell -EncodedCommand executes an obfuscated Base64 script block."
                    );
                    const decoded = decodeBase64Payload(args[i + 1], true);
                    if (decoded) {
                        recordUnwrapped(`pwsh -EncodedCommand: ${decoded}`);
                        analyzeLayer(decoded, "pwsh-encoded", line, depth + 1);
                    }
                    break;
                }
                if ((low === "-command" || low === "-c") && i + 1 < args.length) {
                    const inner = args.slice(i + 1).join(" ");
                    recordUnwrapped(`pwsh -Command: ${inner}`);
                    analyzeLayer(inner, "pwsh -Command", line, depth + 1);
                    break;
                }
            }
        } else if (cmd === "xargs") {
            let idx = 0;
            while (idx < args.length) {
                const a = args[idx];
                if (a === "--") {
                    idx++;
                    break;
                }
                if (a.startsWith("-")) {
                    if (["-I", "-L", "-n", "-P", "-s", "-d"].includes(a) && idx + 1 < args.length) {
                        idx += 2;
                        continue;
                    }
                    idx++;
                    continue;
                }
                break;
            }
            if (idx < args.length) analyzeLayer(args.slice(idx).join(" "), "xargs", line, depth + 1);
        }

        // SLT011: destructive fs / block device
        if (cmd === "rm") {
            let recursive = false;
            let noPreserveRoot = false;
            let afterDash = false;
            const targets: string[] = [];
            for (const a of args) {
                if (!afterDash && a === "--") {
                    afterDash = true;
                    continue;
                }
                if (!afterDash && a.startsWith("--")) {
                    if (a === "--recursive") recursive = true;
                    else if (a.startsWith("--no-preserve-root")) noPreserveRoot = true;
                    continue;
                }
                if (!afterDash && a.startsWith("-") && a.length > 1) {
                    if (/[rR]/.test(a.slice(1))) recursive = true;
                    continue;
                }
                targets.push(a);
            }
            if (noPreserveRoot) {
                addFinding(
                    "SLT011",
                    null,
                    line,
                    seg.column,
                    cmdText,
                    layerLabel,
                    "rm --no-preserve-root explicitly disables root filesystem deletion protection."
                );
            }
            if (recursive) {
                for (const t of targets) {
                    if (CRITICAL_ROOTS.has(normalizeTargetPath(t))) {
                        addFinding(
                            "SLT011",
                            null,
                            line,
                            seg.column,
                            cmdText,
                            layerLabel,
                            `Recursive deletion 'rm' targets critical root, home, or system path '${t}'.`
                        );
                    } else if (UNGUARDED_VAR_ROOT_RE.test(t.trim())) {
                        addFinding(
                            "SLT011",
                            null,
                            line,
                            seg.column,
                            cmdText,
                            layerLabel,
                            `Unguarded variable root '${t}' in recursive rm expands to '/' or '/*' if the variable is unset.`
                        );
                    }
                }
            }
        } else if (cmd === "find" && args.length > 0) {
            const roots: string[] = [];
            let hasDelete = false;
            for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if (!a.startsWith("-") && a !== "!" && a !== "(" && roots.length === 0) {
                    roots.push(a);
                    continue;
                }
                if (a === "-delete") hasDelete = true;
                if ((a === "-exec" || a === "-execdir") && args[i + 1] && baseCommandName(args[i + 1]) === "rm") {
                    hasDelete = true;
                }
            }
            if (hasDelete) {
                for (const r of roots) {
                    if (CRITICAL_ROOTS.has(normalizeTargetPath(r))) {
                        addFinding(
                            "SLT011",
                            null,
                            line,
                            seg.column,
                            cmdText,
                            layerLabel,
                            `find on critical system path '${r}' with destructive -delete/-exec rm.`
                        );
                    }
                }
            }
        } else if (cmd === "dd") {
            for (const a of args) {
                if (a.toLowerCase().startsWith("of=") && RAW_BLOCK_DEV_RE.test(a.slice(3))) {
                    addFinding(
                        "SLT011",
                        null,
                        line,
                        seg.column,
                        cmdText,
                        layerLabel,
                        `dd writes directly to raw block or memory device '${a.slice(3)}'.`
                    );
                }
            }
        } else if (["wipefs", "blkdiscard", "shred"].includes(cmd)) {
            for (const a of args) {
                if (RAW_BLOCK_DEV_RE.test(a)) {
                    addFinding("SLT011", null, line, seg.column, cmdText, layerLabel, `'${cmd}' irreversibly erases raw block device '${a}'.`);
                }
            }
        } else if (["remove-item", "ri", "del", "erase", "rmdir", "rd"].includes(cmd)) {
            let recurse = false;
            const targets: string[] = [];
            for (const a of args) {
                const low = a.toLowerCase();
                if (low === "-recurse" || low === "-r" || low === "/s") {
                    recurse = true;
                    continue;
                }
                if (a.startsWith("-") || (a.startsWith("/") && a.length === 2)) continue;
                targets.push(a);
            }
            if (recurse) {
                for (const t of targets) {
                    if (CRITICAL_ROOTS.has(normalizeTargetPath(t))) {
                        addFinding("SLT011", null, line, seg.column, cmdText, layerLabel, `Recursive '${cmd}' targets root or profile directory '${t}'.`);
                    }
                }
            }
        } else if (cmd === "format-volume" || cmd === "clear-disk") {
            addFinding("SLT011", null, line, seg.column, cmdText, layerLabel, `PowerShell disk-formatting cmdlet '${cmd}' wipes partition data.`);
        } else if (cmd === "mkfs" || cmd.startsWith("mkfs.")) {
            addFinding("SLT011", null, line, seg.column, cmdText, layerLabel, `Filesystem formatter '${cmd}' destroys existing partition data.`);
        }

        // SLT012: substitution fetch execution
        if (SHELL_INTERPRETERS.has(cmd) || cmd === "source" || cmd === "." || cmd === "eval") {
            for (const sub of seg.substitutions) {
                const subSegs = parseShellSegments(sub.script);
                if (subSegs.some((s) => s.argv[0] && NETWORK_FETCHERS.has(baseCommandName(s.argv[0])))) {
                    addFinding(
                        "SLT012",
                        null,
                        line,
                        seg.column,
                        cmdText,
                        layerLabel,
                        `'${cmd}' directly executes network content fetched via ${sub.kind} substitution.`
                    );
                    break;
                }
            }
            const joined = args.join(" ").toLowerCase();
            if (
                (cmd === "iex" || cmd === "invoke-expression") &&
                (joined.includes("invoke-webrequest") ||
                    joined.includes("invoke-restmethod") ||
                    joined.includes("downloadstring") ||
                    joined.includes("iwr ") ||
                    joined.includes("irm "))
            ) {
                addFinding(
                    "SLT012",
                    null,
                    line,
                    seg.column,
                    cmdText,
                    layerLabel,
                    "PowerShell Invoke-Expression evaluates a remote web download inline without verification."
                );
            }
        }

        // SLT013: reverse shells
        if (["nc", "ncat", "netcat", "cryptcat"].includes(cmd)) {
            for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if (a === "-e" || a === "-c" || a === "--exec" || a === "--sh-exec" || a.startsWith("--exec=") || a.startsWith("--sh-exec=")) {
                    const target = !a.includes("=") && args[i + 1] ? `${a} ${args[i + 1]}` : a;
                    addFinding(
                        "SLT013",
                        null,
                        line,
                        seg.column,
                        cmdText,
                        layerLabel,
                        `'${cmd} ${target}' binds a local command interpreter directly to a network socket.`
                    );
                    break;
                }
            }
        } else if (cmd === "socat") {
            const hasNet = args.some((a) => /^(?:tcp[46]?|openssl|ssl|udp):/i.test(a));
            const hasExec = args.some((a) => /^(?:exec|system):/i.test(a));
            if (hasNet && hasExec) {
                addFinding(
                    "SLT013",
                    null,
                    line,
                    seg.column,
                    cmdText,
                    layerLabel,
                    "socat bridges a remote network socket directly to an EXEC/SYSTEM shell process."
                );
            }
        } else if (["python", "python3", "python2", "perl", "ruby", "php", "node", "lua"].includes(cmd)) {
            const inline = args.join(" ").toLowerCase();
            const hasSocket = inline.includes("socket") || inline.includes("fsockopen") || inline.includes("tcpsocket");
            const hasSpawn =
                inline.includes("pty.spawn") ||
                inline.includes("os.dup2") ||
                inline.includes("subprocess") ||
                inline.includes("/bin/sh") ||
                inline.includes("/bin/bash") ||
                inline.includes("proc_open") ||
                inline.includes("child_process");
            if (hasSocket && hasSpawn) {
                addFinding(
                    "SLT013",
                    null,
                    line,
                    seg.column,
                    cmdText,
                    layerLabel,
                    `Inline '${cmd}' script opens a raw network socket and spawns an interactive shell.`
                );
            }
        }

        // SLT014: credential & IMDS exfiltration
        for (const a of seg.argv) {
            const m = IMDS_ENDPOINT_RE.exec(a);
            if (m) {
                addFinding(
                    "SLT014",
                    null,
                    line,
                    seg.column,
                    cmdText,
                    layerLabel,
                    `Command accesses cloud Instance Metadata Service (${m[0]}) credential endpoint.`
                );
            }
        }
        if (OUTBOUND_SINKS.has(cmd)) {
            for (const a of args) {
                let cleaned = a.startsWith("@") ? a.slice(1) : a;
                const eq = cleaned.indexOf("=");
                if (eq >= 0) cleaned = cleaned.slice(eq + 1).replace(/^@/, "");
                const credFile = matchSensitiveCredentialFile(cleaned);
                if (credFile) {
                    addFinding(
                        "SLT014",
                        null,
                        line,
                        seg.column,
                        cmdText,
                        layerLabel,
                        `Outbound network command '${cmd}' transmits sensitive credential file '${credFile}'.`
                    );
                    break;
                }
                if (SECRET_ENV_VAR_RE.test(a)) {
                    addFinding(
                        "SLT014",
                        null,
                        line,
                        seg.column,
                        cmdText,
                        layerLabel,
                        `Outbound network command '${cmd}' interpolates secret environment variable into request parameters.`
                    );
                    break;
                }
            }
            for (const sub of seg.substitutions) {
                for (const s of parseShellSegments(sub.script)) {
                    const src = detectCredentialSource(s);
                    if (src) {
                        addFinding(
                            "SLT014",
                            null,
                            line,
                            seg.column,
                            cmdText,
                            layerLabel,
                            `Outbound network command '${cmd}' embeds ${src} inside a command substitution.`
                        );
                        break;
                    }
                }
            }
        }

        // SLT015: privilege escalation & persistence
        if (cmd === "chmod") {
            let recursive = false;
            let suid = false;
            let worldWritable = false;
            const targets: string[] = [];
            for (const a of args) {
                if (a === "-R" || a === "--recursive") {
                    recursive = true;
                    continue;
                }
                if (a.startsWith("-") && a.length > 1 && !a.includes("+")) {
                    if (a.slice(1).includes("R")) recursive = true;
                    continue;
                }
                if (a.includes("+s") || OCTAL_SUID_RE.test(a)) {
                    suid = true;
                    continue;
                }
                if (a === "777" || a === "0777" || a.includes("a+w") || a.includes("o+w")) {
                    worldWritable = true;
                    continue;
                }
                targets.push(a);
            }
            if (suid) {
                addFinding("SLT015", "error", line, seg.column, cmdText, layerLabel, "chmod sets SUID/SGID privilege-escalation bit on executable target.");
            }
            if (recursive && worldWritable) {
                for (const t of targets) {
                    if (CRITICAL_ROOTS.has(normalizeTargetPath(t))) {
                        addFinding("SLT015", "error", line, seg.column, cmdText, layerLabel, `Recursive world-writable chmod on critical system directory '${t}'.`);
                    }
                }
            }
        } else if (cmd === "tee") {
            for (const a of args) {
                if (a.startsWith("-")) continue;
                const persist = matchPersistencePath(a);
                if (persist) {
                    addFinding("SLT015", "error", line, seg.column, cmdText, layerLabel, `tee writes directly to privileged authentication or persistence file '${persist}'.`);
                }
            }
        } else if ((cmd === "docker" || cmd === "podman") && ["run", "exec", "create"].includes(args[0] ?? "")) {
            for (let i = 1; i < args.length; i++) {
                const a = args[i];
                if (a === "--privileged" || a.startsWith("--privileged=true")) {
                    addFinding("SLT015", "error", line, seg.column, cmdText, layerLabel, `'${cmd} ${args[0]} --privileged' grants full host kernel capability and device access.`);
                }
                let volSpec = "";
                if ((a === "-v" || a === "--volume") && args[i + 1]) {
                    volSpec = args[i + 1];
                    i++;
                } else if (a.startsWith("-v=") || a.startsWith("--volume=")) {
                    volSpec = a.slice(a.indexOf("=") + 1);
                }
                if (volSpec) {
                    const hostSide = volSpec.split(":")[0];
                    const normHost = normalizeTargetPath(hostSide);
                    if (normHost === "/" || normHost === "/etc" || normHost === "/root" || hostSide.toLowerCase().includes("docker.sock")) {
                        addFinding("SLT015", "error", line, seg.column, cmdText, layerLabel, `Container bind-mounts sensitive host root or runtime socket ('${volSpec}').`);
                    }
                }
            }
        } else if (cmd === "nsenter") {
            for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if (((a === "-t" || a === "--target") && args[i + 1] === "1") || a === "-t1" || a === "--target=1") {
                    addFinding("SLT015", "error", line, seg.column, cmdText, layerLabel, "nsenter targets PID 1 to enter host init namespaces from an elevated context.");
                    break;
                }
            }
        } else if (cmd === "setenforce" && (args[0] === "0" || args[0]?.toLowerCase() === "permissive")) {
            addFinding("SLT015", "warning", line, seg.column, cmdText, layerLabel, "setenforce 0 disables SELinux mandatory access control enforcement.");
        } else if (cmd === "ufw" && args[0]?.toLowerCase() === "disable") {
            addFinding("SLT015", "warning", line, seg.column, cmdText, layerLabel, "ufw disable turns off host firewall packet filtering.");
        } else if (cmd === "iptables" && args.some((a) => a === "-F" || a === "--flush")) {
            addFinding("SLT015", "warning", line, seg.column, cmdText, layerLabel, "iptables --flush clears active host firewall chains.");
        }

        // SLT016: Git guardrails
        if (cmd === "git" && args.length > 0) {
            let subIdx = 0;
            let hooksDisabled = false;
            while (subIdx < args.length) {
                const a = args[subIdx];
                if (a === "-c" && args[subIdx + 1]) {
                    const kv = args[subIdx + 1].toLowerCase();
                    if (kv.startsWith("core.hookspath=") && (kv.includes("/dev/null") || kv.endsWith("="))) {
                        hooksDisabled = true;
                    }
                    subIdx += 2;
                    continue;
                }
                if (["-C", "--git-dir", "--work-tree"].includes(a) && args[subIdx + 1]) {
                    subIdx += 2;
                    continue;
                }
                if (a.startsWith("-")) {
                    subIdx++;
                    continue;
                }
                break;
            }
            if (hooksDisabled) {
                addFinding("SLT016", null, line, seg.column, cmdText, layerLabel, "git -c core.hooksPath=/dev/null bypasses repository security hooks.");
            }
            if (subIdx < args.length) {
                const sub = args[subIdx];
                const subArgs = args.slice(subIdx + 1);
                if (sub === "push") {
                    const withLease = subArgs.some((a) => a === "--force-with-lease" || a.startsWith("--force-with-lease=") || a === "--force-if-includes");
                    const force = subArgs.some((a) => a === "--force" || a === "-f" || a.startsWith("+"));
                    if (force && !withLease) {
                        addFinding("SLT016", null, line, seg.column, cmdText, layerLabel, "git push --force overwrites remote commit history without --force-with-lease stale-ref protection.");
                    }
                    if (subArgs.includes("--no-verify")) {
                        addFinding("SLT016", null, line, seg.column, cmdText, layerLabel, "git push --no-verify bypasses pre-push verification hooks.");
                    }
                } else if (sub === "commit") {
                    for (let i = 0; i < subArgs.length; i++) {
                        const a = subArgs[i];
                        if (["-m", "-F", "-C", "-c", "--message"].includes(a)) {
                            i++;
                            continue;
                        }
                        if (a === "--no-verify" || a === "-n" || (a.startsWith("-") && !a.startsWith("--") && a.slice(1).includes("n") && !a.includes("="))) {
                            addFinding("SLT016", null, line, seg.column, cmdText, layerLabel, "git commit --no-verify bypasses pre-commit secret and lint hooks.");
                            break;
                        }
                    }
                } else if (sub === "reset" && subArgs.includes("--hard")) {
                    addFinding("SLT016", null, line, seg.column, cmdText, layerLabel, "git reset --hard irreversibly discards uncommitted index and working-tree changes.");
                } else if (sub === "clean") {
                    let hasForce = false;
                    let hasDirOrIgnored = false;
                    for (const a of subArgs) {
                        if (a === "--force") hasForce = true;
                        else if (a.startsWith("-") && !a.startsWith("--")) {
                            const fl = a.slice(1);
                            if (fl.includes("f") && !fl.includes("n")) hasForce = true;
                            if (/[dxX]/.test(fl)) hasDirOrIgnored = true;
                        }
                    }
                    if (hasForce && hasDirOrIgnored) {
                        addFinding("SLT016", null, line, seg.column, cmdText, layerLabel, "git clean -fd/-fdx permanently deletes untracked directories and ignored files.");
                    }
                }
            }
        }
    };

    analyzeLayer(script, "", 1, 0);

    let errorCount = 0;
    let warningCount = 0;
    let totalRisk = 0;
    for (const f of findings) {
        if (f.severity === "error") errorCount++;
        else if (f.severity === "warning") warningCount++;
        totalRisk += f.riskPoints;
    }

    return {
        source,
        policy,
        verdict: computeVerdict(policy, errorCount, warningCount),
        riskScore: Math.min(100, totalRisk),
        segmentCount,
        errorCount,
        warningCount,
        unwrappedCommands,
        findings,
    };
}

/**
 * Serialize a `CommandGuardReport` into an OASIS SARIF v2.1.0 JSON-compatible object.
 */
export function exportCommandGuardSarif(
    report: CommandGuardReport,
    version = "0.23.0"
): Record<string, unknown> {
    const rules = CMDGUARD_RULES.map((r) => ({
        id: r.id,
        name: r.name,
        shortDescription: { text: r.shortDescription },
        help: { text: r.help },
        defaultConfiguration: { level: r.severity },
        properties: {
            "security-severity": r.securitySeverity,
            tags: ["security", "shell", "agent-firewall", r.cwe.toLowerCase()],
        },
    }));

    const ruleIndexMap = Object.fromEntries(CMDGUARD_RULES.map((r, i) => [r.id, i]));
    const results = report.findings.map((f) => ({
        ruleId: f.ruleId,
        ruleIndex: ruleIndexMap[f.ruleId],
        level: f.severity,
        message: { text: f.decodedLayer ? `[layer: ${f.decodedLayer}] ${f.message}` : f.message },
        locations: [
            {
                physicalLocation: {
                    artifactLocation: { uri: report.source || "inline" },
                    region: { startLine: f.line, startColumn: f.column },
                },
            },
        ],
    }));

    return {
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
        runs: [
            {
                tool: {
                    driver: {
                        name: "slterm-cmdguard",
                        version,
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
