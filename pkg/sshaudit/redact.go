// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package sshaudit

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// RedactOptions controls how terminal scrollback and log streams are redacted.
type RedactOptions struct {
	// IncludeHashSuffix appends an 8-hex-char SHA-256 prefix (#a1b2c3d4) so
	// operators can correlate repeated occurrences of the same credential across
	// logs without exposing the underlying secret value. Defaults to true unless
	// OmitHashSuffix is set.
	OmitHashSuffix bool
}

// RedactResult contains sanitized output and secret-free summary counters.
type RedactResult struct {
	RedactedText   string         `json:"redacted_text"`
	Modified       bool           `json:"modified"`
	RedactionCount int            `json:"redaction_count"`
	CountsByLabel  map[string]int `json:"counts_by_label"`
}

type secretRule struct {
	label string
	re    *regexp.Regexp
	// submatchMode replaces only capture group 2 while preserving prefix group 1
	// (used for Authorization headers and URL userinfo).
	submatchMode bool
}

// ansiSGRRe matches CSI SGR color/attribute sequences so secrets split or
// wrapped by terminal color escapes are still detected cleanly.
var ansiSGRRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

var secretRules = []secretRule{
	{
		label: "pem-private-key",
		re:    regexp.MustCompile(`(?s)-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----.*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----`),
	},
	{
		label: "pem-private-key",
		re:    regexp.MustCompile(`-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----`),
	},
	{
		label:        "openai-api-key",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,})\b`),
		submatchMode: true,
	},
	{
		label:        "anthropic-api-key",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(sk-ant-api\d{2}-[A-Za-z0-9_-]{20,})\b`),
		submatchMode: true,
	},
	{
		label:        "github-token",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b`),
		submatchMode: true,
	},
	{
		label:        "aws-access-key-id",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))((?:AKIA|ASIA)[0-9A-Z]{16})\b`),
		submatchMode: true,
	},
	{
		label:        "google-api-key",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(AIza[0-9A-Za-z_-]{35})\b`),
		submatchMode: true,
	},
	{
		label:        "huggingface-token",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(hf_[A-Za-z0-9]{34,})\b`),
		submatchMode: true,
	},
	{
		label:        "npm-access-token",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(npm_[A-Za-z0-9]{36})\b`),
		submatchMode: true,
	},
	{
		label:        "slack-token",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(xox[baprs]-[0-9A-Za-z-]{10,})\b`),
		submatchMode: true,
	},
	{
		label:        "stripe-secret-key",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))((?:sk|rk)_live_[0-9A-Za-z]{24,})\b`),
		submatchMode: true,
	},
	{
		label:        "jwt-bearer-token",
		re:           regexp.MustCompile(`((?:^|\x1b\[[0-9;]*m|[^A-Za-z0-9_]))(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b`),
		submatchMode: true,
	},
	{
		label:        "url-userinfo-secret",
		re:           regexp.MustCompile(`((?:https?|ssh|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|amqp)://[^/\s:@]+:)([^/\s@]{4,})(@)`),
		submatchMode: true,
	},
	{
		label:        "authorization-bearer",
		re:           regexp.MustCompile(`(?i)(authorization\s*[:=]\s*bearer\s+)([A-Za-z0-9._~+/=-]{16,})`),
		submatchMode: true,
	},
}

func formatRedactionTag(label string, secret string, omitHash bool) string {
	if omitHash {
		return fmt.Sprintf("[REDACTED:%s]", label)
	}
	sum := sha256.Sum256([]byte("slterm-redact-v1:" + label + ":" + secret))
	short := hex.EncodeToString(sum[:4])
	return fmt.Sprintf("[REDACTED:%s#%s]", label, short)
}

// RedactTerminalOutput scrubs live credentials from terminal scrollback, logs,
// and command transcripts while preserving surrounding text and ANSI SGR styling.
func RedactTerminalOutput(input string, opts RedactOptions) RedactResult {
	counts := make(map[string]int)
	if input == "" {
		return RedactResult{
			RedactedText:  "",
			CountsByLabel: counts,
		}
	}

	out := input
	total := 0

	applyPass := func(text string) string {
		cur := text
		for _, rule := range secretRules {
			if rule.submatchMode {
				cur = rule.re.ReplaceAllStringFunc(cur, func(match string) string {
					sub := rule.re.FindStringSubmatch(match)
					if len(sub) < 3 {
						return match
					}
					secretVal := sub[2]
					if strings.HasPrefix(secretVal, "[REDACTED:") {
						return match
					}
					counts[rule.label]++
					total++
					tag := formatRedactionTag(rule.label, secretVal, opts.OmitHashSuffix)
					suffix := ""
					if len(sub) >= 4 {
						suffix = sub[3]
					}
					return sub[1] + tag + suffix
				})
				continue
			}

			cur = rule.re.ReplaceAllStringFunc(cur, func(match string) string {
				if strings.HasPrefix(match, "[REDACTED:") {
					return match
				}
				counts[rule.label]++
				total++
				return formatRedactionTag(rule.label, match, opts.OmitHashSuffix)
			})
		}
		return cur
	}

	out = applyPass(out)

	// Second check: if ANSI SGR sequences split a credential mid-token (for example
	// syntax-highlighted terminal output), strip SGR sequences on lines that only
	// match after SGR removal so no highlighted secret slips through.
	if strings.Contains(out, "\x1b[") {
		plainProbe := ansiSGRRe.ReplaceAllString(out, "")
		if len(detectSecretLabels(plainProbe)) > 0 {
			lines := strings.Split(out, "\n")
			for i, line := range lines {
				if strings.Contains(line, "\x1b[") {
					stripped := ansiSGRRe.ReplaceAllString(line, "")
					if len(detectSecretLabels(stripped)) > 0 {
						lines[i] = applyPass(stripped)
					}
				}
			}
			out = strings.Join(lines, "\n")
		}
	}

	return RedactResult{
		RedactedText:   out,
		Modified:       total > 0,
		RedactionCount: total,
		CountsByLabel:  counts,
	}
}

func detectSecretLabels(text string) []string {
	if text == "" {
		return nil
	}
	seen := make(map[string]struct{})
	plain := text
	if strings.Contains(plain, "\x1b[") {
		plain = ansiSGRRe.ReplaceAllString(plain, "")
	}
	for _, rule := range secretRules {
		if rule.submatchMode {
			matches := rule.re.FindAllStringSubmatch(plain, -1)
			for _, sub := range matches {
				if len(sub) >= 3 && !strings.HasPrefix(sub[2], "[REDACTED:") {
					seen[rule.label] = struct{}{}
				}
			}
			continue
		}
		for _, m := range rule.re.FindAllString(plain, -1) {
			if !strings.HasPrefix(m, "[REDACTED:") {
				seen[rule.label] = struct{}{}
			}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	labels := make([]string, 0, len(seen))
	for k := range seen {
		labels = append(labels, k)
	}
	sort.Strings(labels)
	return labels
}
