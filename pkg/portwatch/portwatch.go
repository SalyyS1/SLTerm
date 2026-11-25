// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package portwatch provides SLTerm's lightweight, zero-dependency Localhost Dev-Server
// Port Radar. On Windows it queries `netstat -ano -p TCP` + `tasklist /FO CSV /NH` with
// CREATE_NO_WINDOW; on Unix it parses `ss -tlnp` (falling back to `lsof`).
package portwatch

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const defaultTimeout = 5 * time.Second

// ListeningPort describes one active local TCP listener.
type ListeningPort struct {
	Port        int    `json:"port"`
	Protocol    string `json:"protocol"`
	Address     string `json:"address"`
	PID         int    `json:"pid"`
	Process     string `json:"process"`
	URL         string `json:"url"`
	IsDevLikely bool   `json:"isDevLikely"`
}

// IsDevPort returns true for ports commonly used by local web, API, Vite/Next/Tauri, or LLM servers.
func IsDevPort(port int) bool {
	switch {
	case port >= 3000 && port <= 3999:
		return true
	case port >= 4000 && port <= 4999:
		return true
	case port >= 5000 && port <= 5999:
		return true
	case port >= 8000 && port <= 8999:
		return true
	case port >= 9000 && port <= 9999:
		return true
	case port == 1420 || port == 6006 || port == 7860 || port == 11434 || port == 25565:
		return true
	default:
		return false
	}
}

func runQuiet(ctx context.Context, name string, args ...string) (string, error) {
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), defaultTimeout)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, name, args...)
	hideWindow(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return out.String(), err
	}
	return out.String(), nil
}

// ListLocalPorts inspects currently listening TCP ports on the local machine.
func ListLocalPorts(ctx context.Context) ([]ListeningPort, error) {
	if runtime.GOOS == "windows" {
		raw, err := runQuiet(ctx, "netstat", "-ano", "-p", "TCP")
		if err != nil && strings.TrimSpace(raw) == "" {
			return nil, err
		}
		pidNames := make(map[int]string)
		if tl, err := runQuiet(ctx, "tasklist", "/FO", "CSV", "/NH"); err == nil {
			pidNames = ParseWindowsTasklistCSV(tl)
		}
		return ParseWindowsNetstat(raw, pidNames), nil
	}
	if raw, err := runQuiet(ctx, "ss", "-tlnp"); err == nil && strings.TrimSpace(raw) != "" {
		return ParseLinuxSS(raw), nil
	}
	if raw, err := runQuiet(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN"); err == nil && strings.TrimSpace(raw) != "" {
		return ParseLsof(raw), nil
	}
	return []ListeningPort{}, nil
}

// ParseWindowsTasklistCSV maps PID -> Image Name from `tasklist /FO CSV /NH`.
func ParseWindowsTasklistCSV(raw string) map[int]string {
	res := make(map[int]string)
	r := csv.NewReader(strings.NewReader(raw))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return res
	}
	for _, row := range rows {
		if len(row) < 2 {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(row[1]))
		if err != nil || pid <= 0 {
			continue
		}
		res[pid] = strings.TrimSpace(row[0])
	}
	return res
}

// ParseWindowsNetstat parses `netstat -ano -p TCP` output into normalized ListeningPort records.
func ParseWindowsNetstat(raw string, pidNames map[int]string) []ListeningPort {
	byPort := make(map[int]ListeningPort)
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		if !strings.EqualFold(fields[0], "TCP") || !strings.EqualFold(fields[3], "LISTENING") {
			continue
		}
		addr, port, ok := splitHostPortLoose(fields[1])
		if !ok || port <= 0 || port > 65535 {
			continue
		}
		pid, _ := strconv.Atoi(fields[4])
		proc := ""
		if pidNames != nil {
			proc = pidNames[pid]
		}
		upsertPort(byPort, ListeningPort{
			Port:        port,
			Protocol:    "tcp",
			Address:     addr,
			PID:         pid,
			Process:     proc,
			URL:         fmt.Sprintf("http://127.0.0.1:%d", port),
			IsDevLikely: IsDevPort(port),
		})
	}
	return sortPorts(byPort)
}

var ssProcRe = regexp.MustCompile(`"([^"]+)",pid=(\d+)`)

// ParseLinuxSS parses `ss -tlnp` output into normalized ListeningPort records.
func ParseLinuxSS(raw string) []ListeningPort {
	byPort := make(map[int]ListeningPort)
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || !strings.EqualFold(fields[0], "LISTEN") {
			continue
		}
		addr, port, ok := splitHostPortLoose(fields[3])
		if !ok || port <= 0 || port > 65535 {
			continue
		}
		proc := ""
		pid := 0
		if m := ssProcRe.FindStringSubmatch(line); len(m) == 3 {
			proc = m[1]
			pid, _ = strconv.Atoi(m[2])
		}
		upsertPort(byPort, ListeningPort{
			Port:        port,
			Protocol:    "tcp",
			Address:     addr,
			PID:         pid,
			Process:     proc,
			URL:         fmt.Sprintf("http://127.0.0.1:%d", port),
			IsDevLikely: IsDevPort(port),
		})
	}
	return sortPorts(byPort)
}

// ParseLsof parses `lsof -nP -iTCP -sTCP:LISTEN` output (macOS/Linux fallback).
func ParseLsof(raw string) []ListeningPort {
	byPort := make(map[int]ListeningPort)
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 9 || fields[0] == "COMMAND" {
			continue
		}
		pid, _ := strconv.Atoi(fields[1])
		nameField := fields[len(fields)-2]
		if strings.HasSuffix(fields[len(fields)-1], "(LISTEN)") {
			nameField = fields[len(fields)-2]
		} else {
			nameField = fields[len(fields)-1]
		}
		addr, port, ok := splitHostPortLoose(nameField)
		if !ok || port <= 0 || port > 65535 {
			continue
		}
		upsertPort(byPort, ListeningPort{
			Port:        port,
			Protocol:    "tcp",
			Address:     addr,
			PID:         pid,
			Process:     fields[0],
			URL:         fmt.Sprintf("http://127.0.0.1:%d", port),
			IsDevLikely: IsDevPort(port),
		})
	}
	return sortPorts(byPort)
}

func splitHostPortLoose(raw string) (string, int, bool) {
	idx := strings.LastIndex(raw, ":")
	if idx < 0 || idx+1 >= len(raw) {
		return "", 0, false
	}
	host := strings.Trim(raw[:idx], "[]")
	p, err := strconv.Atoi(raw[idx+1:])
	if err != nil {
		return "", 0, false
	}
	return host, p, true
}

func upsertPort(m map[int]ListeningPort, lp ListeningPort) {
	existing, ok := m[lp.Port]
	if !ok || (existing.Process == "" && lp.Process != "") {
		m[lp.Port] = lp
	}
}

func sortPorts(m map[int]ListeningPort) []ListeningPort {
	out := make([]ListeningPort, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDevLikely != out[j].IsDevLikely {
			return out[i].IsDevLikely
		}
		return out[i].Port < out[j].Port
	})
	return out
}

// ValidateKillTarget ensures only a live, verified local dev-server PID can be terminated.
// Refuses system PIDs (<= 4), SLTerm's own process, non-dev ports, and mismatched PIDs.
func ValidateKillTarget(ports []ListeningPort, port, pid, selfPID int) (*ListeningPort, error) {
	if port <= 0 || port > 65535 {
		return nil, errors.New("invalid port number")
	}
	if !IsDevPort(port) {
		return nil, fmt.Errorf("refusing to kill non-dev port %d", port)
	}
	if pid <= 4 || pid == selfPID {
		return nil, fmt.Errorf("refusing to kill protected or self PID %d", pid)
	}
	for i := range ports {
		if ports[i].Port == port && ports[i].PID == pid && ports[i].IsDevLikely {
			cp := ports[i]
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("no active dev server found listening on port %d with PID %d", port, pid)
}

// KillDevPort safely terminates a verified localhost dev server listening on (port, pid).
func KillDevPort(ctx context.Context, port, pid int) (*ListeningPort, error) {
	ports, err := ListLocalPorts(ctx)
	if err != nil {
		return nil, err
	}
	target, err := ValidateKillTarget(ports, port, pid, os.Getpid())
	if err != nil {
		return nil, err
	}
	if err := terminatePID(ctx, target.PID); err != nil {
		return nil, err
	}
	return target, nil
}
