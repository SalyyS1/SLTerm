// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package otelcost implements a lightweight local OTLP/JSON HTTP metrics receiver
// for SLTerm's per-block & global AI agent token/cost HUD (Phase 4.7).
//
// Claude Code and Codex emit DELTA-temporality metrics (`claude_code.cost.usage`,
// `claude_code.token.usage`, etc.) tagged with `terminal.id` / `session.id`.
// Collector accumulates deltas thread-safely in memory with zero external deps.
package otelcost

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// BlockUsage holds accumulated token & USD cost counters for one terminal block or session.
type BlockUsage struct {
	BlockID      string  `json:"blockId"`
	SessionID    string  `json:"sessionId,omitempty"`
	CostUSD      float64 `json:"costUsd"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	CacheTokens  int64   `json:"cacheTokens"`
	UpdatedAtMs  int64   `json:"updatedAtMs"`
}

// Snapshot is the aggregated cost/token telemetry returned to the ADE Hub UI.
type Snapshot struct {
	TotalCostUSD      float64      `json:"totalCostUsd"`
	TotalInputTokens  int64        `json:"totalInputTokens"`
	TotalOutputTokens int64        `json:"totalOutputTokens"`
	TotalCacheTokens  int64        `json:"totalCacheTokens"`
	BudgetUSD         float64      `json:"budgetUsd"`
	BudgetExceeded    bool         `json:"budgetExceeded"`
	Blocks            []BlockUsage `json:"blocks"`
}

type Collector struct {
	mu               sync.RWMutex
	blocks           map[string]*BlockUsage
	budgetUSD        float64
	budgetAlertFired bool
	onBudgetExceeded func(totalUSD, budgetUSD float64)
}

var defaultCollector = NewCollector()

func DefaultCollector() *Collector {
	return defaultCollector
}

func NewCollector() *Collector {
	return &Collector{blocks: make(map[string]*BlockUsage)}
}

// ServeHTTP handles POST /slterm/otlp/v1/metrics with OTLP/JSON payloads.
func (c *Collector) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2*1024*1024))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	if err := c.IngestJSON(body); err != nil {
		http.Error(w, "invalid OTLP JSON", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"partialSuccess":{}}`))
}

type otlpPayload struct {
	ResourceMetrics []struct {
		Resource struct {
			Attributes []otlpAttr `json:"attributes"`
		} `json:"resource"`
		ScopeMetrics []struct {
			Metrics []struct {
				Name string `json:"name"`
				Sum  *struct {
					DataPoints []otlpPoint `json:"dataPoints"`
				} `json:"sum"`
				Gauge *struct {
					DataPoints []otlpPoint `json:"dataPoints"`
				} `json:"gauge"`
			} `json:"metrics"`
		} `json:"scopeMetrics"`
	} `json:"resourceMetrics"`
}

type otlpAttr struct {
	Key   string `json:"key"`
	Value struct {
		StringValue string `json:"stringValue"`
	} `json:"value"`
}

type otlpPoint struct {
	AsDouble   *float64   `json:"asDouble"`
	AsInt      any        `json:"asInt"`
	Attributes []otlpAttr `json:"attributes"`
}

func attrMap(attrs []otlpAttr) map[string]string {
	m := make(map[string]string, len(attrs))
	for _, a := range attrs {
		m[a.Key] = a.Value.StringValue
	}
	return m
}

func pointVal(pt otlpPoint) float64 {
	if pt.AsDouble != nil {
		return *pt.AsDouble
	}
	switch v := pt.AsInt.(type) {
	case float64:
		return v
	case string:
		var parsed float64
		_ = json.Unmarshal([]byte(v), &parsed)
		return parsed
	}
	return 0
}

// IngestJSON parses an OTLP/JSON metrics request and accumulates DELTA values per block/session.
func (c *Collector) IngestJSON(raw []byte) error {
	var p otlpPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	var notifyFn func(float64, float64)
	var notifyTotal, notifyBudget float64

	c.mu.Lock()
	for _, rm := range p.ResourceMetrics {
		resAttrs := attrMap(rm.Resource.Attributes)
		blockID := resAttrs["terminal.id"]
		sessionID := resAttrs["session.id"]
		if blockID == "" {
			blockID = sessionID
		}
		if blockID == "" {
			blockID = "global"
		}
		entry, ok := c.blocks[blockID]
		if !ok {
			entry = &BlockUsage{BlockID: blockID, SessionID: sessionID}
			c.blocks[blockID] = entry
		}
		if sessionID != "" {
			entry.SessionID = sessionID
		}

		for _, sm := range rm.ScopeMetrics {
			for _, m := range sm.Metrics {
				name := strings.ToLower(m.Name)
				var pts []otlpPoint
				if m.Sum != nil {
					pts = append(pts, m.Sum.DataPoints...)
				}
				if m.Gauge != nil {
					pts = append(pts, m.Gauge.DataPoints...)
				}
				for _, pt := range pts {
					val := pointVal(pt)
					if val <= 0 {
						continue
					}
					ptAttrs := attrMap(pt.Attributes)
					if sid := ptAttrs["session.id"]; sid != "" {
						entry.SessionID = sid
					}
					switch {
					case strings.Contains(name, "cost"):
						entry.CostUSD += val
					case strings.Contains(name, "token"):
						tokType := strings.ToLower(ptAttrs["type"])
						switch {
						case strings.Contains(tokType, "output"):
							entry.OutputTokens += int64(val)
						case strings.Contains(tokType, "cache"):
							entry.CacheTokens += int64(val)
						default:
							entry.InputTokens += int64(val)
						}
					}
					entry.UpdatedAtMs = now
				}
			}
		}
	}
	if c.budgetUSD > 0 && !c.budgetAlertFired {
		total := 0.0
		for _, b := range c.blocks {
			total += b.CostUSD
		}
		if total > c.budgetUSD {
			c.budgetAlertFired = true
			notifyFn = c.onBudgetExceeded
			notifyTotal = total
			notifyBudget = c.budgetUSD
		}
	}
	c.mu.Unlock()

	if notifyFn != nil {
		notifyFn(notifyTotal, notifyBudget)
	}
	return nil
}

// SetBudget configures a session USD cost guard (<= 0 disables the guard).
func (c *Collector) SetBudget(usd float64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if usd <= 0 {
		c.budgetUSD = 0
		c.budgetAlertFired = false
		return
	}
	c.budgetUSD = usd
	total := 0.0
	for _, b := range c.blocks {
		total += b.CostUSD
	}
	c.budgetAlertFired = total > usd
}

// SetOnBudgetExceeded registers a callback invoked once when session spend crosses BudgetUSD.
func (c *Collector) SetOnBudgetExceeded(fn func(totalUSD, budgetUSD float64)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onBudgetExceeded = fn
}

// Reset clears accumulated cost and token counters while keeping the configured budget.
func (c *Collector) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.blocks = make(map[string]*BlockUsage)
	c.budgetAlertFired = false
}

// Snapshot returns a point-in-time copy of accumulated costs and tokens.
func (c *Collector) Snapshot() Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	snap := Snapshot{
		BudgetUSD: c.budgetUSD,
		Blocks:    make([]BlockUsage, 0, len(c.blocks)),
	}
	for _, b := range c.blocks {
		snap.TotalCostUSD += b.CostUSD
		snap.TotalInputTokens += b.InputTokens
		snap.TotalOutputTokens += b.OutputTokens
		snap.TotalCacheTokens += b.CacheTokens
		snap.Blocks = append(snap.Blocks, *b)
	}
	snap.BudgetExceeded = snap.BudgetUSD > 0 && snap.TotalCostUSD > snap.BudgetUSD
	return snap
}
