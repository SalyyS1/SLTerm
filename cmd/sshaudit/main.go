// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/SalyyS1/SLTerm/pkg/sshaudit"
)

const cliVersion = "0.23.0"

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	if len(args) == 0 {
		printUsage(stderr)
		return 2
	}

	switch args[0] {
	case "--version", "-v", "version":
		fmt.Fprintf(stdout, "slterm-sshaudit %s\n", cliVersion)
		return 0
	case "--help", "-h", "help":
		printUsage(stdout)
		return 0
	case "rules":
		return runRules(args[1:], stdout, stderr)
	case "redact":
		return runRedact(args[1:], stdin, stdout, stderr)
	case "audit":
		return runAudit(args[1:], stdin, stdout, stderr)
	default:
		// Allow direct file invocation: slterm-sshaudit ~/.ssh/config --sarif out.sarif
		return runAudit(args, stdin, stdout, stderr)
	}
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  slterm-sshaudit audit <ssh_config|-> [--json] [--sarif <file>] [--fail-on error|warning|none]")
	fmt.Fprintln(w, "  slterm-sshaudit redact [file|-] [--json] [--omit-hash]")
	fmt.Fprintln(w, "  slterm-sshaudit rules [--json]")
	fmt.Fprintln(w, "  slterm-sshaudit --version")
}

func runRules(args []string, stdout io.Writer, stderr io.Writer) int {
	fs := flag.NewFlagSet("rules", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "Emit rule catalog as JSON")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	rules := sshaudit.Rules()
	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rules)
		return 0
	}
	for _, r := range rules {
		fmt.Fprintf(stdout, "%-7s [%-7s] (%s) %s\n", r.ID, r.Severity, r.CWE, r.ShortDescription)
	}
	return 0
}

func runRedact(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	fs := flag.NewFlagSet("redact", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "Emit structured JSON redaction summary")
	omitHash := fs.Bool("omit-hash", false, "Omit short SHA-256 correlation suffix from redaction tags")
	if err := fs.Parse(reorderFlagsFirst(args)); err != nil {
		return 2
	}

	target := "-"
	if fs.NArg() > 0 {
		target = fs.Arg(0)
	}
	data, err := readTarget(target, stdin)
	if err != nil {
		fmt.Fprintf(stderr, "error reading %s: %v\n", target, err)
		return 2
	}

	res := sshaudit.RedactTerminalOutput(string(data), sshaudit.RedactOptions{OmitHashSuffix: *omitHash})
	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(res)
		return 0
	}
	_, _ = io.WriteString(stdout, res.RedactedText)
	return 0
}

func runAudit(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	fs := flag.NewFlagSet("audit", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "Emit audit report as JSON")
	sarifOut := fs.String("sarif", "", "Write OASIS SARIF v2.1.0 output to file ('-' for stdout)")
	failOn := fs.String("fail-on", "error", "Exit code 1 threshold: error, warning, or none")
	if err := fs.Parse(reorderFlagsFirst(args)); err != nil {
		return 2
	}

	targets := fs.Args()
	if len(targets) == 0 {
		fmt.Fprintln(stderr, "error: at least one ssh_config path (or '-' for stdin) is required")
		return 2
	}

	reports := make([]sshaudit.AuditReport, 0, len(targets))
	totalErrors := 0
	totalWarnings := 0

	for _, t := range targets {
		data, err := readTarget(t, stdin)
		if err != nil {
			fmt.Fprintf(stderr, "error reading %s: %v\n", t, err)
			return 2
		}
		displayName := t
		if t == "-" {
			displayName = "stdin"
		}
		rep := sshaudit.AuditConfig(displayName, string(data))
		reports = append(reports, rep)
		totalErrors += rep.ErrorCount
		totalWarnings += rep.WarningCount
	}

	if *sarifOut != "" {
		sarifBytes, err := sshaudit.BuildSARIF(reports, cliVersion)
		if err != nil {
			fmt.Fprintf(stderr, "error building SARIF: %v\n", err)
			return 2
		}
		if *sarifOut == "-" {
			_, _ = stdout.Write(append(sarifBytes, '\n'))
			return computeExitCode(*failOn, totalErrors, totalWarnings)
		}
		if err := os.WriteFile(*sarifOut, append(sarifBytes, '\n'), 0o644); err != nil {
			fmt.Fprintf(stderr, "error writing SARIF %s: %v\n", *sarifOut, err)
			return 2
		}
	}

	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if len(reports) == 1 {
			_ = enc.Encode(reports[0])
		} else {
			_ = enc.Encode(reports)
		}
	} else {
		for _, rep := range reports {
			fmt.Fprintf(stdout, "%s: %d error(s), %d warning(s) across %d stanza(s)\n",
				rep.File, rep.ErrorCount, rep.WarningCount, rep.StanzaCount)
			for _, f := range rep.Findings {
				fmt.Fprintf(stdout, "  %s:%d:%d [%s/%s] (%s) %s\n",
					f.File, f.Line, f.Column, f.RuleID, f.Severity, f.HostContext, f.Message)
			}
		}
	}

	return computeExitCode(*failOn, totalErrors, totalWarnings)
}

func computeExitCode(failOn string, errors int, warnings int) int {
	switch strings.ToLower(strings.TrimSpace(failOn)) {
	case "none":
		return 0
	case "warning", "warn":
		if errors > 0 || warnings > 0 {
			return 1
		}
		return 0
	default:
		if errors > 0 {
			return 1
		}
		return 0
	}
}

func readTarget(target string, stdin io.Reader) ([]byte, error) {
	if target == "-" {
		return io.ReadAll(stdin)
	}
	return os.ReadFile(target)
}

// reorderFlagsFirst allows POSIX-style flags placed after positional file arguments.
func reorderFlagsFirst(args []string) []string {
	var flags []string
	var pos []string
	valueFlags := map[string]bool{
		"--sarif":   true,
		"-sarif":    true,
		"--fail-on": true,
		"-fail-on":  true,
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			pos = append(pos, args[i+1:]...)
			break
		}
		if strings.HasPrefix(a, "-") && a != "-" {
			flags = append(flags, a)
			if !strings.Contains(a, "=") && valueFlags[a] && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
		} else {
			pos = append(pos, a)
		}
	}
	return append(flags, pos...)
}
