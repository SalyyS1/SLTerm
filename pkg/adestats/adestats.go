// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package adestats provides lightweight runtime telemetry for SLTerm's ADE Status Bar
// and Hub: Go sidecar heap/goroutine stats plus active local AI CLI & dev-tool process
// detection (Windows tasklist with CREATE_NO_WINDOW; Unix ps).
package adestats

import (
	"bytes"
	"context"
	"encoding/csv"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

var startedAt = time.Now()

// TrackedProcess represents one active local AI coding agent or dev build process.
type TrackedProcess struct {
	PID     int     `json:"pid"`
	Name    string  `json:"name"`
	Role    string  `json:"role"` // "agent" | "dev"
	RSSMB   float64 `json:"rssMb"`
}

// RuntimeStats summarizes SLTerm's lean sidecar footprint and active local AI/dev processes.
type RuntimeStats struct {
	SidecarHeapMB   float64          `json:"sidecarHeapMb"`
	SidecarSysMB    float64          `json:"sidecarSysMb"`
	Goroutines      int              `json:"goroutines"`
	UptimeSec       int64            `json:"uptimeSec"`
	Platform        string           `json:"platform"`
	ActiveAgents    int              `json:"activeAgents"`
	ActiveDevProcs  int              `json:"activeDevProcs"`
	Processes       []TrackedProcess `json:"processes"`
}

func classifyProcess(name string) (string, bool) {
	low := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(name), ".exe"))
	switch low {
	case "claude", "codex", "gemini", "opencode", "aider", "copilot":
		return "agent", true
	case "node", "bun", "deno", "vite", "cargo", "rustc", "go", "python", "python3", "uvicorn", "ollama":
		return "dev", true
	default:
		return "", false
	}
}

// ParseWindowsTasklist parses `tasklist /FO CSV /NH` into tracked AI & dev processes.
func ParseWindowsTasklist(raw string) []TrackedProcess {
	r := csv.NewReader(strings.NewReader(raw))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return nil
	}
	out := make([]TrackedProcess, 0)
	for _, row := range rows {
		if len(row) < 5 {
			continue
		}
		name := strings.TrimSpace(row[0])
		role, ok := classifyProcess(name)
		if !ok {
			continue
		}
		pid, _ := strconv.Atoi(strings.TrimSpace(row[1]))
		memStr := strings.NewReplacer(",", "", ".", "", " K", "", " KB", "", "k", "").Replace(strings.TrimSpace(row[4]))
		kb, _ := strconv.ParseFloat(strings.TrimSpace(memStr), 64)
		out = append(out, TrackedProcess{
			PID:   pid,
			Name:  name,
			Role:  role,
			RSSMB: round1(kb / 1024.0),
		})
	}
	sortTracked(out)
	return out
}

// ParseUnixPS parses `ps -eo pid=,rss=,comm=` into tracked AI & dev processes.
func ParseUnixPS(raw string) []TrackedProcess {
	out := make([]TrackedProcess, 0)
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		name := fields[2]
		role, ok := classifyProcess(name)
		if !ok {
			continue
		}
		pid, _ := strconv.Atoi(fields[0])
		kb, _ := strconv.ParseFloat(fields[1], 64)
		out = append(out, TrackedProcess{
			PID:   pid,
			Name:  name,
			Role:  role,
			RSSMB: round1(kb / 1024.0),
		})
	}
	sortTracked(out)
	return out
}

func sortTracked(list []TrackedProcess) {
	sort.Slice(list, func(i, j int) bool {
		if list[i].Role != list[j].Role {
			return list[i].Role == "agent"
		}
		return list[i].RSSMB > list[j].RSSMB
	})
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10.0
}

// Collect gathers live sidecar runtime stats and active AI/dev processes.
func Collect(ctx context.Context) *RuntimeStats {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
	}

	var procs []TrackedProcess
	if runtime.GOOS == "windows" {
		cmd := exec.CommandContext(ctx, "tasklist", "/FO", "CSV", "/NH")
		hideWindow(cmd)
		var out bytes.Buffer
		cmd.Stdout = &out
		if cmd.Run() == nil {
			procs = ParseWindowsTasklist(out.String())
		}
	} else {
		cmd := exec.CommandContext(ctx, "ps", "-eo", "pid=,rss=,comm=")
		var out bytes.Buffer
		cmd.Stdout = &out
		if cmd.Run() == nil {
			procs = ParseUnixPS(out.String())
		}
	}

	if len(procs) > 20 {
		procs = procs[:20]
	}
	agents, devs := 0, 0
	for _, p := range procs {
		if p.Role == "agent" {
			agents++
		} else {
			devs++
		}
	}

	return &RuntimeStats{
		SidecarHeapMB:  round1(float64(m.HeapAlloc) / (1024.0 * 1024.0)),
		SidecarSysMB:   round1(float64(m.Sys) / (1024.0 * 1024.0)),
		Goroutines:     runtime.NumGoroutine(),
		UptimeSec:      int64(time.Since(startedAt).Seconds()),
		Platform:       runtime.GOOS + "/" + runtime.GOARCH,
		ActiveAgents:   agents,
		ActiveDevProcs: devs,
		Processes:      procs,
	}
}
