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

	"github.com/SalyyS1/SLTerm/pkg/cmdguard"
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
		fmt.Fprintf(stdout, "slterm-cmdguard %s\n", cliVersion)
		return 0
	case "--help", "-h", "help":
		printUsage(stdout)
		return 0
	case "rules":
		return runRules(args[1:], stdout, stderr)
	case "check", "audit":
		return runCheck(args[1:], stdin, stdout, stderr)
	default:
		return runCheck(args, stdin, stdout, stderr)
	}
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  slterm-cmdguard check [<script_file|->] [--cmd \"<command>\"] [--policy strict|balanced|permissive] [--json] [--sarif <file>] [--fail-on error|warning|none]")
	fmt.Fprintln(w, "  slterm-cmdguard rules [--json]")
	fmt.Fprintln(w, "  slterm-cmdguard --version")
}

func runRules(args []string, stdout io.Writer, stderr io.Writer) int {
	fs := flag.NewFlagSet("rules", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "Emit rule catalog as JSON")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	rules := cmdguard.Rules()
	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rules)
		return 0
	}
	for _, r := range rules {
		fmt.Fprintf(stdout, "%-7s [%-7s] (%s, risk=%d) %s\n", r.ID, r.Severity, r.CWE, r.BaseRisk, r.ShortDescription)
	}
	return 0
}

func runCheck(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	fs := flag.NewFlagSet("check", flag.ContinueOnError)
	fs.SetOutput(stderr)
	inlineCmd := fs.String("cmd", "", "Evaluate an inline shell command string")
	policy := fs.String("policy", "balanced", "Enforcement policy: strict, balanced, or permissive")
	asJSON := fs.Bool("json", false, "Emit analysis report as JSON")
	sarifOut := fs.String("sarif", "", "Write OASIS SARIF v2.1.0 output to file ('-' for stdout)")
	failOn := fs.String("fail-on", "error", "Exit code 1 threshold: error, warning, or none")
	if err := fs.Parse(reorderFlagsFirst(args)); err != nil {
		return 2
	}

	opts := cmdguard.AnalyzeOptions{Policy: cmdguard.PolicyMode(*policy)}
	var reports []cmdguard.AnalysisReport
	totalErrors := 0
	totalWarnings := 0

	if *inlineCmd != "" {
		rep := cmdguard.AnalyzeScript("inline", *inlineCmd, opts)
		reports = append(reports, rep)
		totalErrors += rep.ErrorCount
		totalWarnings += rep.WarningCount
	}

	targets := fs.Args()
	if *inlineCmd == "" && len(targets) == 0 {
		fmt.Fprintln(stderr, "error: provide --cmd \"<command>\" or at least one script path ('-' for stdin)")
		return 2
	}

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
		rep := cmdguard.AnalyzeScript(displayName, string(data), opts)
		reports = append(reports, rep)
		totalErrors += rep.ErrorCount
		totalWarnings += rep.WarningCount
	}

	if *sarifOut != "" {
		sarifBytes, err := cmdguard.BuildSARIF(reports, cliVersion)
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
			fmt.Fprintf(stdout, "%s: verdict=%s risk=%d/100 (%d error(s), %d warning(s) across %d segment(s))\n",
				rep.Source, rep.Verdict, rep.RiskScore, rep.ErrorCount, rep.WarningCount, rep.SegmentCount)
			for _, f := range rep.Findings {
				layerTag := ""
				if f.DecodedLayer != "" {
					layerTag = fmt.Sprintf(" [layer:%s]", f.DecodedLayer)
				}
				fmt.Fprintf(stdout, "  %s:%d:%d [%s/%s %s]%s %s\n",
					f.Source, f.Line, f.Column, f.RuleID, f.Severity, f.CWE, layerTag, f.Message)
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

func reorderFlagsFirst(args []string) []string {
	var flags []string
	var pos []string
	valueFlags := map[string]bool{
		"--cmd":     true,
		"-cmd":      true,
		"--policy":  true,
		"-policy":   true,
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
