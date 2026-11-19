// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package cmdguard

import (
	"bytes"
	"encoding/base64"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
)

// RedirectOp describes a shell I/O redirection attached to a command segment.
type RedirectOp struct {
	Operator string `json:"operator"`
	Target   string `json:"target"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
}

// CommandSegment represents a single simple command inside a shell pipeline or list.
type CommandSegment struct {
	EnvVars         []string     `json:"env_vars,omitempty"`
	Argv            []string     `json:"argv"`
	RawArgs         []string     `json:"raw_args,omitempty"`
	Redirects       []RedirectOp `json:"redirects,omitempty"`
	Substitutions   []SubScript  `json:"substitutions,omitempty"`
	ConnectorToNext string       `json:"connector_to_next,omitempty"`
	Elevated        bool         `json:"elevated,omitempty"`
	Line            int          `json:"line"`
	Column          int          `json:"column"`
}

// SubScript captures an embedded command substitution, process substitution, or subshell.
type SubScript struct {
	Kind   string `json:"kind"`
	Script string `json:"script"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

type lexTokenKind int

const (
	tokWord lexTokenKind = iota
	tokOperator
	tokRedirect
	tokSubshell
)

type lexToken struct {
	kind   lexTokenKind
	value  string
	raw    string
	subs   []SubScript
	line   int
	column int
}

// ParseShellSegments tokenizes a POSIX/Bash/PowerShell command buffer into
// ordered CommandSegment nodes while preserving source line and column offsets
// and extracting nested $(...), `...`, <(...), >(...), and (...) scripts.
func ParseShellSegments(script string) []CommandSegment {
	tokens := tokenizeShell(script)
	if len(tokens) == 0 {
		return nil
	}

	var segments []CommandSegment
	var cur CommandSegment
	curActive := false

	flush := func(connector string) {
		if !curActive {
			return
		}
		if len(cur.Argv) > 0 || len(cur.EnvVars) > 0 || len(cur.Redirects) > 0 || len(cur.Substitutions) > 0 {
			cur.ConnectorToNext = connector
			segments = append(segments, cur)
		}
		cur = CommandSegment{}
		curActive = false
	}

	for i := 0; i < len(tokens); i++ {
		tok := tokens[i]
		switch tok.kind {
		case tokOperator:
			conn := tok.value
			if conn == "\n" {
				conn = ";"
			}
			flush(conn)
		case tokSubshell:
			if !curActive {
				cur.Line = tok.line
				cur.Column = tok.column
				curActive = true
			}
			cur.Substitutions = append(cur.Substitutions, SubScript{
				Kind:   "subshell",
				Script: tok.value,
				Line:   tok.line,
				Column: tok.column,
			})
		case tokRedirect:
			if !curActive {
				cur.Line = tok.line
				cur.Column = tok.column
				curActive = true
			}
			target := ""
			if i+1 < len(tokens) && tokens[i+1].kind == tokWord {
				i++
				target = tokens[i].value
				cur.Substitutions = append(cur.Substitutions, tokens[i].subs...)
			}
			cur.Redirects = append(cur.Redirects, RedirectOp{
				Operator: tok.value,
				Target:   target,
				Line:     tok.line,
				Column:   tok.column,
			})
		case tokWord:
			if !curActive {
				cur.Line = tok.line
				cur.Column = tok.column
				curActive = true
			}
			cur.Substitutions = append(cur.Substitutions, tok.subs...)
			if len(cur.Argv) == 0 && isEnvAssignment(tok.value) {
				cur.EnvVars = append(cur.EnvVars, tok.value)
				continue
			}
			cur.Argv = append(cur.Argv, tok.value)
			cur.RawArgs = append(cur.RawArgs, tok.raw)
		}
	}
	flush("")

	for idx := range segments {
		unwrapCommandPrefixes(&segments[idx])
	}
	return segments
}

func isEnvAssignment(word string) bool {
	eq := strings.IndexByte(word, '=')
	if eq <= 0 {
		return false
	}
	name := word[:eq]
	for i := 0; i < len(name); i++ {
		c := name[i]
		if i == 0 {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') {
				return false
			}
		} else {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
				return false
			}
		}
	}
	return true
}

// unwrapCommandPrefixes strips transparent execution wrappers (sudo, doas, env,
// command, builtin, nohup, nice, time, timeout, stdbuf, setsid) so downstream
// analyzers inspect the effective target binary while tracking privilege elevation.
func unwrapCommandPrefixes(seg *CommandSegment) {
	for len(seg.Argv) > 0 {
		head := baseCommandName(seg.Argv[0])
		switch head {
		case "sudo", "doas":
			seg.Elevated = true
			idx := 1
			for idx < len(seg.Argv) {
				arg := seg.Argv[idx]
				if arg == "--" {
					idx++
					break
				}
				if strings.HasPrefix(arg, "-") {
					// Flags on sudo that consume a separate argument
					if (arg == "-u" || arg == "-g" || arg == "-C" || arg == "-D" || arg == "-h" || arg == "-p" || arg == "-r" || arg == "-t" || arg == "-U") && idx+1 < len(seg.Argv) {
						idx += 2
						continue
					}
					idx++
					continue
				}
				if isEnvAssignment(arg) {
					seg.EnvVars = append(seg.EnvVars, arg)
					idx++
					continue
				}
				break
			}
			seg.Argv = seg.Argv[idx:]
			if idx <= len(seg.RawArgs) {
				seg.RawArgs = seg.RawArgs[idx:]
			}
		case "env":
			idx := 1
			for idx < len(seg.Argv) {
				arg := seg.Argv[idx]
				if arg == "--" {
					idx++
					break
				}
				if strings.HasPrefix(arg, "-") {
					if (arg == "-u" || arg == "-C" || arg == "-S") && idx+1 < len(seg.Argv) {
						idx += 2
						continue
					}
					idx++
					continue
				}
				if isEnvAssignment(arg) {
					seg.EnvVars = append(seg.EnvVars, arg)
					idx++
					continue
				}
				break
			}
			// Keep standalone "env" (credential dump check) when no inner command follows.
			if idx >= len(seg.Argv) {
				return
			}
			seg.Argv = seg.Argv[idx:]
			if idx <= len(seg.RawArgs) {
				seg.RawArgs = seg.RawArgs[idx:]
			}
		case "command", "builtin", "nohup", "setsid", "time":
			idx := 1
			for idx < len(seg.Argv) && strings.HasPrefix(seg.Argv[idx], "-") {
				if seg.Argv[idx] == "--" {
					idx++
					break
				}
				// "command -v foo" is a lookup, not execution.
				if head == "command" && (seg.Argv[idx] == "-v" || seg.Argv[idx] == "-V") {
					return
				}
				idx++
			}
			if idx >= len(seg.Argv) {
				return
			}
			seg.Argv = seg.Argv[idx:]
			if idx <= len(seg.RawArgs) {
				seg.RawArgs = seg.RawArgs[idx:]
			}
		case "nice":
			idx := 1
			if idx < len(seg.Argv) && (seg.Argv[idx] == "-n" || seg.Argv[idx] == "--adjustment") && idx+1 < len(seg.Argv) {
				idx += 2
			} else if idx < len(seg.Argv) && strings.HasPrefix(seg.Argv[idx], "-") {
				idx++
			}
			if idx >= len(seg.Argv) {
				return
			}
			seg.Argv = seg.Argv[idx:]
			if idx <= len(seg.RawArgs) {
				seg.RawArgs = seg.RawArgs[idx:]
			}
		case "timeout":
			idx := 1
			for idx < len(seg.Argv) && strings.HasPrefix(seg.Argv[idx], "-") {
				if (seg.Argv[idx] == "-k" || seg.Argv[idx] == "-s") && idx+1 < len(seg.Argv) {
					idx += 2
					continue
				}
				idx++
			}
			// Skip duration argument
			if idx < len(seg.Argv) {
				idx++
			}
			if idx >= len(seg.Argv) {
				return
			}
			seg.Argv = seg.Argv[idx:]
			if idx <= len(seg.RawArgs) {
				seg.RawArgs = seg.RawArgs[idx:]
			}
		case "busybox":
			if len(seg.Argv) < 2 || strings.HasPrefix(seg.Argv[1], "-") {
				return
			}
			seg.Argv = seg.Argv[1:]
			if len(seg.RawArgs) >= 1 {
				seg.RawArgs = seg.RawArgs[1:]
			}
		default:
			return
		}
	}
}

func baseCommandName(cmd string) string {
	cleaned := strings.TrimSpace(cmd)
	cleaned = strings.ReplaceAll(cleaned, "\\", "/")
	if slash := strings.LastIndexByte(cleaned, '/'); slash >= 0 {
		cleaned = cleaned[slash+1:]
	}
	cleaned = strings.TrimSuffix(strings.ToLower(cleaned), ".exe")
	return cleaned
}

func tokenizeShell(input string) []lexToken {
	var out []lexToken
	line := 1
	col := 1
	i := 0
	n := len(input)

	advance := func(step int) {
		for k := 0; k < step && i < n; k++ {
			if input[i] == '\n' {
				line++
				col = 1
			} else {
				col++
			}
			i++
		}
	}

	for i < n {
		ch := input[i]

		// Handle backslash-newline line continuations outside words.
		if ch == '\\' && i+1 < n && input[i+1] == '\n' {
			advance(2)
			continue
		}
		if ch == '\\' && i+2 < n && input[i+1] == '\r' && input[i+2] == '\n' {
			advance(3)
			continue
		}

		// Whitespace
		if ch == ' ' || ch == '\t' || ch == '\r' {
			advance(1)
			continue
		}
		if ch == '\n' {
			out = append(out, lexToken{kind: tokOperator, value: "\n", raw: "\n", line: line, column: col})
			advance(1)
			continue
		}

		// Comment starting at token boundary
		if ch == '#' {
			for i < n && input[i] != '\n' {
				advance(1)
			}
			continue
		}

		startLine, startCol := line, col

		// Process substitution <(...) or >(...)
		if (ch == '<' || ch == '>') && i+1 < n && input[i+1] == '(' {
			kind := "procsub_in"
			if ch == '>' {
				kind = "procsub_out"
			}
			advance(2)
			body, consumed := extractBalancedParen(input[i:])
			advance(consumed)
			out = append(out, lexToken{
				kind:   tokWord,
				value:  string(ch) + "(" + body + ")",
				raw:    string(ch) + "(" + body + ")",
				subs:   []SubScript{{Kind: kind, Script: body, Line: startLine, Column: startCol}},
				line:   startLine,
				column: startCol,
			})
			continue
		}

		// Subshell (...)
		if ch == '(' {
			advance(1)
			body, consumed := extractBalancedParen(input[i:])
			advance(consumed)
			out = append(out, lexToken{
				kind:   tokSubshell,
				value:  body,
				raw:    "(" + body + ")",
				line:   startLine,
				column: startCol,
			})
			continue
		}

		// Operators: &&, ||, |&, |, ;, &
		if ch == '&' && i+1 < n && input[i+1] == '&' {
			advance(2)
			out = append(out, lexToken{kind: tokOperator, value: "&&", raw: "&&", line: startLine, column: startCol})
			continue
		}
		if ch == '|' && i+1 < n && input[i+1] == '|' {
			advance(2)
			out = append(out, lexToken{kind: tokOperator, value: "||", raw: "||", line: startLine, column: startCol})
			continue
		}
		if ch == '|' && i+1 < n && input[i+1] == '&' {
			advance(2)
			out = append(out, lexToken{kind: tokOperator, value: "|&", raw: "|&", line: startLine, column: startCol})
			continue
		}
		if ch == '|' || ch == ';' {
			advance(1)
			out = append(out, lexToken{kind: tokOperator, value: string(ch), raw: string(ch), line: startLine, column: startCol})
			continue
		}
		if ch == '&' && !(i+1 < n && input[i+1] == '>') {
			advance(1)
			out = append(out, lexToken{kind: tokOperator, value: "&", raw: "&", line: startLine, column: startCol})
			continue
		}

		// Redirections with optional fd prefix (e.g. 2>, 1>&2, &>, >>, <<<, <>)
		if redirOp, redirLen := matchRedirection(input[i:]); redirLen > 0 {
			advance(redirLen)
			out = append(out, lexToken{kind: tokRedirect, value: redirOp, raw: redirOp, line: startLine, column: startCol})
			continue
		}

		// Word token
		var valBuf strings.Builder
		var rawBuf strings.Builder
		var subs []SubScript

		for i < n {
			c := input[i]
			if c == '\\' && i+1 < n && input[i+1] == '\n' {
				advance(2)
				continue
			}
			if c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '|' || c == ';' || c == '(' || c == ')' {
				break
			}
			if c == '&' || c == '<' || c == '>' {
				break
			}

			// ANSI-C quoting $'...'
			if c == '$' && i+1 < n && input[i+1] == '\'' {
				rawBuf.WriteString("$'")
				advance(2)
				for i < n && input[i] != '\'' {
					if input[i] == '\\' && i+1 < n {
						rawBuf.WriteByte(input[i])
						rawBuf.WriteByte(input[i+1])
						decoded, step := decodeAnsiCEscape(input[i+1:])
						valBuf.WriteString(decoded)
						advance(1 + step)
						continue
					}
					rawBuf.WriteByte(input[i])
					valBuf.WriteByte(input[i])
					advance(1)
				}
				if i < n && input[i] == '\'' {
					rawBuf.WriteByte('\'')
					advance(1)
				}
				continue
			}

			// Single quotes
			if c == '\'' {
				rawBuf.WriteByte('\'')
				advance(1)
				for i < n && input[i] != '\'' {
					rawBuf.WriteByte(input[i])
					valBuf.WriteByte(input[i])
					advance(1)
				}
				if i < n && input[i] == '\'' {
					rawBuf.WriteByte('\'')
					advance(1)
				}
				continue
			}

			// Double quotes
			if c == '"' {
				rawBuf.WriteByte('"')
				advance(1)
				for i < n && input[i] != '"' {
					if input[i] == '\\' && i+1 < n {
						rawBuf.WriteByte('\\')
						rawBuf.WriteByte(input[i+1])
						valBuf.WriteByte(input[i+1])
						advance(2)
						continue
					}
					if input[i] == '$' && i+1 < n && input[i+1] == '(' {
						subLine, subCol := line, col
						advance(2)
						body, consumed := extractBalancedParen(input[i:])
						advance(consumed)
						subs = append(subs, SubScript{Kind: "cmdsub", Script: body, Line: subLine, Column: subCol})
						expr := "$(" + body + ")"
						rawBuf.WriteString(expr)
						valBuf.WriteString(expr)
						continue
					}
					if input[i] == '`' {
						subLine, subCol := line, col
						advance(1)
						body, consumed := extractBacktick(input[i:])
						advance(consumed)
						subs = append(subs, SubScript{Kind: "backtick", Script: body, Line: subLine, Column: subCol})
						expr := "`" + body + "`"
						rawBuf.WriteString(expr)
						valBuf.WriteString(expr)
						continue
					}
					rawBuf.WriteByte(input[i])
					valBuf.WriteByte(input[i])
					advance(1)
				}
				if i < n && input[i] == '"' {
					rawBuf.WriteByte('"')
					advance(1)
				}
				continue
			}

			// Unquoted $(...)
			if c == '$' && i+1 < n && input[i+1] == '(' {
				subLine, subCol := line, col
				advance(2)
				body, consumed := extractBalancedParen(input[i:])
				advance(consumed)
				subs = append(subs, SubScript{Kind: "cmdsub", Script: body, Line: subLine, Column: subCol})
				expr := "$(" + body + ")"
				rawBuf.WriteString(expr)
				valBuf.WriteString(expr)
				continue
			}

			// Unquoted backticks `...`
			if c == '`' {
				subLine, subCol := line, col
				advance(1)
				body, consumed := extractBacktick(input[i:])
				advance(consumed)
				subs = append(subs, SubScript{Kind: "backtick", Script: body, Line: subLine, Column: subCol})
				expr := "`" + body + "`"
				rawBuf.WriteString(expr)
				valBuf.WriteString(expr)
				continue
			}

			// Backslash escape outside quotes
			if c == '\\' && i+1 < n {
				rawBuf.WriteByte('\\')
				rawBuf.WriteByte(input[i+1])
				valBuf.WriteByte(input[i+1])
				advance(2)
				continue
			}

			rawBuf.WriteByte(c)
			valBuf.WriteByte(c)
			advance(1)
		}

		out = append(out, lexToken{
			kind:   tokWord,
			value:  valBuf.String(),
			raw:    rawBuf.String(),
			subs:   subs,
			line:   startLine,
			column: startCol,
		})
	}

	return out
}

func matchRedirection(rest string) (string, int) {
	if len(rest) == 0 {
		return "", 0
	}
	idx := 0
	if rest[0] >= '0' && rest[0] <= '9' {
		idx = 1
	}
	if idx >= len(rest) {
		return "", 0
	}
	rem := rest[idx:]
	prefixes := []string{"<<<", "&>>", "&>", ">>", ">|", ">&", "<>", "<&", "<<", ">", "<"}
	for _, p := range prefixes {
		if strings.HasPrefix(rem, p) {
			// Ensure "<(" and ">(" are left to process-substitution handling
			if (p == "<" || p == ">") && len(rem) > 1 && rem[1] == '(' {
				return "", 0
			}
			total := idx + len(p)
			// Handle 2>&1 or >&2 inline fd target without separate word
			if (p == ">&" || p == "<&") && total < len(rest) && rest[total] >= '0' && rest[total] <= '9' {
				total++
			}
			return rest[:total], total
		}
	}
	return "", 0
}

func extractBalancedParen(s string) (string, int) {
	depth := 1
	i := 0
	inSingle := false
	inDouble := false
	for i < len(s) {
		c := s[i]
		if c == '\\' && !inSingle && i+1 < len(s) {
			i += 2
			continue
		}
		if c == '\'' && !inDouble {
			inSingle = !inSingle
			i++
			continue
		}
		if c == '"' && !inSingle {
			inDouble = !inDouble
			i++
			continue
		}
		if !inSingle && !inDouble {
			if c == '(' {
				depth++
			} else if c == ')' {
				depth--
				if depth == 0 {
					return s[:i], i + 1
				}
			}
		}
		i++
	}
	return s, len(s)
}

func extractBacktick(s string) (string, int) {
	i := 0
	for i < len(s) {
		if s[i] == '\\' && i+1 < len(s) {
			i += 2
			continue
		}
		if s[i] == '`' {
			return s[:i], i + 1
		}
		i++
	}
	return s, len(s)
}

func decodeAnsiCEscape(s string) (string, int) {
	if len(s) == 0 {
		return "", 0
	}
	switch s[0] {
	case 'n':
		return "\n", 1
	case 'r':
		return "\r", 1
	case 't':
		return "\t", 1
	case 'x':
		if len(s) >= 3 {
			hi := hexVal(s[1])
			lo := hexVal(s[2])
			if hi >= 0 && lo >= 0 {
				return string(byte(hi*16 + lo)), 3
			}
		}
	}
	return string(s[0]), 1
}

func hexVal(b byte) int {
	switch {
	case b >= '0' && b <= '9':
		return int(b - '0')
	case b >= 'a' && b <= 'f':
		return int(b-'a') + 10
	case b >= 'A' && b <= 'F':
		return int(b-'A') + 10
	default:
		return -1
	}
}

// DecodeBase64Command attempts to decode a standard or URL-safe Base64 token
// (either UTF-8 text or PowerShell UTF-16LE -EncodedCommand text) into a
// human-readable shell payload. Returns ("", false) if not valid printable text.
func DecodeBase64Command(encoded string, allowUTF16LE bool) (string, bool) {
	trimmed := strings.TrimSpace(encoded)
	if len(trimmed) < 8 || len(trimmed) > 16384 {
		return "", false
	}
	padded := trimmed
	if rem := len(padded) % 4; rem != 0 {
		padded += strings.Repeat("=", 4-rem)
	}
	raw, err := base64.StdEncoding.DecodeString(padded)
	if err != nil {
		raw, err = base64.URLEncoding.DecodeString(padded)
		if err != nil {
			return "", false
		}
	}
	if len(raw) == 0 {
		return "", false
	}

	// PowerShell -EncodedCommand uses UTF-16LE (often containing alternating NUL bytes for ASCII).
	if allowUTF16LE && len(raw)%2 == 0 && bytes.Count(raw, []byte{0}) >= len(raw)/4 {
		u16 := make([]uint16, len(raw)/2)
		for i := 0; i < len(u16); i++ {
			u16[i] = uint16(raw[2*i]) | uint16(raw[2*i+1])<<8
		}
		decoded := string(utf16.Decode(u16))
		if isPrintableScript(decoded) {
			return strings.TrimSpace(decoded), true
		}
	}

	if utf8.Valid(raw) {
		decoded := string(raw)
		if isPrintableScript(decoded) {
			return strings.TrimSpace(decoded), true
		}
	}
	return "", false
}

func isPrintableScript(s string) bool {
	if strings.TrimSpace(s) == "" {
		return false
	}
	printable := 0
	total := 0
	for _, r := range s {
		total++
		if r == '\n' || r == '\r' || r == '\t' || (r >= 0x20 && r != 0x7f && unicode.IsPrint(r)) {
			printable++
		}
	}
	return total > 0 && printable*100/total >= 90
}
