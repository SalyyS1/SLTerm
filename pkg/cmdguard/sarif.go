// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package cmdguard

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

type sarifLog struct {
	Schema  string     `json:"$schema"`
	Version string     `json:"version"`
	Runs    []sarifRun `json:"runs"`
}

type sarifRun struct {
	Tool        sarifTool         `json:"tool"`
	Invocations []sarifInvocation `json:"invocations"`
	Results     []sarifResult     `json:"results"`
}

type sarifTool struct {
	Driver sarifDriver `json:"driver"`
}

type sarifDriver struct {
	Name           string      `json:"name"`
	Version        string      `json:"version"`
	InformationURI string      `json:"informationUri"`
	Rules          []sarifRule `json:"rules"`
}

type sarifRule struct {
	ID                   string             `json:"id"`
	Name                 string             `json:"name"`
	ShortDescription     sarifMessage       `json:"shortDescription"`
	Help                 sarifMessage       `json:"help"`
	DefaultConfiguration sarifConfiguration `json:"defaultConfiguration"`
	Properties           sarifRuleProps     `json:"properties"`
}

type sarifConfiguration struct {
	Level string `json:"level"`
}

type sarifRuleProps struct {
	SecuritySeverity string   `json:"security-severity"`
	Tags             []string `json:"tags"`
}

type sarifMessage struct {
	Text string `json:"text"`
}

type sarifInvocation struct {
	ExecutionSuccessful bool `json:"executionSuccessful"`
}

type sarifResult struct {
	RuleID              string            `json:"ruleId"`
	RuleIndex           int               `json:"ruleIndex"`
	Level               string            `json:"level"`
	Message             sarifMessage      `json:"message"`
	Locations           []sarifLocation   `json:"locations"`
	PartialFingerprints map[string]string `json:"partialFingerprints"`
}

type sarifLocation struct {
	PhysicalLocation sarifPhysicalLocation `json:"physicalLocation"`
}

type sarifPhysicalLocation struct {
	ArtifactLocation sarifArtifactLocation `json:"artifactLocation"`
	Region           sarifRegion           `json:"region"`
}

type sarifArtifactLocation struct {
	URI string `json:"uri"`
}

type sarifRegion struct {
	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
}

// BuildSARIF serializes one or more command firewall reports into an OASIS SARIF
// v2.1.0 JSON document suitable for GitHub Code Scanning and CI pipelines.
func BuildSARIF(reports []AnalysisReport, version string) ([]byte, error) {
	if version == "" {
		version = "0.23.0"
	}

	rules := make([]sarifRule, 0, len(ruleCatalog))
	ruleIndexMap := make(map[string]int, len(ruleCatalog))
	for i, r := range ruleCatalog {
		ruleIndexMap[r.ID] = i
		rules = append(rules, sarifRule{
			ID:               r.ID,
			Name:             r.Name,
			ShortDescription: sarifMessage{Text: r.ShortDescription},
			Help:             sarifMessage{Text: r.Help},
			DefaultConfiguration: sarifConfiguration{
				Level: string(r.Severity),
			},
			Properties: sarifRuleProps{
				SecuritySeverity: r.SecuritySeverity,
				Tags:             []string{"security", "shell", "agent-firewall", strings.ToLower(r.CWE)},
			},
		})
	}

	results := make([]sarifResult, 0)
	for _, rep := range reports {
		uri := filepath.ToSlash(rep.Source)
		if uri == "" {
			uri = "inline"
		}
		for _, f := range rep.Findings {
			line := f.Line
			if line < 1 {
				line = 1
			}
			col := f.Column
			if col < 1 {
				col = 1
			}
			msg := f.Message
			if f.DecodedLayer != "" {
				msg = fmt.Sprintf("[layer: %s] %s", f.DecodedLayer, msg)
			}
			fpSeed := fmt.Sprintf("%s:%s:%d:%s:%s", uri, f.RuleID, line, f.Command, f.DecodedLayer)
			sum := sha256.Sum256([]byte(fpSeed))
			results = append(results, sarifResult{
				RuleID:    f.RuleID,
				RuleIndex: ruleIndexMap[f.RuleID],
				Level:     string(f.Severity),
				Message:   sarifMessage{Text: msg},
				Locations: []sarifLocation{
					{
						PhysicalLocation: sarifPhysicalLocation{
							ArtifactLocation: sarifArtifactLocation{URI: uri},
							Region: sarifRegion{
								StartLine:   line,
								StartColumn: col,
							},
						},
					},
				},
				PartialFingerprints: map[string]string{
					"primaryLocationLineHash": hex.EncodeToString(sum[:8]),
				},
			})
		}
	}

	doc := sarifLog{
		Schema:  "https://json.schemastore.org/sarif-2.1.0.json",
		Version: "2.1.0",
		Runs: []sarifRun{
			{
				Tool: sarifTool{
					Driver: sarifDriver{
						Name:           "slterm-cmdguard",
						Version:        version,
						InformationURI: "https://github.com/SalyyS1/SLTerm",
						Rules:          rules,
					},
				},
				Invocations: []sarifInvocation{
					{ExecutionSuccessful: true},
				},
				Results: results,
			},
		},
	}

	return json.MarshalIndent(doc, "", "  ")
}
