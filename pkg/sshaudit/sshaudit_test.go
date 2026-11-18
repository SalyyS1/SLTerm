// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package sshaudit

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAuditConfigCleanBaseline(t *testing.T) {
	cfg := `# Hardened SSH client baseline
Host bastion.prod.internal
    HostName 10.20.0.5
    User ops
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%C

Host app-*.prod.internal
    ProxyJump bastion.prod.internal
    User deploy
    ForwardAgent no
    Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
    KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256
    HostKeyAlgorithms ssh-ed25519,rsa-sha2-512
    LocalForward 127.0.0.1:15432 127.0.0.1:5432
    SendEnv LANG LC_CTYPE
`
	rep := AuditConfig("clean_config", cfg)
	if len(rep.Findings) != 0 {
		t.Fatalf("expected 0 findings on clean baseline, got %d: %+v", len(rep.Findings), rep.Findings)
	}
	if rep.StanzaCount != 2 {
		t.Fatalf("expected 2 stanzas, got %d", rep.StanzaCount)
	}
}

func TestAuditConfigDetectsAllTenRules(t *testing.T) {
	fakeGH := "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
	cfg := `Host *
    ForwardAgent yes
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    PermitLocalCommand yes
    LocalCommand echo connected %h
    SendEnv AWS_SECRET_ACCESS_KEY *
    GatewayPorts yes
    ControlPath /tmp/ssh-%r@%h:%p

Host legacy-router
    ProxyCommand sh -c "nc -X connect -x proxy.internal:8080 %h %p"
    HostKeyAlgorithms +ssh-rsa,ssh-dss
    Ciphers +3des-cbc,aes128-cbc
    MACs hmac-md5
    KexAlgorithms diffie-hellman-group1-sha1
    LocalForward 0.0.0.0:8080 127.0.0.1:80
    ForwardX11Trusted yes

Match host *.corp exec "check-host.sh %h"
    # token=` + fakeGH + `
    HostName prod` + "\u200b" + `.corp.internal
`
	rep := AuditConfig("vulnerable_config", cfg)
	byRule := make(map[string]int)
	for _, f := range rep.Findings {
		byRule[f.RuleID]++
		if strings.Contains(f.Message, fakeGH) {
			t.Fatalf("finding message leaked raw GitHub secret: %s", f.Message)
		}
	}

	expectedRules := []string{
		"SLT001", "SLT002", "SLT003", "SLT004", "SLT005",
		"SLT006", "SLT007", "SLT008", "SLT009", "SLT010",
	}
	for _, id := range expectedRules {
		if byRule[id] == 0 {
			t.Errorf("expected rule %s to trigger, counts=%v", id, byRule)
		}
	}
	if rep.ErrorCount == 0 || rep.WarningCount == 0 {
		t.Fatalf("expected non-zero error and warning counts, got errors=%d warnings=%d", rep.ErrorCount, rep.WarningCount)
	}
}

func TestAuditConfigProxyCommandOptionInjectionVsEndOfOptions(t *testing.T) {
	unsafe := "Host jump\n    ProxyCommand nc %h %p\n"
	repUnsafe := AuditConfig("unsafe", unsafe)
	if len(repUnsafe.Findings) != 1 || repUnsafe.Findings[0].RuleID != "SLT001" {
		t.Fatalf("expected SLT001 on unguarded nc %%h %%p, got %+v", repUnsafe.Findings)
	}

	safe := "Host jump\n    ProxyCommand exec nc -- %h %p\n"
	repSafe := AuditConfig("safe", safe)
	if len(repSafe.Findings) != 0 {
		t.Fatalf("expected 0 findings when '--' guards %%h %%p, got %+v", repSafe.Findings)
	}

	minusWeak := "Host modern\n    HostKeyAlgorithms -ssh-rsa,ssh-dss\n"
	repMinus := AuditConfig("minus", minusWeak)
	if len(repMinus.Findings) != 0 {
		t.Fatalf("expected 0 findings when removing weak algorithms with '-', got %+v", repMinus.Findings)
	}
}

func TestRedactTerminalOutputSecretsAndANSIColors(t *testing.T) {
	openAIKey := "sk-proj-" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
	awsID := "AKIAIOSFODNN7EXAMPLE"
	dbURL := "postgres://admin:s3cr3tP@ssw0rd@db.internal:5432/app"
	pemBlock := "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----"

	// Include both normal SGR wrapping and mid-token SGR highlighting.
	splitKey := "sk-proj-\x1b[33mAbCdEfGhIjKlMnOpQrSt\x1b[0mUvWxYz0123456789"

	transcript := strings.Join([]string{
		"\x1b[32mOPENAI_API_KEY=" + openAIKey + "\x1b[0m",
		"echo " + openAIKey,
		"AWS_ACCESS_KEY_ID=" + awsID,
		"DATABASE_URL=" + dbURL,
		"Authorization: Bearer superSecretSessionToken1234567890",
		"HIGHLIGHTED=" + splitKey,
		pemBlock,
	}, "\n")

	res := RedactTerminalOutput(transcript, RedactOptions{})
	if !res.Modified {
		t.Fatalf("expected Modified=true")
	}
	if strings.Contains(res.RedactedText, openAIKey) {
		t.Fatalf("redacted text leaked OpenAI key: %s", res.RedactedText)
	}
	if strings.Contains(res.RedactedText, "AbCdEfGhIjKlMnOpQrSt") {
		t.Fatalf("redacted text leaked ANSI-split OpenAI key: %s", res.RedactedText)
	}
	if strings.Contains(res.RedactedText, awsID) {
		t.Fatalf("redacted text leaked AWS key ID: %s", res.RedactedText)
	}
	if strings.Contains(res.RedactedText, "s3cr3tP") {
		t.Fatalf("redacted text leaked URL password: %s", res.RedactedText)
	}
	if strings.Contains(res.RedactedText, "b3BlbnNzaC1rZXk") {
		t.Fatalf("redacted text leaked PEM body: %s", res.RedactedText)
	}
	// Verify surrounding SGR color on line 1 is preserved.
	if !strings.Contains(res.RedactedText, "\x1b[32mOPENAI_API_KEY=[REDACTED:openai-api-key#") {
		t.Fatalf("expected surrounding ANSI SGR code to remain intact, got: %q", res.RedactedText)
	}
	// Verify correlation digest matches across lines 1, 2, and 6 (same underlying OpenAI key!).
	if res.CountsByLabel["openai-api-key"] != 3 {
		t.Fatalf("expected 3 openai-api-key redactions, got %v", res.CountsByLabel)
	}

	// Idempotence: re-redacting already-redacted text must be a no-op.
	second := RedactTerminalOutput(res.RedactedText, RedactOptions{})
	if second.Modified || second.RedactionCount != 0 || second.RedactedText != res.RedactedText {
		t.Fatalf("expected idempotent second pass, got modified=%v count=%d", second.Modified, second.RedactionCount)
	}
}

func TestBuildSARIFSchemaShape(t *testing.T) {
	rep := AuditConfig(".ssh/config", "Host *\n    StrictHostKeyChecking no\n    ProxyCommand sh -c \"nc %h %p\"\n")
	raw, err := BuildSARIF([]AuditReport{rep}, "0.22.0")
	if err != nil {
		t.Fatalf("BuildSARIF failed: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("invalid SARIF JSON: %v", err)
	}
	if parsed["version"] != "2.1.0" {
		t.Fatalf("unexpected SARIF version: %v", parsed["version"])
	}
	runs, ok := parsed["runs"].([]any)
	if !ok || len(runs) != 1 {
		t.Fatalf("expected 1 SARIF run")
	}
	run0 := runs[0].(map[string]any)
	results := run0["results"].([]any)
	if len(results) != 2 {
		t.Fatalf("expected 2 SARIF results, got %d", len(results))
	}
}
