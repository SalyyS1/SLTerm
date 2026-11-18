// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package sshaudit provides static security analysis for OpenSSH client
// configurations (ProxyCommand injection, host-key verification bypasses,
// wildcard agent forwarding, deprecated cryptography, and secret exposure),
// ANSI-preserving terminal output secret redaction, and OASIS SARIF v2.1.0
// reporting.
package sshaudit

import (
	"fmt"
	"regexp"
	"strings"
)

// Severity classifies an SSH configuration security finding.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
	SeverityNote    Severity = "note"
)

// RuleDescriptor documents a static security rule in the SLTerm SSH catalog.
type RuleDescriptor struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Severity         Severity `json:"severity"`
	SecuritySeverity string   `json:"security_severity"`
	CWE              string   `json:"cwe"`
	ShortDescription string   `json:"short_description"`
	Help             string   `json:"help"`
}

// Finding represents a single security issue located in an OpenSSH config file.
type Finding struct {
	RuleID      string   `json:"rule_id"`
	RuleName    string   `json:"rule_name"`
	Severity    Severity `json:"severity"`
	CWE         string   `json:"cwe"`
	File        string   `json:"file"`
	Line        int      `json:"line"`
	Column      int      `json:"column"`
	HostContext string   `json:"host_context"`
	Directive   string   `json:"directive"`
	Message     string   `json:"message"`
	Remediation string   `json:"remediation"`
}

// AuditReport aggregates findings produced for a single SSH config file.
type AuditReport struct {
	File         string    `json:"file"`
	StanzaCount  int       `json:"stanza_count"`
	ErrorCount   int       `json:"error_count"`
	WarningCount int       `json:"warning_count"`
	Findings     []Finding `json:"findings"`
}

var ruleCatalog = []RuleDescriptor{
	{
		ID:               "SLT001",
		Name:             "ProxyCommandShellInjection",
		Severity:         SeverityError,
		SecuritySeverity: "9.1",
		CWE:              "CWE-78",
		ShortDescription: "ProxyCommand or KnownHostsCommand invokes a shell or expands unquoted remote tokens",
		Help:             "Replace ProxyCommand subshells and shell metacharacters with ProxyJump (-J) or exec nc without sh -c, and quote %h/%n/%r/%p expansions so malicious ssh:// URLs or Git submodules cannot inject shell commands (CVE-2023-51385 class).",
	},
	{
		ID:               "SLT002",
		Name:             "PermitLocalCommandExecution",
		Severity:         SeverityError,
		SecuritySeverity: "8.4",
		CWE:              "CWE-78",
		ShortDescription: "PermitLocalCommand or LocalCommand enables host command execution during SSH connection setup",
		Help:             "Set PermitLocalCommand no and remove LocalCommand directives, particularly in wildcard Host * stanzas or when expanding %h, %n, or %r tokens.",
	},
	{
		ID:               "SLT003",
		Name:             "HostKeyVerificationDisabled",
		Severity:         SeverityError,
		SecuritySeverity: "8.2",
		CWE:              "CWE-295",
		ShortDescription: "StrictHostKeyChecking disabled or UserKnownHostsFile routed to a null sink",
		Help:             "Use StrictHostKeyChecking yes or accept-new with a persistent UserKnownHostsFile so active network attackers cannot intercept SSH sessions.",
	},
	{
		ID:               "SLT004",
		Name:             "UnrestrictedAgentOrX11Forwarding",
		Severity:         SeverityWarning,
		SecuritySeverity: "6.8",
		CWE:              "CWE-522",
		ShortDescription: "ForwardAgent or ForwardX11Trusted enabled across wildcard or untrusted hosts",
		Help:             "Disable ForwardAgent on wildcard Host patterns and use ProxyJump (-J) so intermediate bastion root users cannot query your local SSH agent socket; avoid ForwardX11Trusted yes.",
	},
	{
		ID:               "SLT005",
		Name:             "WeakSshCryptography",
		Severity:         SeverityError,
		SecuritySeverity: "7.5",
		CWE:              "CWE-327",
		ShortDescription: "Deprecated or broken SSH key, cipher, MAC, or KEX algorithm enabled",
		Help:             "Remove SHA-1 RSA (ssh-rsa), DSA (ssh-dss), CBC/3DES/RC4 ciphers, MD5/96-bit MACs, and diffie-hellman-group1/group14-sha1 key exchanges in favor of ssh-ed25519, rsa-sha2-512, chacha20-poly1305@openssh.com, and curve25519-sha256.",
	},
	{
		ID:               "SLT006",
		Name:             "SensitiveEnvForwarding",
		Severity:         SeverityWarning,
		SecuritySeverity: "6.1",
		CWE:              "CWE-200",
		ShortDescription: "SendEnv forwards wildcard or credential-bearing environment variables to remote hosts",
		Help:             "Restrict SendEnv to non-sensitive locale or terminal variables instead of wildcards (*) or secret-matching prefixes (AWS_*, GITHUB_*, *_TOKEN, *_KEY, *_SECRET).",
	},
	{
		ID:               "SLT007",
		Name:             "WildcardTunnelBindExposure",
		Severity:         SeverityWarning,
		SecuritySeverity: "6.5",
		CWE:              "CWE-284",
		ShortDescription: "GatewayPorts enabled or LocalForward/RemoteForward bound to all network interfaces",
		Help:             "Bind LocalForward, RemoteForward, and DynamicForward explicitly to 127.0.0.1 or ::1 and set GatewayPorts no unless external exposure is intentional.",
	},
	{
		ID:               "SLT008",
		Name:             "MatchExecTokenInjection",
		Severity:         SeverityError,
		SecuritySeverity: "8.8",
		CWE:              "CWE-78",
		ShortDescription: "Match exec evaluates remote hostname or user tokens in a local shell prior to authentication",
		Help:             "Avoid unquoted %h, %n, %r, or %p tokens inside Match exec predicates, which OpenSSH executes through the user's shell during config resolution.",
	},
	{
		ID:               "SLT009",
		Name:             "SharedTmpControlSocket",
		Severity:         SeverityWarning,
		SecuritySeverity: "5.9",
		CWE:              "CWE-377",
		ShortDescription: "ControlPath places multiplexed SSH control sockets in a shared /tmp or /var/tmp directory",
		Help:             "Store ControlPath sockets inside a mode-0700 user directory such as ~/.ssh/sockets/%C to prevent local socket collision and pre-creation attacks.",
	},
	{
		ID:               "SLT010",
		Name:             "InlineSecretOrUnicodeSmuggling",
		Severity:         SeverityError,
		SecuritySeverity: "8.6",
		CWE:              "CWE-798",
		ShortDescription: "Inline credential material or hidden Trojan Source Unicode control characters in SSH config",
		Help:             "Remove plaintext tokens, private keys, and invisible bidirectional or zero-width Unicode characters from ssh_config; store credentials in XChaCha20-Poly1305 sealed stores or hardware-backed SSH agents.",
	},
}

var ruleByID = func() map[string]RuleDescriptor {
	m := make(map[string]RuleDescriptor, len(ruleCatalog))
	for _, r := range ruleCatalog {
		m[r.ID] = r
	}
	return m
}()

// Rules returns a copy of the SSH security rule catalog.
func Rules() []RuleDescriptor {
	out := make([]RuleDescriptor, len(ruleCatalog))
	copy(out, ruleCatalog)
	return out
}

var (
	shellSubshellRe   = regexp.MustCompile(`(?i)\b(?:ba|z|da|k)?sh\s+-c\b|\bcmd(?:\.exe)?\s+/c\b|\bpowershell(?:\.exe)?\s+-c(?:ommand)?\b`)
	shellMetaRe       = regexp.MustCompile("(?:;|\\|\\||&&|\\||`|\\$\\(|\\$\\{|>[>&]?|<)")
	remoteTokenRe     = regexp.MustCompile(`%[hnrpLlu]`)
	unquotedTokenRe   = regexp.MustCompile(`(?:^|[\s;|&=(])%[hnrp]`)
	sensitiveEnvRe    = regexp.MustCompile(`(?i)(?:^\*$|key|token|secret|pass|pwd|cred|auth|aws_|github_|openai_|anthropic_|hf_|slack_|kubeconfig)`)
	bidiOrZeroWidthRe = regexp.MustCompile("[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]")
)

var weakAlgoSet = map[string]string{
	"ssh-rsa":                         "SHA-1 RSA signatures (RFC 8332 deprecated)",
	"ssh-dss":                         "1024-bit DSA signatures",
	"ssh-rsa-cert-v01@openssh.com":    "SHA-1 RSA certificate signatures",
	"ssh-dss-cert-v01@openssh.com":    "DSA certificate signatures",
	"3des-cbc":                        "64-bit block 3DES-CBC cipher (Sweet32)",
	"aes128-cbc":                      "CBC-mode cipher vulnerable to plaintext recovery",
	"aes192-cbc":                      "CBC-mode cipher vulnerable to plaintext recovery",
	"aes256-cbc":                      "CBC-mode cipher vulnerable to plaintext recovery",
	"arcfour":                         "broken RC4 stream cipher",
	"arcfour128":                      "broken RC4 stream cipher",
	"arcfour256":                      "broken RC4 stream cipher",
	"blowfish-cbc":                    "64-bit block Blowfish-CBC cipher",
	"cast128-cbc":                     "64-bit block CAST128-CBC cipher",
	"hmac-md5":                        "broken MD5 MAC",
	"hmac-md5-96":                     "broken 96-bit MD5 MAC",
	"hmac-md5-etm@openssh.com":        "broken MD5 MAC",
	"hmac-sha1-96":                    "truncated 96-bit SHA-1 MAC",
	"hmac-sha1-96-etm@openssh.com":    "truncated 96-bit SHA-1 MAC",
	"diffie-hellman-group1-sha1":      "1024-bit Oakley Group 1 Logjam KEX",
	"diffie-hellman-group14-sha1":     "SHA-1 Diffie-Hellman KEX",
	"diffie-hellman-group-exchange-sha1": "SHA-1 DH group exchange KEX",
}

// AuditConfig parses and audits an OpenSSH client configuration document.
func AuditConfig(filename string, content string) AuditReport {
	if filename == "" {
		filename = "ssh_config"
	}
	report := AuditReport{
		File:     filename,
		Findings: []Finding{},
	}

	lines := strings.Split(content, "\n")
	currentContext := "global (implicit Host *)"
	isWildcardContext := true
	stanzaCount := 0

	addFinding := func(ruleID string, lineNum int, col int, directive string, msg string) {
		desc := ruleByID[ruleID]
		f := Finding{
			RuleID:      ruleID,
			RuleName:    desc.Name,
			Severity:    desc.Severity,
			CWE:         desc.CWE,
			File:        filename,
			Line:        lineNum,
			Column:      col,
			HostContext: currentContext,
			Directive:   directive,
			Message:     msg,
			Remediation: desc.Help,
		}
		report.Findings = append(report.Findings, f)
		if desc.Severity == SeverityError {
			report.ErrorCount++
		} else if desc.Severity == SeverityWarning {
			report.WarningCount++
		}
	}

	for idx, rawLine := range lines {
		lineNum := idx + 1
		line := strings.TrimRight(rawLine, "\r")

		// Check Unicode BiDi / zero-width smuggling anywhere on the line (including comments).
		if loc := bidiOrZeroWidthRe.FindStringIndex(line); loc != nil {
			// Ignore a leading UTF-8 BOM on line 1 column 0.
			if !(lineNum == 1 && loc[0] == 0 && strings.HasPrefix(line, "\ufeff") && !bidiOrZeroWidthRe.MatchString(strings.TrimPrefix(line, "\ufeff"))) {
				addFinding(
					"SLT010",
					lineNum,
					loc[0]+1,
					"unicode",
					"SSH config line contains hidden Unicode bidirectional override or zero-width characters that can disguise hostnames or options.",
				)
			}
		}

		// Check inline credential exposure without echoing secret values.
		if labels := detectSecretLabels(line); len(labels) > 0 {
			addFinding(
				"SLT010",
				lineNum,
				1,
				"credential",
				fmt.Sprintf("SSH config line matches live credential pattern(s): %s.", strings.Join(labels, ", ")),
			)
		}

		trimmed, colOffset := trimLeadingSpaceWithColumn(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		key, val, ok := splitDirective(trimmed)
		if !ok {
			continue
		}
		lowerKey := strings.ToLower(key)
		cleanVal := stripInlineComment(val)

		switch lowerKey {
		case "host":
			stanzaCount++
			currentContext = "Host " + cleanVal
			isWildcardContext = hostPatternHasBroadWildcard(cleanVal)
		case "match":
			stanzaCount++
			currentContext = "Match " + cleanVal
			isWildcardContext = strings.Contains(strings.ToLower(cleanVal), "all")
			auditMatchDirective(cleanVal, lineNum, colOffset, addFinding)
		case "proxycommand", "knownhostscommand":
			auditCommandDirective(key, cleanVal, lineNum, colOffset, addFinding)
		case "permitlocalcommand":
			if isTruthySSHBool(cleanVal) {
				scopeNote := ""
				if isWildcardContext {
					scopeNote = " inside a wildcard stanza"
				}
				addFinding(
					"SLT002",
					lineNum,
					colOffset,
					key,
					fmt.Sprintf("PermitLocalCommand is enabled%s, permitting local shell execution when connecting.", scopeNote),
				)
			}
		case "localcommand":
			msg := "LocalCommand defines a host command executed on connection setup."
			if remoteTokenRe.MatchString(cleanVal) {
				msg = "LocalCommand interpolates remote SSH expansion tokens (%h/%n/%r/%p), creating a command-injection vector if PermitLocalCommand is enabled."
			}
			addFinding("SLT002", lineNum, colOffset, key, msg)
		case "stricthostkeychecking":
			lv := strings.ToLower(strings.Trim(cleanVal, `"'`))
			if lv == "no" || lv == "off" || lv == "false" {
				addFinding(
					"SLT003",
					lineNum,
					colOffset,
					key,
					fmt.Sprintf("StrictHostKeyChecking is set to %q, disabling MITM host-key verification.", lv),
				)
			}
		case "userknownhostsfile":
			for _, tok := range splitSSHArgs(cleanVal) {
				lt := strings.ToLower(tok)
				if lt == "/dev/null" || lt == "none" || lt == "nul" {
					addFinding(
						"SLT003",
						lineNum,
						colOffset,
						key,
						fmt.Sprintf("UserKnownHostsFile routes host keys to %q, preventing persistent host identity verification.", tok),
					)
					break
				}
			}
		case "forwardagent":
			lv := strings.ToLower(strings.Trim(cleanVal, `"'`))
			if lv == "yes" || lv == "true" {
				if isWildcardContext {
					addFinding(
						"SLT004",
						lineNum,
						colOffset,
						key,
						fmt.Sprintf("ForwardAgent yes in %q exposes the local SSH authentication agent socket to wildcard remote hosts.", currentContext),
					)
				} else {
					addFinding(
						"SLT004",
						lineNum,
						colOffset,
						key,
						fmt.Sprintf("ForwardAgent yes in %q exposes the local SSH agent socket to the remote host; prefer ProxyJump for bastion traversal.", currentContext),
					)
				}
			}
		case "forwardx11trusted":
			if isTruthySSHBool(cleanVal) {
				addFinding(
					"SLT004",
					lineNum,
					colOffset,
					key,
					"ForwardX11Trusted yes grants remote X11 clients full local display keylogging and clipboard access.",
				)
			}
		case "hostkeyalgorithms", "pubkeyacceptedalgorithms", "pubkeyacceptedkeytypes", "ciphers", "macs", "kexalgorithms":
			auditCryptoList(key, cleanVal, lineNum, colOffset, addFinding)
		case "sendenv":
			for _, pattern := range splitSSHArgs(cleanVal) {
				if strings.HasPrefix(pattern, "-") {
					continue
				}
				if sensitiveEnvRe.MatchString(pattern) {
					addFinding(
						"SLT006",
						lineNum,
						colOffset,
						key,
						fmt.Sprintf("SendEnv pattern %q can leak local environment secrets to remote SSH servers.", pattern),
					)
				}
			}
		case "permituserenvironment":
			if isTruthySSHBool(cleanVal) {
				addFinding(
					"SLT006",
					lineNum,
					colOffset,
					key,
					"PermitUserEnvironment yes allows environment overrides during SSH session initialization.",
				)
			}
		case "gatewayports":
			lv := strings.ToLower(strings.Trim(cleanVal, `"'`))
			if lv == "yes" || lv == "true" || lv == "clientspecified" {
				addFinding(
					"SLT007",
					lineNum,
					colOffset,
					key,
					fmt.Sprintf("GatewayPorts %q exposes forwarded SSH ports beyond loopback interfaces.", lv),
				)
			}
		case "localforward", "remoteforward", "dynamicforward":
			auditForwardBind(key, cleanVal, lineNum, colOffset, addFinding)
		case "controlpath":
			cp := strings.Trim(cleanVal, `"'`)
			if strings.HasPrefix(cp, "/tmp/") || strings.HasPrefix(cp, "/var/tmp/") || cp == "/tmp" || cp == "/var/tmp" {
				addFinding(
					"SLT009",
					lineNum,
					colOffset,
					key,
					fmt.Sprintf("ControlPath %q places SSH multiplex sockets in a world-writable temporary directory.", cp),
				)
			}
		}
	}

	report.StanzaCount = stanzaCount
	return report
}

func auditCommandDirective(key string, val string, lineNum int, col int, addFinding func(string, int, int, string, string)) {
	lv := strings.ToLower(strings.TrimSpace(val))
	if lv == "none" || lv == "" {
		return
	}
	hasSubshell := shellSubshellRe.MatchString(val)
	hasMeta := shellMetaRe.MatchString(val)
	hasRemoteToken := remoteTokenRe.MatchString(val)
	hasUnquotedToken := unquotedTokenRe.MatchString(val)

	switch {
	case hasSubshell && hasRemoteToken:
		addFinding(
			"SLT001",
			lineNum,
			col,
			key,
			fmt.Sprintf("%s invokes an explicit shell (%s) while expanding remote SSH tokens, allowing hostname/user command injection.", key, summarizeDirectiveSnippet(val)),
		)
	case hasMeta && hasRemoteToken:
		addFinding(
			"SLT001",
			lineNum,
			col,
			key,
			fmt.Sprintf("%s combines shell control operators with remote SSH expansion tokens (%s), enabling shell command injection.", key, summarizeDirectiveSnippet(val)),
		)
	case hasMeta:
		addFinding(
			"SLT001",
			lineNum,
			col,
			key,
			fmt.Sprintf("%s contains shell pipeline/redirection metacharacters (%s); prefer ProxyJump or a single exec wrapper.", key, summarizeDirectiveSnippet(val)),
		)
	case hasUnquotedToken && hasOptionDashHazard(val):
		addFinding(
			"SLT001",
			lineNum,
			col,
			key,
			fmt.Sprintf("%s passes unquoted %%h/%%p tokens without an end-of-options '--' guard, allowing leading-dash option injection in proxy binaries.", key),
		)
	}
}

func hasOptionDashHazard(val string) bool {
	// Flag common proxy helpers (nc, ncat, socat, ssh, openssl) when %h appears without `--` before it
	// and is not part of a colon-joined argument like %h:%p.
	if strings.Contains(val, "-- ") {
		return false
	}
	fields := splitSSHArgs(val)
	if len(fields) == 0 {
		return false
	}
	bin := strings.ToLower(fields[0])
	if bin == "exec" && len(fields) > 1 {
		bin = strings.ToLower(fields[1])
	}
	for _, arg := range fields {
		if arg == "%h" || arg == "%n" || arg == "%r" {
			if strings.Contains(bin, "ssh") || strings.Contains(bin, "nc") || strings.Contains(bin, "ncat") {
				return true
			}
		}
	}
	return false
}

func auditMatchDirective(val string, lineNum int, col int, addFinding func(string, int, int, string, string)) {
	lower := strings.ToLower(val)
	execIdx := strings.Index(lower, "exec")
	if execIdx < 0 {
		return
	}
	rest := val[execIdx:]
	if remoteTokenRe.MatchString(rest) || shellMetaRe.MatchString(rest) {
		addFinding(
			"SLT008",
			lineNum,
			col,
			"Match",
			"Match exec clause interpolates remote tokens or shell metacharacters that execute locally before SSH authentication.",
		)
	}
}

func auditCryptoList(key string, val string, lineNum int, col int, addFinding func(string, int, int, string, string)) {
	cleaned := strings.TrimLeft(strings.TrimSpace(val), "+-^")
	parts := strings.Split(cleaned, ",")
	// If the user explicitly prefixes '-' to remove weak algorithms, do not flag!
	if strings.HasPrefix(strings.TrimSpace(val), "-") {
		return
	}
	var matched []string
	for _, raw := range parts {
		alg := strings.ToLower(strings.Trim(raw, ` "'`))
		if reason, bad := weakAlgoSet[alg]; bad {
			matched = append(matched, fmt.Sprintf("%s (%s)", alg, reason))
		}
	}
	if len(matched) > 0 {
		addFinding(
			"SLT005",
			lineNum,
			col,
			key,
			fmt.Sprintf("%s enables deprecated cryptographic primitive(s): %s.", key, strings.Join(matched, "; ")),
		)
	}
}

func auditForwardBind(key string, val string, lineNum int, col int, addFinding func(string, int, int, string, string)) {
	args := splitSSHArgs(val)
	if len(args) == 0 {
		return
	}
	first := args[0]
	if strings.HasPrefix(first, "*:") || strings.HasPrefix(first, "0.0.0.0:") || strings.HasPrefix(first, "[::]:") || strings.HasPrefix(first, ":") {
		addFinding(
			"SLT007",
			lineNum,
			col,
			key,
			fmt.Sprintf("%s bind specification %q listens on all interfaces rather than 127.0.0.1/::1.", key, first),
		)
	}
}

func hostPatternHasBroadWildcard(val string) bool {
	for _, pat := range splitSSHArgs(val) {
		if strings.HasPrefix(pat, "!") {
			continue
		}
		if pat == "*" || pat == "*.*" {
			return true
		}
	}
	return false
}

func isTruthySSHBool(val string) bool {
	lv := strings.ToLower(strings.Trim(val, `"' `))
	return lv == "yes" || lv == "true" || lv == "on"
}

func trimLeadingSpaceWithColumn(s string) (string, int) {
	for i, r := range s {
		if r != ' ' && r != '\t' {
			return s[i:], i + 1
		}
	}
	return "", 1
}

func splitDirective(trimmed string) (string, string, bool) {
	i := 0
	for i < len(trimmed) {
		c := trimmed[i]
		if c == ' ' || c == '\t' || c == '=' {
			break
		}
		i++
	}
	if i == 0 {
		return "", "", false
	}
	key := trimmed[:i]
	rest := strings.TrimLeft(trimmed[i:], " \t")
	if strings.HasPrefix(rest, "=") {
		rest = strings.TrimLeft(rest[1:], " \t")
	}
	return key, strings.TrimSpace(rest), true
}

func stripInlineComment(val string) string {
	inSingle := false
	inDouble := false
	for i := 0; i < len(val); i++ {
		switch val[i] {
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case '#':
			if !inSingle && !inDouble && (i == 0 || val[i-1] == ' ' || val[i-1] == '\t') {
				return strings.TrimSpace(val[:i])
			}
		}
	}
	return strings.TrimSpace(val)
}

func splitSSHArgs(val string) []string {
	var args []string
	var cur strings.Builder
	inSingle := false
	inDouble := false
	flush := func() {
		if cur.Len() > 0 {
			args = append(args, cur.String())
			cur.Reset()
		}
	}
	for i := 0; i < len(val); i++ {
		c := val[i]
		switch {
		case c == '\'' && !inDouble:
			inSingle = !inSingle
		case c == '"' && !inSingle:
			inDouble = !inDouble
		case (c == ' ' || c == '\t') && !inSingle && !inDouble:
			flush()
		default:
			cur.WriteByte(c)
		}
	}
	flush()
	return args
}

func summarizeDirectiveSnippet(val string) string {
	// Redact any secrets before including a short command snippet in diagnostic text.
	safe := RedactTerminalOutput(val, RedactOptions{}).RedactedText
	if len(safe) > 72 {
		return safe[:69] + "..."
	}
	return safe
}
