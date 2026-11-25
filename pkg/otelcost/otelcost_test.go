// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package otelcost

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCollectorAccumulatesDeltaMetrics(t *testing.T) {
	c := NewCollector()
	payload := `{
		"resourceMetrics": [{
			"resource": { "attributes": [{ "key": "terminal.id", "value": { "stringValue": "blk-1" } }] },
			"scopeMetrics": [{
				"metrics": [
					{
						"name": "claude_code.cost.usage",
						"sum": { "dataPoints": [{ "asDouble": 0.125, "attributes": [{ "key": "session.id", "value": { "stringValue": "s-42" } }] }] }
					},
					{
						"name": "claude_code.token.usage",
						"sum": { "dataPoints": [
							{ "asInt": "1200", "attributes": [{ "key": "type", "value": { "stringValue": "input" } }] },
							{ "asInt": "350", "attributes": [{ "key": "type", "value": { "stringValue": "output" } }] },
							{ "asInt": "5000", "attributes": [{ "key": "type", "value": { "stringValue": "cacheRead" } }] }
						]}
					}
				]
			}]
		}]
	}`

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/slterm/otlp/v1/metrics", bytes.NewBufferString(payload))
		rec := httptest.NewRecorder()
		c.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	}

	snap := c.Snapshot()
	if snap.TotalCostUSD < 0.249 || snap.TotalCostUSD > 0.251 {
		t.Fatalf("expected delta-summed cost ~0.25, got %v", snap.TotalCostUSD)
	}
	if snap.TotalInputTokens != 2400 || snap.TotalOutputTokens != 700 || snap.TotalCacheTokens != 10000 {
		t.Fatalf("unexpected token totals: %+v", snap)
	}
	if len(snap.Blocks) != 1 || snap.Blocks[0].SessionID != "s-42" {
		t.Fatalf("unexpected blocks: %+v", snap.Blocks)
	}
}

func TestBudgetAlertAndReset(t *testing.T) {
	c := NewCollector()
	alerts := 0
	c.SetBudget(0.20)
	c.SetOnBudgetExceeded(func(total, budget float64) {
		alerts++
	})

	payload := []byte(`{"resourceMetrics":[{"resource":{"attributes":[{"key":"terminal.id","value":{"stringValue":"blk-budget"}}]},"scopeMetrics":[{"metrics":[{"name":"claude_code.cost.usage","sum":{"dataPoints":[{"asDouble":0.15}]}}]}]}]}`)

	if err := c.IngestJSON(payload); err != nil {
		t.Fatal(err)
	}
	if snap := c.Snapshot(); snap.BudgetExceeded || alerts != 0 {
		t.Fatalf("expected under budget, got %+v alerts=%d", snap, alerts)
	}
	if err := c.IngestJSON(payload); err != nil {
		t.Fatal(err)
	}
	if err := c.IngestJSON(payload); err != nil {
		t.Fatal(err)
	}
	if snap := c.Snapshot(); !snap.BudgetExceeded || alerts != 1 {
		t.Fatalf("expected budget exceeded once, got %+v alerts=%d", snap, alerts)
	}

	c.Reset()
	if snap := c.Snapshot(); snap.TotalCostUSD != 0 || snap.BudgetExceeded || snap.BudgetUSD != 0.20 {
		t.Fatalf("expected reset counters keeping budget, got %+v", snap)
	}
}
