// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package cmdguard provides a lexical and AST-aware shell command and AI-agent
// execution risk firewall. It unwraps command wrappers (sudo, env, timeout,
// sh -c, eval, subshells, PowerShell -EncodedCommand, and Base64 decode pipes)
// and evaluates commands against rules SLT011 through SLT016 with OASIS SARIF
// v2.1.0 export.
package cmdguard

import (
	"fmt"
	"regexp"
	"strings"
)

// Severity classifies a command execution finding.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
	SeverityNote    Severity = "note"
)

// PolicyMode controls how findings map onto execution gate verdicts.
type PolicyMode string

const (
	PolicyStrict     PolicyMode = "strict"
	PolicyBalanced   PolicyMode = "balanced"
	PolicyPermissive PolicyMode = "permissive"
)

// ActionVerdict represents the recommended firewall enforcement action.
type ActionVerdict string

const (
	VerdictAllow           ActionVerdict = "allow"
	VerdictWarn            ActionVerdict = "warn"
	VerdictRequireApproval ActionVerdict = "require_approval"
	VerdictBlock           ActionVerdict = "block"
)

// RuleDescriptor documents a static command security rule in the SLTerm catalog.
type RuleDescriptor struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Severity         Severity `json:"severity"`
	SecuritySeverity string   `json:"security_severity"`
	CWE              string   `json:"cwe"`
	BaseRisk         int      `json:"base_risk"`
	ShortDescription string   `json:"short_description"`
	Help             string   `json:"help"`
}

// Finding represents a single risky command construct located in a script or prompt.
type Finding struct {
	RuleID       string   `json:"rule_id"`
	RuleName     string   `json:"rule_name"`
	Severity     Severity `json:"severity"`
	CWE          string   `json:"cwe"`
	Source       string   `json:"source"`
	Line         int      `json:"line"`
	Column       int      `json:"column"`
	Command      string   `json:"command"`
	DecodedLayer string   `json:"decoded_layer,omitempty"`
	RiskPoints   int      `json:"risk_points"`
	Message      string   `json:"message"`
	Remediation  string   `json:"remediation"`
}

// AnalyzeOptions configures command firewall evaluation.
type AnalyzeOptions struct {
	Policy PolicyMode
}

// AnalysisReport aggregates findings, risk score, decoded layers, and gate verdict.
type AnalysisReport struct {
	Source            string        `json:"source"`
	Policy            PolicyMode    `json:"policy"`
	Verdict           ActionVerdict `json:"verdict"`
	RiskScore         int           `json:"risk_score"`
	SegmentCount      int           `json:"segment_count"`
	ErrorCount        int           `json:"error_count"`
	WarningCount      int           `json:"warning_count"`
	UnwrappedCommands []string      `json:"unwrapped_commands,omitempty"`
	Findings          []Finding     `json:"findings"`
}

const maxRecursionDepth = 4

var ruleCatalog = []RuleDescriptor{
	{
		ID:               "SLT011",
		Name:             "DestructiveFilesystemOrDiskWipe",
		Severity:         SeverityError,
		SecuritySeverity: "9.8",
		CWE:              "CWE-78",
		BaseRisk:         95,
		ShortDescription: "Recursive root, home, or block-device destruction or shell fork bomb",
		Help:             "Scope recursive deletions to explicit relative build directories, validate non-empty variables (${DIR:?}) before appending /*, and never write directly to raw block devices or invoke --no-preserve-root.",
	},
	{
		ID:               "SLT012",
		Name:             "NetworkFetchOrEncodedPipeToShell",
		Severity:         SeverityError,
		SecuritySeverity: "9.1",
		CWE:              "CWE-829",
		BaseRisk:         88,
		ShortDescription: "Untrusted network payload or obfuscated Base64 stream piped directly into an interpreter",
		Help:             "Download remote scripts to a temporary file, verify SHA-256 checksums or cryptographic signatures, inspect contents, and execute without piping curl/wget or Base64 decoders directly into sh, bash, python, or Invoke-Expression.",
	},
	{
		ID:               "SLT013",
		Name:             "ReverseShellAndSocketPivot",
		Severity:         SeverityError,
		SecuritySeverity: "9.6",
		CWE:              "CWE-506",
		BaseRisk:         96,
		ShortDescription: "Interactive reverse shell or raw TCP/UDP socket stdio bind",
		Help:             "Block interactive shell bindings over /dev/tcp, netcat -e/-c, mkfifo socket relays, socat EXEC/SYSTEM, and inline python/perl/php/ruby socket-dup2 payloads; use audited SSH sessions instead.",
	},
	{
		ID:               "SLT014",
		Name:             "CredentialAndMetadataExfiltration",
		Severity:         SeverityError,
		SecuritySeverity: "8.9",
		CWE:              "CWE-200",
		BaseRisk:         86,
		ShortDescription: "Sensitive credential files, secret environment variables, or cloud IMDS tokens sent to an external sink",
		Help:             "Never transmit SSH keys, cloud credential files, .env secrets, process environment dumps, or 169.254.169.254 IMDS metadata responses to outbound HTTP, DNS, SCP, or raw socket endpoints.",
	},
	{
		ID:               "SLT015",
		Name:             "PrivilegeEscalationAndPersistenceTamper",
		Severity:         SeverityWarning,
		SecuritySeverity: "8.4",
		CWE:              "CWE-269",
		BaseRisk:         78,
		ShortDescription: "SUID bit escalation, sudoers/authorized_keys/LD_PRELOAD persistence, or privileged container host escape",
		Help:             "Avoid setting SUID/SGID bits, mutating /etc/sudoers or ~/.ssh/authorized_keys, injecting LD_PRELOAD, or launching containers with --privileged, /var/run/docker.sock, or host root volume mounts.",
	},
	{
		ID:               "SLT016",
		Name:             "DestructiveGitAndGuardrailBypass",
		Severity:         SeverityWarning,
		SecuritySeverity: "7.2",
		CWE:              "CWE-284",
		BaseRisk:         62,
		ShortDescription: "Unprotected git force-push, hard working-tree wipe, or --no-verify security hook bypass",
		Help:             "Prefer git push --force-with-lease on feature branches instead of --force on main/master, stash or branch before git reset --hard or git clean -fdx, and keep pre-commit/pre-push verification hooks enabled.",
	},
}

var ruleByID = func() map[string]RuleDescriptor {
	m := make(map[string]RuleDescriptor, len(ruleCatalog))
	for _, r := range ruleCatalog {
		m[r.ID] = r
	}
	return m
}()

// Rules returns a copy of the SLT011..SLT016 command firewall rule catalog.
func Rules() []RuleDescriptor {
	out := make([]RuleDescriptor, len(ruleCatalog))
	copy(out, ruleCatalog)
	return out
}

var (
	colonForkBombRe    = regexp.MustCompile(`(?m)(?:^|[;&|]\s*):\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&`)
	namedFuncDefRe     = regexp.MustCompile(`(?m)(?:^|[;&|\n]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{([^}]*)\}`)
	unguardedVarRootRe = regexp.MustCompile(`^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/\*?$`)
	rawBlockDevRe      = regexp.MustCompile(`(?i)^/dev/(?:sd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|vd[a-z]\d*|xvd[a-z]\d*|hd[a-z]\d*|mmcblk\d+(?:p\d+)?|disk\d+(?:s\d+)?|mem|kmem)$`)
	octalSuidRe        = regexp.MustCompile(`^0?[2467][0-7]{3}$`)
	devTcpRe           = regexp.MustCompile(`(?i)/dev/(?:tcp|udp)/[^\s/]+/\d+`)
	imdsEndpointRe     = regexp.MustCompile(`(?i)(?:169\.254\.169\.254|169\.254\.170\.2|100\.100\.100\.200|metadata\.google\.internal|\[fd00:ec2::254\])`)
	secretEnvVarRe     = regexp.MustCompile(`(?i)\$(?:\{)?(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|NPM_TOKEN|HF_TOKEN|STRIPE_SECRET_KEY|DATABASE_URL|SLACK_TOKEN|PRIVATE_KEY|SECRET_KEY)(?:\})?`)
)

var criticalRoots = map[string]bool{
	"/": true, "/*": true, "/.*": true,
	"~": true, "~/": true, "~/*": true,
	"$home": true, "${home}": true, "$home/": true, "${home}/": true, "$home/*": true, "${home}/*": true,
	"..": true, "../": true, "../*": true,
	"/root": true, "/root/*": true,
	"/etc": true, "/etc/*": true,
	"/boot": true, "/boot/*": true,
	"/usr": true, "/usr/*": true,
	"/var": true, "/var/*": true,
	"/bin": true, "/sbin": true, "/lib": true, "/lib64": true,
	"/system": true, "/users": true,
	"c:\\": true, "c:/": true, "c:\\*": true, "c:/*": true,
	"$env:userprofile": true, "$env:systemdrive": true,
}

var networkFetchers = map[string]bool{
	"curl": true, "wget": true, "fetch": true, "aria2c": true,
	"http": true, "https": true,
	"iwr": true, "irm": true, "invoke-webrequest": true, "invoke-restmethod": true,
}

var shellInterpreters = map[string]bool{
	"sh": true, "bash": true, "zsh": true, "dash": true, "ksh": true, "ash": true, "fish": true, "csh": true, "tcsh": true,
	"python": true, "python3": true, "python2": true,
	"perl": true, "ruby": true, "php": true, "node": true, "deno": true, "bun": true, "lua": true,
	"pwsh": true, "powershell": true, "iex": true, "invoke-expression": true,
}

var outboundSinks = map[string]bool{
	"curl": true, "wget": true, "http": true, "https": true,
	"scp": true, "rsync": true, "sftp": true, "ftp": true, "tftp": true,
	"nc": true, "ncat": true, "netcat": true, "socat": true,
	"dig": true, "nslookup": true, "host": true,
	"iwr": true, "irm": true, "invoke-webrequest": true, "invoke-restmethod": true,
}

var sensitiveFileNeedles = []string{
	".ssh/id_", "/etc/shadow", "/etc/gshadow", "/proc/self/environ",
	".aws/credentials", ".kube/config", ".docker/config.json",
	".npmrc", ".pypirc", ".netrc", ".git-credentials",
	"application_default_credentials.json",
}

// AnalyzeCommand evaluates a single shell command or multi-line snippet using default options.
func AnalyzeCommand(command string, opts AnalyzeOptions) AnalysisReport {
	return AnalyzeScript("inline", command, opts)
}

// AnalyzeScript parses and evaluates a shell script or agent command buffer against SLT011..SLT016.
func AnalyzeScript(source string, script string, opts AnalyzeOptions) AnalysisReport {
	if source == "" {
		source = "inline"
	}
	policy := normalizePolicy(opts.Policy)
	ctx := &analysisContext{
		source:   source,
		seenKeys: make(map[string]bool),
		findings: make([]Finding, 0),
	}

	ctx.analyzeLayer(script, "", 1, 0)

	errCount := 0
	warnCount := 0
	totalRisk := 0
	for _, f := range ctx.findings {
		if f.Severity == SeverityError {
			errCount++
		} else if f.Severity == SeverityWarning {
			warnCount++
		}
		totalRisk += f.RiskPoints
	}
	if totalRisk > 100 {
		totalRisk = 100
	}

	return AnalysisReport{
		Source:            source,
		Policy:            policy,
		Verdict:           computeVerdict(policy, errCount, warnCount),
		RiskScore:         totalRisk,
		SegmentCount:      ctx.segmentCount,
		ErrorCount:        errCount,
		WarningCount:      warnCount,
		UnwrappedCommands: ctx.unwrapped,
		Findings:          ctx.findings,
	}
}

func normalizePolicy(p PolicyMode) PolicyMode {
	switch strings.ToLower(strings.TrimSpace(string(p))) {
	case "strict":
		return PolicyStrict
	case "permissive":
		return PolicyPermissive
	default:
		return PolicyBalanced
	}
}

func computeVerdict(policy PolicyMode, errors int, warnings int) ActionVerdict {
	if errors == 0 && warnings == 0 {
		return VerdictAllow
	}
	switch policy {
	case PolicyStrict:
		return VerdictBlock
	case PolicyPermissive:
		if errors > 0 {
			return VerdictRequireApproval
		}
		return VerdictWarn
	default:
		if errors > 0 {
			return VerdictBlock
		}
		return VerdictRequireApproval
	}
}

type analysisContext struct {
	source       string
	segmentCount int
	unwrapped    []string
	seenKeys     map[string]bool
	findings     []Finding
}

func (c *analysisContext) addFinding(ruleID string, severityOverride Severity, line int, col int, cmdText string, layer string, message string, remediation string) {
	desc := ruleByID[ruleID]
	sev := desc.Severity
	if severityOverride != "" {
		sev = severityOverride
	}
	if line < 1 {
		line = 1
	}
	if col < 1 {
		col = 1
	}
	trimmedCmd := strings.TrimSpace(cmdText)
	if len(trimmedCmd) > 180 {
		trimmedCmd = trimmedCmd[:177] + "..."
	}
	dedupKey := fmt.Sprintf("%s:%d:%s:%s", ruleID, line, trimmedCmd, layer)
	if c.seenKeys[dedupKey] {
		return
	}
	c.seenKeys[dedupKey] = true

	remed := remediation
	if remed == "" {
		remed = desc.Help
	}
	c.findings = append(c.findings, Finding{
		RuleID:       ruleID,
		RuleName:     desc.Name,
		Severity:     sev,
		CWE:          desc.CWE,
		Source:       c.source,
		Line:         line,
		Column:       col,
		Command:      trimmedCmd,
		DecodedLayer: layer,
		RiskPoints:   desc.BaseRisk,
		Message:      message,
		Remediation:  remed,
	})
}

func (c *analysisContext) recordUnwrapped(desc string) {
	for _, existing := range c.unwrapped {
		if existing == desc {
			return
		}
	}
	c.unwrapped = append(c.unwrapped, desc)
}

func (c *analysisContext) analyzeLayer(script string, layerLabel string, baseLine int, depth int) {
	if depth > maxRecursionDepth || strings.TrimSpace(script) == "" {
		return
	}

	// 1. Raw syntax checks that span shell function definitions (e.g. fork bombs).
	if bombIdx, bombSnippet := detectForkBomb(script); bombIdx >= 0 {
		ln := baseLine + strings.Count(script[:bombIdx], "\n")
		c.addFinding("SLT011", "", ln, 1, bombSnippet, layerLabel,
			"Recursive shell fork bomb definition will exhaust host PID and CPU tables.", "")
	}

	segments := ParseShellSegments(script)
	if depth == 0 {
		c.segmentCount += len(segments)
	}

	// Group segments into pipelines (connected by | or |&) and inspect both individual
	// commands and cross-stage pipeline dataflows.
	i := 0
	for i < len(segments) {
		pipeStart := i
		for i < len(segments) && (segments[i].ConnectorToNext == "|" || segments[i].ConnectorToNext == "|&") {
			i++
		}
		pipeEnd := i
		if pipeEnd >= len(segments) {
			pipeEnd = len(segments) - 1
		}
		pipeline := segments[pipeStart : pipeEnd+1]
		c.inspectPipeline(pipeline, layerLabel, baseLine, depth)
		i = pipeEnd + 1
	}
}

func (c *analysisContext) inspectPipeline(pipeline []CommandSegment, layerLabel string, baseLine int, depth int) {
	if len(pipeline) == 0 {
		return
	}

	// Evaluate per-segment rules and recursive command unwrapping.
	for idx := range pipeline {
		seg := pipeline[idx]
		adjLine := seg.Line
		if baseLine > 1 {
			adjLine = baseLine + seg.Line - 1
		}
		c.inspectSingleSegment(seg, adjLine, layerLabel, depth)
	}

	// Evaluate multi-stage pipeline rules (SLT012, SLT013, SLT014).
	adjPipeLine := pipeline[0].Line
	if baseLine > 1 {
		adjPipeLine = baseLine + pipeline[0].Line - 1
	}
	pipeSummary := formatPipelineSummary(pipeline)

	hasNetFetch := false
	hasDecoder := false
	var literalEchoArg string
	hasCredSource := false
	var credSourceDesc string

	for stageIdx, seg := range pipeline {
		if len(seg.Argv) == 0 {
			continue
		}
		cmd := baseCommandName(seg.Argv[0])
		if networkFetchers[cmd] {
			hasNetFetch = true
			if targetIMDS := findIMDSReference(seg); targetIMDS != "" {
				c.addFinding("SLT014", "", adjPipeLine, pipeline[0].Column, pipeSummary, layerLabel,
					fmt.Sprintf("Command queries cloud Instance Metadata Service (%s) for workload credentials.", targetIMDS), "")
			}
		}
		if cmd == "echo" || cmd == "printf" {
			for _, a := range seg.Argv[1:] {
				if !strings.HasPrefix(a, "-") && len(a) >= 8 {
					literalEchoArg = a
				}
			}
		}
		if isPayloadDecoder(seg) {
			hasDecoder = true
		}
		if src := detectCredentialSourceInSegment(seg); src != "" {
			hasCredSource = true
			credSourceDesc = src
		}

		if stageIdx > 0 && shellInterpreters[cmd] {
			if hasNetFetch {
				c.addFinding("SLT012", "", adjPipeLine, pipeline[0].Column, pipeSummary, layerLabel,
					fmt.Sprintf("Pipeline streams unverified network response directly into interpreter '%s'.", cmd), "")
			}
			if hasDecoder {
				c.addFinding("SLT012", "", adjPipeLine, pipeline[0].Column, pipeSummary, layerLabel,
					fmt.Sprintf("Pipeline decodes obfuscated data and pipes it directly into interpreter '%s'.", cmd), "")
				if literalEchoArg != "" {
					if decoded, ok := DecodeBase64Command(literalEchoArg, false); ok {
						tag := "base64-pipe: " + decoded
						c.recordUnwrapped(tag)
						c.analyzeLayer(decoded, "base64-pipe", adjPipeLine, depth+1)
					}
				}
			}
		}

		// Reverse shell via openssl s_client or nc piped into shell, or shell piped into nc
		if stageIdx > 0 {
			prevCmd := ""
			if len(pipeline[stageIdx-1].Argv) > 0 {
				prevCmd = baseCommandName(pipeline[stageIdx-1].Argv[0])
			}
			if (prevCmd == "nc" || prevCmd == "ncat" || prevCmd == "netcat" || prevCmd == "openssl") && shellInterpreters[cmd] {
				c.addFinding("SLT013", "", adjPipeLine, pipeline[0].Column, pipeSummary, layerLabel,
					fmt.Sprintf("Remote socket stream from '%s' is wired directly into interactive interpreter '%s'.", prevCmd, cmd), "")
			}
			if shellInterpreters[prevCmd] && (cmd == "nc" || cmd == "ncat" || cmd == "netcat") {
				c.addFinding("SLT013", "", adjPipeLine, pipeline[0].Column, pipeSummary, layerLabel,
					fmt.Sprintf("Interactive interpreter '%s' stdout is piped into network socket tool '%s'.", prevCmd, cmd), "")
			}
		}

		// Credential source piped into outbound network sink (e.g. cat ~/.ssh/id_ed25519 | curl -d @- ...)
		if stageIdx > 0 && hasCredSource && outboundSinks[cmd] {
			c.addFinding("SLT014", "", adjPipeLine, pipeline[0].Column, pipeSummary, layerLabel,
				fmt.Sprintf("Pipeline reads %s and streams it to outbound network command '%s'.", credSourceDesc, cmd), "")
		}

		// Crontab installation from remote fetch or untrusted pipeline
		if stageIdx > 0 && cmd == "crontab" && hasNetFetch {
			c.addFinding("SLT015", SeverityError, adjPipeLine, pipeline[0].Column, pipeSummary, layerLabel,
				"Remote payload is piped directly into crontab for persistent scheduled execution.", "")
		}
	}
}

func (c *analysisContext) inspectSingleSegment(seg CommandSegment, line int, layerLabel string, depth int) {
	cmdText := formatSegmentSummary(seg)

	// Check environment variable assignments for LD_PRELOAD / DYLD_INSERT_LIBRARIES
	for _, envAssign := range seg.EnvVars {
		upper := strings.ToUpper(envAssign)
		if strings.HasPrefix(upper, "LD_PRELOAD=") || strings.HasPrefix(upper, "DYLD_INSERT_LIBRARIES=") {
			c.addFinding("SLT015", SeverityError, line, seg.Column, cmdText, layerLabel,
				fmt.Sprintf("Dynamic linker hijack variable '%s' injects shared libraries into child processes.", strings.SplitN(envAssign, "=", 2)[0]), "")
		}
	}

	// Check redirections for /dev/tcp reverse shells, raw block device writes, and persistence file overwrites
	for _, redir := range seg.Redirects {
		target := strings.TrimSpace(redir.Target)
		if devTcpRe.MatchString(target) {
			c.addFinding("SLT013", "", line, redir.Column, cmdText, layerLabel,
				fmt.Sprintf("Shell redirection opens raw socket '%s' for interactive reverse-shell transport.", target), "")
		}
		if strings.Contains(redir.Operator, ">") && rawBlockDevRe.MatchString(target) {
			c.addFinding("SLT011", "", line, redir.Column, cmdText, layerLabel,
				fmt.Sprintf("Output redirection '%s %s' overwrites raw block or kernel memory device.", redir.Operator, target), "")
		}
		if strings.Contains(redir.Operator, ">") {
			if persistTarget := matchPersistencePath(target); persistTarget != "" {
				c.addFinding("SLT015", SeverityError, line, redir.Column, cmdText, layerLabel,
					fmt.Sprintf("Output redirection mutates privileged authentication or persistence file '%s'.", persistTarget), "")
			}
		}
	}

	// Recursively inspect command substitutions, process substitutions, and subshells
	for _, sub := range seg.Substitutions {
		subLine := line
		if sub.Line > 1 && seg.Line > 0 {
			subLine = line + (sub.Line - seg.Line)
		}
		c.analyzeLayer(sub.Script, sub.Kind, subLine, depth+1)
	}

	if len(seg.Argv) == 0 {
		return
	}

	cmd := baseCommandName(seg.Argv[0])
	args := seg.Argv[1:]

	// Check /dev/tcp anywhere in arguments (e.g. exec 5<>/dev/tcp/...)
	for _, a := range seg.Argv {
		if devTcpRe.MatchString(a) {
			c.addFinding("SLT013", "", line, seg.Column, cmdText, layerLabel,
				fmt.Sprintf("Command references virtual socket path '%s' for raw network pivoting.", a), "")
		}
	}

	// Unwrap nested shell / eval / PowerShell invocations
	c.unwrapNestedExecution(cmd, args, cmdText, line, seg.Column, layerLabel, depth)

	// Rule SLT011: rm / find / dd / mkfs / wipefs / shred / Remove-Item / Format-Volume
	c.checkDestructiveFS(cmd, args, cmdText, line, seg.Column, layerLabel)

	// Rule SLT012: bash <(curl ...), source <(curl ...), eval "$(curl ...)", iex (irm ...)
	c.checkSubstitutedFetchExec(cmd, args, seg.Substitutions, cmdText, line, seg.Column, layerLabel)

	// Rule SLT013: nc -e, socat EXEC, python/perl/php/ruby socket shells, mkfifo
	c.checkReverseShells(cmd, args, cmdText, line, seg.Column, layerLabel)

	// Rule SLT014: curl/wget/scp/dig credential & IMDS exfiltration
	c.checkExfiltration(seg, cmd, args, cmdText, line, seg.Column, layerLabel)

	// Rule SLT015: chmod +s, sudoers/authorized_keys tee, docker --privileged, nsenter -t 1, firewall disable
	c.checkPrivEscAndPersistence(seg, cmd, args, cmdText, line, seg.Column, layerLabel)

	// Rule SLT016: git push --force, git reset --hard, git clean -fdx, --no-verify
	c.checkGitGuardrails(cmd, args, cmdText, line, seg.Column, layerLabel)
}

func (c *analysisContext) unwrapNestedExecution(cmd string, args []string, cmdText string, line int, col int, layerLabel string, depth int) {
	switch cmd {
	case "sh", "bash", "zsh", "dash", "ksh", "ash":
		for i := 0; i < len(args); i++ {
			a := args[i]
			if (a == "-c" || (strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "--") && strings.Contains(a, "c"))) && i+1 < len(args) {
				inner := args[i+1]
				c.recordUnwrapped(cmd + " -c: " + inner)
				c.analyzeLayer(inner, cmd+" -c", line, depth+1)
				break
			}
		}
	case "eval":
		if len(args) > 0 {
			inner := strings.Join(args, " ")
			c.recordUnwrapped("eval: " + inner)
			c.analyzeLayer(inner, "eval", line, depth+1)
		}
	case "pwsh", "powershell":
		for i := 0; i < len(args); i++ {
			low := strings.ToLower(args[i])
			if (low == "-encodedcommand" || low == "-enc" || low == "-ec" || low == "-e") && i+1 < len(args) {
				b64 := args[i+1]
				c.addFinding("SLT012", "", line, col, cmdText, layerLabel,
					"PowerShell -EncodedCommand executes an obfuscated Base64 script block.", "")
				if decoded, ok := DecodeBase64Command(b64, true); ok {
					c.recordUnwrapped("pwsh -EncodedCommand: " + decoded)
					c.analyzeLayer(decoded, "pwsh-encoded", line, depth+1)
				}
				break
			}
			if (low == "-command" || low == "-c") && i+1 < len(args) {
				inner := strings.Join(args[i+1:], " ")
				c.recordUnwrapped("pwsh -Command: " + inner)
				c.analyzeLayer(inner, "pwsh -Command", line, depth+1)
				break
			}
		}
	case "xargs":
		// Unwrap target command executed by xargs (e.g. xargs rm -rf /)
		idx := 0
		for idx < len(args) {
			a := args[idx]
			if a == "--" {
				idx++
				break
			}
			if strings.HasPrefix(a, "-") {
				if (a == "-I" || a == "-L" || a == "-n" || a == "-P" || a == "-s" || a == "-d") && idx+1 < len(args) {
					idx += 2
					continue
				}
				idx++
				continue
			}
			break
		}
		if idx < len(args) {
			inner := strings.Join(args[idx:], " ")
			c.analyzeLayer(inner, "xargs", line, depth+1)
		}
	}
}

func (c *analysisContext) checkDestructiveFS(cmd string, args []string, cmdText string, line int, col int, layerLabel string) {
	switch cmd {
	case "rm":
		recursive := false
		noPreserveRoot := false
		afterDoubleDash := false
		var targets []string
		for _, a := range args {
			if !afterDoubleDash && a == "--" {
				afterDoubleDash = true
				continue
			}
			if !afterDoubleDash && strings.HasPrefix(a, "--") {
				if a == "--recursive" {
					recursive = true
				} else if strings.HasPrefix(a, "--no-preserve-root") {
					noPreserveRoot = true
				}
				continue
			}
			if !afterDoubleDash && strings.HasPrefix(a, "-") && len(a) > 1 {
				flags := a[1:]
				if strings.ContainsAny(flags, "rR") {
					recursive = true
				}
				continue
			}
			targets = append(targets, a)
		}
		if noPreserveRoot {
			c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
				"rm --no-preserve-root explicitly disables root filesystem deletion protection.", "")
		}
		if recursive {
			for _, t := range targets {
				norm := normalizeTargetPath(t)
				if criticalRoots[norm] {
					c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
						fmt.Sprintf("Recursive deletion 'rm' targets critical root, home, or system path '%s'.", t), "")
				} else if unguardedVarRootRe.MatchString(strings.TrimSpace(t)) {
					c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
						fmt.Sprintf("Unguarded variable root '%s' in recursive rm expands to '/' or '/*' if the variable is unset.", t), "")
				}
			}
		}
	case "find":
		if len(args) > 0 {
			var roots []string
			hasDelete := false
			for i := 0; i < len(args); i++ {
				a := args[i]
				if !strings.HasPrefix(a, "-") && a != "!" && a != "(" && len(roots) == 0 {
					roots = append(roots, a)
					continue
				}
				if a == "-delete" {
					hasDelete = true
				}
				if (a == "-exec" || a == "-execdir") && i+1 < len(args) && baseCommandName(args[i+1]) == "rm" {
					hasDelete = true
				}
			}
			if hasDelete {
				for _, r := range roots {
					if criticalRoots[normalizeTargetPath(r)] {
						c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
							fmt.Sprintf("find on critical system path '%s' with destructive -delete/-exec rm.", r), "")
					}
				}
			}
		}
	case "dd":
		for _, a := range args {
			if strings.HasPrefix(strings.ToLower(a), "of=") {
				target := a[3:]
				if rawBlockDevRe.MatchString(target) {
					c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
						fmt.Sprintf("dd writes directly to raw block or memory device '%s'.", target), "")
				}
			}
		}
	case "wipefs", "blkdiscard", "shred":
		for _, a := range args {
			if rawBlockDevRe.MatchString(a) {
				c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
					fmt.Sprintf("'%s' irreversibly erases raw block device '%s'.", cmd, a), "")
			}
		}
	case "remove-item", "ri", "del", "erase", "rmdir", "rd":
		recurse := false
		var targets []string
		for _, a := range args {
			low := strings.ToLower(a)
			if low == "-recurse" || low == "-r" || low == "/s" {
				recurse = true
				continue
			}
			if strings.HasPrefix(a, "-") || strings.HasPrefix(a, "/") && len(a) == 2 {
				continue
			}
			targets = append(targets, a)
		}
		if recurse {
			for _, t := range targets {
				if criticalRoots[normalizeTargetPath(t)] {
					c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
						fmt.Sprintf("Recursive '%s' targets root or profile directory '%s'.", cmd, t), "")
				}
			}
		}
	case "format-volume", "clear-disk":
		c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
			fmt.Sprintf("PowerShell disk-formatting cmdlet '%s' wipes partition data.", cmd), "")
	default:
		if cmd == "mkfs" || strings.HasPrefix(cmd, "mkfs.") {
			c.addFinding("SLT011", "", line, col, cmdText, layerLabel,
				fmt.Sprintf("Filesystem formatter '%s' destroys existing partition data.", cmd), "")
		}
	}
}

func (c *analysisContext) checkSubstitutedFetchExec(cmd string, args []string, subs []SubScript, cmdText string, line int, col int, layerLabel string) {
	isExecSink := shellInterpreters[cmd] || cmd == "source" || cmd == "." || cmd == "eval"
	if !isExecSink {
		return
	}
	for _, sub := range subs {
		subSegs := ParseShellSegments(sub.Script)
		for _, s := range subSegs {
			if len(s.Argv) > 0 && networkFetchers[baseCommandName(s.Argv[0])] {
				c.addFinding("SLT012", "", line, col, cmdText, layerLabel,
					fmt.Sprintf("'%s' directly executes network content fetched via %s substitution.", cmd, sub.Kind), "")
				return
			}
		}
	}
	joined := strings.ToLower(strings.Join(args, " "))
	if (cmd == "iex" || cmd == "invoke-expression") &&
		(strings.Contains(joined, "invoke-webrequest") || strings.Contains(joined, "invoke-restmethod") ||
			strings.Contains(joined, "downloadstring") || strings.Contains(joined, "iwr ") || strings.Contains(joined, "irm ")) {
		c.addFinding("SLT012", "", line, col, cmdText, layerLabel,
			"PowerShell Invoke-Expression evaluates a remote web download inline without verification.", "")
	}
}

func (c *analysisContext) checkReverseShells(cmd string, args []string, cmdText string, line int, col int, layerLabel string) {
	switch cmd {
	case "nc", "ncat", "netcat", "cryptcat":
		for i, a := range args {
			if a == "-e" || a == "-c" || a == "--exec" || a == "--sh-exec" || strings.HasPrefix(a, "--exec=") || strings.HasPrefix(a, "--sh-exec=") {
				target := a
				if i+1 < len(args) && !strings.Contains(a, "=") {
					target = a + " " + args[i+1]
				}
				c.addFinding("SLT013", "", line, col, cmdText, layerLabel,
					fmt.Sprintf("'%s %s' binds a local command interpreter directly to a network socket.", cmd, target), "")
				return
			}
		}
	case "socat":
		hasNet := false
		hasExec := false
		for _, a := range args {
			low := strings.ToLower(a)
			if strings.HasPrefix(low, "tcp:") || strings.HasPrefix(low, "tcp4:") || strings.HasPrefix(low, "tcp6:") ||
				strings.HasPrefix(low, "openssl:") || strings.HasPrefix(low, "ssl:") || strings.HasPrefix(low, "udp:") {
				hasNet = true
			}
			if strings.HasPrefix(low, "exec:") || strings.HasPrefix(low, "system:") {
				hasExec = true
			}
		}
		if hasNet && hasExec {
			c.addFinding("SLT013", "", line, col, cmdText, layerLabel,
				"socat bridges a remote network socket directly to an EXEC/SYSTEM shell process.", "")
		}
	case "python", "python3", "python2", "perl", "ruby", "php", "node", "lua":
		inline := strings.ToLower(strings.Join(args, " "))
		hasSocket := strings.Contains(inline, "socket") || strings.Contains(inline, "fsockopen") || strings.Contains(inline, "tcpsocket")
		hasShellSpawn := strings.Contains(inline, "pty.spawn") || strings.Contains(inline, "os.dup2") ||
			strings.Contains(inline, "subprocess") || strings.Contains(inline, "/bin/sh") ||
			strings.Contains(inline, "/bin/bash") || strings.Contains(inline, "proc_open") ||
			strings.Contains(inline, "child_process")
		if hasSocket && hasShellSpawn {
			c.addFinding("SLT013", "", line, col, cmdText, layerLabel,
				fmt.Sprintf("Inline '%s' script opens a raw network socket and spawns an interactive shell.", cmd), "")
		}
	}
}

func (c *analysisContext) checkExfiltration(seg CommandSegment, cmd string, args []string, cmdText string, line int, col int, layerLabel string) {
	if targetIMDS := findIMDSReference(seg); targetIMDS != "" {
		c.addFinding("SLT014", "", line, col, cmdText, layerLabel,
			fmt.Sprintf("Command accesses cloud Instance Metadata Service (%s) credential endpoint.", targetIMDS), "")
	}

	if !outboundSinks[cmd] {
		return
	}

	// Check arguments and embedded command substitutions for sensitive files, env dumps, or secret env vars.
	for _, a := range args {
		cleaned := strings.TrimPrefix(a, "@")
		if eq := strings.IndexByte(cleaned, '='); eq >= 0 {
			cleaned = strings.TrimPrefix(cleaned[eq+1:], "@")
		}
		if credFile := matchSensitiveCredentialFile(cleaned, true); credFile != "" {
			c.addFinding("SLT014", "", line, col, cmdText, layerLabel,
				fmt.Sprintf("Outbound network command '%s' transmits sensitive credential file '%s'.", cmd, credFile), "")
			return
		}
		if secretEnvVarRe.MatchString(a) {
			c.addFinding("SLT014", "", line, col, cmdText, layerLabel,
				fmt.Sprintf("Outbound network command '%s' interpolates secret environment variable into request parameters.", cmd), "")
			return
		}
	}

	for _, sub := range seg.Substitutions {
		subSegs := ParseShellSegments(sub.Script)
		for _, s := range subSegs {
			if src := detectCredentialSourceInSegment(s); src != "" {
				c.addFinding("SLT014", "", line, col, cmdText, layerLabel,
					fmt.Sprintf("Outbound network command '%s' embeds %s inside a command substitution.", cmd, src), "")
				return
			}
		}
	}
}

func (c *analysisContext) checkPrivEscAndPersistence(seg CommandSegment, cmd string, args []string, cmdText string, line int, col int, layerLabel string) {
	switch cmd {
	case "chmod":
		recursive := false
		suid := false
		worldWritable := false
		var targets []string
		for _, a := range args {
			if a == "-R" || a == "--recursive" {
				recursive = true
				continue
			}
			if strings.HasPrefix(a, "-") && len(a) > 1 && !strings.Contains(a, "+") {
				if strings.Contains(a[1:], "R") {
					recursive = true
				}
				continue
			}
			if strings.Contains(a, "+s") || octalSuidRe.MatchString(a) {
				suid = true
				continue
			}
			if a == "777" || a == "0777" || strings.Contains(a, "a+w") || strings.Contains(a, "o+w") {
				worldWritable = true
				continue
			}
			targets = append(targets, a)
		}
		if suid {
			c.addFinding("SLT015", SeverityError, line, col, cmdText, layerLabel,
				"chmod sets SUID/SGID privilege-escalation bit on executable target.", "")
		}
		if recursive && worldWritable {
			for _, t := range targets {
				if criticalRoots[normalizeTargetPath(t)] {
					c.addFinding("SLT015", SeverityError, line, col, cmdText, layerLabel,
						fmt.Sprintf("Recursive world-writable chmod on critical system directory '%s'.", t), "")
				}
			}
		}
	case "tee":
		for _, a := range args {
			if strings.HasPrefix(a, "-") {
				continue
			}
			if persist := matchPersistencePath(a); persist != "" {
				c.addFinding("SLT015", SeverityError, line, col, cmdText, layerLabel,
					fmt.Sprintf("tee writes directly to privileged authentication or persistence file '%s'.", persist), "")
			}
		}
	case "docker", "podman":
		if len(args) > 0 && (args[0] == "run" || args[0] == "exec" || args[0] == "create") {
			for i := 1; i < len(args); i++ {
				a := args[i]
				if a == "--privileged" || strings.HasPrefix(a, "--privileged=true") {
					c.addFinding("SLT015", SeverityError, line, col, cmdText, layerLabel,
						fmt.Sprintf("'%s %s --privileged' grants full host kernel capability and device access.", cmd, args[0]), "")
				}
				volSpec := ""
				if (a == "-v" || a == "--volume") && i+1 < len(args) {
					volSpec = args[i+1]
					i++
				} else if strings.HasPrefix(a, "-v=") || strings.HasPrefix(a, "--volume=") {
					volSpec = strings.SplitN(a, "=", 2)[1]
				}
				if volSpec != "" {
					hostSide := strings.SplitN(volSpec, ":", 2)[0]
					normHost := normalizeTargetPath(hostSide)
					if normHost == "/" || normHost == "/etc" || normHost == "/root" || strings.Contains(strings.ToLower(hostSide), "docker.sock") {
						c.addFinding("SLT015", SeverityError, line, col, cmdText, layerLabel,
							fmt.Sprintf("Container bind-mounts sensitive host root or runtime socket ('%s').", volSpec), "")
					}
				}
			}
		}
	case "nsenter":
		for i := 0; i < len(args); i++ {
			a := args[i]
			if ((a == "-t" || a == "--target") && i+1 < len(args) && args[i+1] == "1") || a == "-t1" || a == "--target=1" {
				c.addFinding("SLT015", SeverityError, line, col, cmdText, layerLabel,
					"nsenter targets PID 1 to enter host init namespaces from an elevated context.", "")
				break
			}
		}
	case "setenforce":
		if len(args) > 0 && (args[0] == "0" || strings.EqualFold(args[0], "permissive")) {
			c.addFinding("SLT015", SeverityWarning, line, col, cmdText, layerLabel,
				"setenforce 0 disables SELinux mandatory access control enforcement.", "")
		}
	case "ufw":
		if len(args) > 0 && strings.EqualFold(args[0], "disable") {
			c.addFinding("SLT015", SeverityWarning, line, col, cmdText, layerLabel,
				"ufw disable turns off host firewall packet filtering.", "")
		}
	case "iptables":
		for _, a := range args {
			if a == "-F" || a == "--flush" {
				c.addFinding("SLT015", SeverityWarning, line, col, cmdText, layerLabel,
					"iptables --flush clears active host firewall chains.", "")
			}
		}
	}
}

func (c *analysisContext) checkGitGuardrails(cmd string, args []string, cmdText string, line int, col int, layerLabel string) {
	if cmd != "git" || len(args) == 0 {
		return
	}

	// Detect global git -c core.hooksPath=/dev/null before subcommand
	subIdx := 0
	hooksDisabled := false
	for subIdx < len(args) {
		a := args[subIdx]
		if a == "-c" && subIdx+1 < len(args) {
			kv := strings.ToLower(args[subIdx+1])
			if strings.HasPrefix(kv, "core.hookspath=") && (strings.Contains(kv, "/dev/null") || strings.HasSuffix(kv, "=")) {
				hooksDisabled = true
			}
			subIdx += 2
			continue
		}
		if (a == "-C" || a == "--git-dir" || a == "--work-tree") && subIdx+1 < len(args) {
			subIdx += 2
			continue
		}
		if strings.HasPrefix(a, "-") {
			subIdx++
			continue
		}
		break
	}
	if hooksDisabled {
		c.addFinding("SLT016", "", line, col, cmdText, layerLabel,
			"git -c core.hooksPath=/dev/null bypasses repository security hooks.", "")
	}
	if subIdx >= len(args) {
		return
	}

	sub := args[subIdx]
	subArgs := args[subIdx+1:]

	switch sub {
	case "push":
		force := false
		withLease := false
		noVerify := false
		for _, a := range subArgs {
			if a == "--force-with-lease" || strings.HasPrefix(a, "--force-with-lease=") || a == "--force-if-includes" {
				withLease = true
			} else if a == "--force" || a == "-f" || strings.HasPrefix(a, "+") {
				force = true
			}
			if a == "--no-verify" {
				noVerify = true
			}
		}
		if force && !withLease {
			c.addFinding("SLT016", "", line, col, cmdText, layerLabel,
				"git push --force overwrites remote commit history without --force-with-lease stale-ref protection.", "")
		}
		if noVerify {
			c.addFinding("SLT016", "", line, col, cmdText, layerLabel,
				"git push --no-verify bypasses pre-push verification hooks.", "")
		}
	case "commit":
		for i := 0; i < len(subArgs); i++ {
			a := subArgs[i]
			if a == "-m" || a == "-F" || a == "-C" || a == "-c" || a == "--message" {
				// Skip the next token (commit message or file path) and continue scanning flags.
				i++
				continue
			}
			if a == "--no-verify" || a == "-n" || (strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "--") && strings.Contains(a[1:], "n") && !strings.Contains(a, "=")) {
				c.addFinding("SLT016", "", line, col, cmdText, layerLabel,
					"git commit --no-verify bypasses pre-commit secret and lint hooks.", "")
				break
			}
		}
	case "reset":
		for _, a := range subArgs {
			if a == "--hard" {
				c.addFinding("SLT016", "", line, col, cmdText, layerLabel,
					"git reset --hard irreversibly discards uncommitted index and working-tree changes.", "")
				break
			}
		}
	case "clean":
		hasForce := false
		hasDirOrIgnored := false
		for _, a := range subArgs {
			if a == "--force" {
				hasForce = true
			} else if strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "--") {
				flags := a[1:]
				if strings.Contains(flags, "f") && !strings.Contains(flags, "n") {
					hasForce = true
				}
				if strings.ContainsAny(flags, "dxX") {
					hasDirOrIgnored = true
				}
			}
		}
		if hasForce && hasDirOrIgnored {
			c.addFinding("SLT016", "", line, col, cmdText, layerLabel,
				"git clean -fd/-fdx permanently deletes untracked directories and ignored files.", "")
		}
	}
}

func normalizeTargetPath(p string) string {
	s := strings.TrimSpace(p)
	s = strings.Trim(s, `"'`)
	low := strings.ToLower(s)
	if len(low) > 1 && strings.HasSuffix(low, "/") && low != "~/" && low != "../" && low != "c:/" && !strings.HasSuffix(low, "}/") {
		low = strings.TrimRight(low, "/")
		if low == "" {
			low = "/"
		}
	}
	return low
}

func isPayloadDecoder(seg CommandSegment) bool {
	if len(seg.Argv) == 0 {
		return false
	}
	cmd := baseCommandName(seg.Argv[0])
	switch cmd {
	case "base64":
		for _, a := range seg.Argv[1:] {
			if a == "-d" || a == "-D" || a == "--decode" {
				return true
			}
		}
	case "xxd":
		for _, a := range seg.Argv[1:] {
			if a == "-r" || a == "-p" || a == "-rp" || a == "-pr" {
				return true
			}
		}
	case "openssl":
		if len(seg.Argv) >= 2 && (seg.Argv[1] == "enc" || seg.Argv[1] == "base64") {
			for _, a := range seg.Argv[2:] {
				if a == "-d" {
					return true
				}
			}
		}
	}
	return false
}

func detectCredentialSourceInSegment(seg CommandSegment) string {
	if len(seg.Argv) == 0 {
		return ""
	}
	cmd := baseCommandName(seg.Argv[0])
	if cmd == "env" || cmd == "printenv" || (cmd == "export" && len(seg.Argv) == 2 && seg.Argv[1] == "-p") {
		return fmt.Sprintf("process environment dump (%s)", cmd)
	}
	if cmd == "cat" || cmd == "head" || cmd == "tail" || cmd == "less" || cmd == "more" || cmd == "base64" || cmd == "tar" || cmd == "zip" || cmd == "grep" {
		for _, a := range seg.Argv[1:] {
			if f := matchSensitiveCredentialFile(a, true); f != "" {
				return fmt.Sprintf("credential file '%s'", f)
			}
		}
	}
	for _, a := range seg.Argv[1:] {
		if secretEnvVarRe.MatchString(a) {
			return "secret environment variable"
		}
	}
	return ""
}

func matchSensitiveCredentialFile(arg string, includeDotEnv bool) string {
	norm := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(arg)), "\\", "/")
	for _, needle := range sensitiveFileNeedles {
		if strings.Contains(norm, needle) {
			return arg
		}
	}
	if includeDotEnv {
		base := norm
		if idx := strings.LastIndexByte(norm, '/'); idx >= 0 {
			base = norm[idx+1:]
		}
		if base == ".env" || strings.HasPrefix(base, ".env.") && !strings.HasSuffix(base, ".example") && !strings.HasSuffix(base, ".sample") && !strings.HasSuffix(base, ".template") {
			return arg
		}
	}
	return ""
}

func matchPersistencePath(target string) string {
	norm := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(target)), "\\", "/")
	persistNeedles := []string{
		"/etc/sudoers",
		"/etc/passwd",
		"/etc/shadow",
		"/etc/ld.so.preload",
		"/etc/crontab",
		"/etc/cron.",
		".ssh/authorized_keys",
	}
	for _, needle := range persistNeedles {
		if strings.Contains(norm, needle) {
			return target
		}
	}
	return ""
}

func findIMDSReference(seg CommandSegment) string {
	for _, a := range seg.Argv {
		if m := imdsEndpointRe.FindString(a); m != "" {
			return m
		}
	}
	return ""
}

func formatSegmentSummary(seg CommandSegment) string {
	var parts []string
	if seg.Elevated {
		parts = append(parts, "sudo")
	}
	parts = append(parts, seg.EnvVars...)
	parts = append(parts, seg.Argv...)
	for _, r := range seg.Redirects {
		if r.Target != "" {
			parts = append(parts, r.Operator+" "+r.Target)
		} else {
			parts = append(parts, r.Operator)
		}
	}
	return strings.Join(parts, " ")
}

func detectForkBomb(script string) (int, string) {
	if loc := colonForkBombRe.FindStringIndex(script); loc != nil {
		return loc[0], strings.TrimSpace(script[loc[0]:loc[1]])
	}
	for _, m := range namedFuncDefRe.FindAllStringSubmatchIndex(script, -1) {
		fnName := script[m[2]:m[3]]
		fnBody := script[m[4]:m[5]]
		if strings.Contains(fnBody, "|") && strings.Contains(fnBody, "&") {
			segs := ParseShellSegments(fnBody)
			calls := 0
			for _, s := range segs {
				if len(s.Argv) > 0 && s.Argv[0] == fnName {
					calls++
				}
			}
			if calls >= 2 {
				return m[0], strings.TrimSpace(script[m[0]:m[1]])
			}
		}
	}
	return -1, ""
}

func formatPipelineSummary(pipeline []CommandSegment) string {
	stages := make([]string, 0, len(pipeline))
	for _, s := range pipeline {
		stages = append(stages, formatSegmentSummary(s))
	}
	return strings.Join(stages, " | ")
}
