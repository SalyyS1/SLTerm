// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package updatecheck provides SLTerm's zero-dependency GitHub Releases update notifier.
// Queries `https://api.github.com/repos/SalyyS1/SLTerm/releases/latest` over HTTPS with a
// short timeout and 10-minute in-memory cache, compares SemVer against the running version,
// and resolves the best platform download asset (Windows NSIS/zip, macOS dmg, Linux deb/AppImage).
package updatecheck

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultAPIURL    = "https://api.github.com/repos/SalyyS1/SLTerm/releases/latest"
	AllowedURLPrefix = "https://github.com/SalyyS1/SLTerm/"
	cacheTTL         = 10 * time.Minute
)

// UpdateInfo describes the latest SLTerm GitHub Release relative to the running build.
type UpdateInfo struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseName     string `json:"releaseName"`
	ReleaseURL      string `json:"releaseUrl"`
	DownloadURL     string `json:"downloadUrl,omitempty"`
	PublishedAt     string `json:"publishedAt,omitempty"`
	NotesPreview    string `json:"notesPreview,omitempty"`
	CheckedAtMs     int64  `json:"checkedAtMs"`
}

type githubReleasePayload struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Body        string `json:"body"`
	Assets      []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

var (
	cacheMu     sync.Mutex
	cachedInfo  *UpdateInfo
	cachedAt    time.Time
)

// ParseSemVer parses "v0.29.0", "0.29.0-beta.1", etc. into (major, minor, patch).
func ParseSemVer(raw string) (int, int, int, bool) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "v"), "V")
	if idx := strings.IndexAny(s, "-+"); idx >= 0 {
		s = s[:idx]
	}
	parts := strings.Split(s, ".")
	if len(parts) == 0 || parts[0] == "" {
		return 0, 0, 0, false
	}
	maj, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, 0, false
	}
	min, pat := 0, 0
	if len(parts) >= 2 {
		min, err = strconv.Atoi(parts[1])
		if err != nil {
			return 0, 0, 0, false
		}
	}
	if len(parts) >= 3 {
		pat, err = strconv.Atoi(parts[2])
		if err != nil {
			return 0, 0, 0, false
		}
	}
	return maj, min, pat, true
}

// IsNewer returns true strictly when latest > current numerically.
func IsNewer(current, latest string) bool {
	cMaj, cMin, cPat, okC := ParseSemVer(current)
	lMaj, lMin, lPat, okL := ParseSemVer(latest)
	if !okC || !okL {
		return false
	}
	if lMaj != cMaj {
		return lMaj > cMaj
	}
	if lMin != cMin {
		return lMin > cMin
	}
	return lPat > cPat
}

// ParseReleaseJSON converts a GitHub Releases API response into an UpdateInfo for targetOS.
func ParseReleaseJSON(currentVersion, targetOS string, body []byte) (*UpdateInfo, error) {
	var payload githubReleasePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("invalid GitHub release JSON: %w", err)
	}
	if strings.TrimSpace(payload.TagName) == "" {
		return nil, errors.New("missing tag_name in release payload")
	}
	cur := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(currentVersion), "v"), "V")
	lat := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(payload.TagName), "v"), "V")

	releaseURL := strings.TrimSpace(payload.HTMLURL)
	if !strings.HasPrefix(releaseURL, AllowedURLPrefix) {
		releaseURL = AllowedURLPrefix + "releases"
	}

	dlURL := pickPlatformAsset(payload, targetOS)
	notesLines := make([]string, 0, 4)
	for _, ln := range strings.Split(payload.Body, "\n") {
		t := strings.TrimSpace(ln)
		if t != "" {
			notesLines = append(notesLines, t)
			if len(notesLines) == 4 {
				break
			}
		}
	}

	return &UpdateInfo{
		CurrentVersion:  cur,
		LatestVersion:   lat,
		UpdateAvailable: IsNewer(cur, lat),
		ReleaseName:     strings.TrimSpace(payload.Name),
		ReleaseURL:      releaseURL,
		DownloadURL:     dlURL,
		PublishedAt:     payload.PublishedAt,
		NotesPreview:    strings.Join(notesLines, "\n"),
		CheckedAtMs:     time.Now().UnixMilli(),
	}, nil
}

func pickPlatformAsset(p githubReleasePayload, goos string) string {
	var fallback string
	for _, a := range p.Assets {
		u := strings.TrimSpace(a.BrowserDownloadURL)
		if !strings.HasPrefix(u, AllowedURLPrefix) {
			continue
		}
		name := strings.ToLower(a.Name)
		switch goos {
		case "windows":
			if strings.HasSuffix(name, "-setup.exe") || strings.HasSuffix(name, ".exe") {
				return u
			}
			if strings.Contains(name, "win") && strings.HasSuffix(name, ".zip") {
				fallback = u
			}
		case "darwin":
			if strings.HasSuffix(name, ".dmg") {
				return u
			}
		default:
			if strings.HasSuffix(name, ".appimage") || strings.HasSuffix(name, ".deb") {
				return u
			}
		}
	}
	return fallback
}

// CheckLatest fetches the latest GitHub Release for SLTerm (with 10-min cache unless force=true).
func CheckLatest(ctx context.Context, currentVersion string, force bool) (*UpdateInfo, error) {
	if !force {
		cacheMu.Lock()
		if cachedInfo != nil && time.Since(cachedAt) < cacheTTL && cachedInfo.CurrentVersion == strings.TrimPrefix(currentVersion, "v") {
			cp := *cachedInfo
			cacheMu.Unlock()
			return &cp, nil
		}
		cacheMu.Unlock()
	}

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 6*time.Second)
		defer cancel()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, DefaultAPIURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "SLTerm-Updater/"+currentVersion)

	client := &http.Client{Timeout: 6 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("github releases API returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}

	info, err := ParseReleaseJSON(currentVersion, runtime.GOOS, body)
	if err != nil {
		return nil, err
	}
	cacheMu.Lock()
	cp := *info
	cachedInfo = &cp
	cachedAt = time.Now()
	cacheMu.Unlock()
	return info, nil
}
