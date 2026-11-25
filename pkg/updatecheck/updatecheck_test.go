// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package updatecheck

import "testing"

func TestSemVerAndReleaseParsing(t *testing.T) {
	if !IsNewer("0.28.0", "v0.29.0") {
		t.Fatal("expected v0.29.0 > 0.28.0")
	}
	if !IsNewer("0.28.0", "1.0.0") {
		t.Fatal("expected 1.0.0 > 0.28.0")
	}
	if IsNewer("0.29.0", "v0.29.0") {
		t.Fatal("expected equal versions not newer")
	}
	if IsNewer("0.29.0", "v0.28.5") {
		t.Fatal("expected older version not newer")
	}

	payload := []byte(`{
		"tag_name": "v0.30.0",
		"name": "SLTerm v0.30.0 — Rem Aqua ADE",
		"html_url": "https://github.com/SalyyS1/SLTerm/releases/tag/v0.30.0",
		"published_at": "2026-11-25T11:00:00Z",
		"body": "## Highlights\n- In-app GitHub update alerts\n- ADE status bar",
		"assets": [
			{"name": "SLTerm_0.30.0_x64-setup.exe", "browser_download_url": "https://github.com/SalyyS1/SLTerm/releases/download/v0.30.0/SLTerm_0.30.0_x64-setup.exe"},
			{"name": "SLTerm_0.30.0_aarch64.dmg", "browser_download_url": "https://github.com/SalyyS1/SLTerm/releases/download/v0.30.0/SLTerm_0.30.0_aarch64.dmg"}
		]
	}`)

	winInfo, err := ParseReleaseJSON("0.29.0", "windows", payload)
	if err != nil {
		t.Fatalf("ParseReleaseJSON failed: %v", err)
	}
	if !winInfo.UpdateAvailable || winInfo.LatestVersion != "0.30.0" {
		t.Fatalf("unexpected winInfo: %+v", winInfo)
	}
	if winInfo.DownloadURL != "https://github.com/SalyyS1/SLTerm/releases/download/v0.30.0/SLTerm_0.30.0_x64-setup.exe" {
		t.Fatalf("expected Windows setup.exe download URL, got %q", winInfo.DownloadURL)
	}

	macInfo, err := ParseReleaseJSON("0.29.0", "darwin", payload)
	if err != nil || macInfo.DownloadURL != "https://github.com/SalyyS1/SLTerm/releases/download/v0.30.0/SLTerm_0.30.0_aarch64.dmg" {
		t.Fatalf("expected macOS dmg download URL, got %+v err=%v", macInfo, err)
	}
}
