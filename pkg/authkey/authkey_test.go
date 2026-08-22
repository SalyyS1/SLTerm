// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package authkey

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func withKey(t *testing.T, key string) {
	t.Helper()
	prev := authkey
	authkey = key
	t.Cleanup(func() { authkey = prev })
}

func TestHeaderIsAccepted(t *testing.T) {
	withKey(t, "secret-key")
	r := httptest.NewRequest(http.MethodGet, "/wave/file", nil)
	r.Header.Set(AuthKeyHeader, "secret-key")
	if err := ValidateIncomingRequest(r); err != nil {
		t.Errorf("valid header rejected: %v", err)
	}
}

func TestQueryParamIsAccepted(t *testing.T) {
	withKey(t, "secret-key")
	// Tauri and Wails cannot inject a header the way Electron's
	// session.webRequest does, so subresource loads carry the key in the URL.
	r := httptest.NewRequest(http.MethodGet, "/wave/stream-file?path=x&"+AuthKeyQueryParam+"=secret-key", nil)
	if err := ValidateIncomingRequest(r); err != nil {
		t.Errorf("valid query param rejected: %v", err)
	}
}

func TestHeaderWinsOverQueryParam(t *testing.T) {
	withKey(t, "secret-key")
	r := httptest.NewRequest(http.MethodGet, "/wave/file?"+AuthKeyQueryParam+"=wrong", nil)
	r.Header.Set(AuthKeyHeader, "secret-key")
	if err := ValidateIncomingRequest(r); err != nil {
		t.Errorf("a valid header should be honored even with a bad query param: %v", err)
	}
}

func TestWrongAndMissingKeysAreRejected(t *testing.T) {
	withKey(t, "secret-key")
	cases := []struct {
		name string
		url  string
		hdr  string
	}{
		{"no credentials at all", "/wave/file", ""},
		{"wrong header", "/wave/file", "nope"},
		{"wrong query param", "/wave/file?" + AuthKeyQueryParam + "=nope", ""},
		{"empty query param", "/wave/file?" + AuthKeyQueryParam + "=", ""},
		// A prefix must not pass; this is what the constant-time compare guards.
		{"prefix of the real key", "/wave/file?" + AuthKeyQueryParam + "=secret", ""},
		{"real key plus suffix", "/wave/file?" + AuthKeyQueryParam + "=secret-key-extra", ""},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, c.url, nil)
		if c.hdr != "" {
			r.Header.Set(AuthKeyHeader, c.hdr)
		}
		if err := ValidateIncomingRequest(r); err == nil {
			t.Errorf("%s: should have been rejected", c.name)
		}
	}
}

func TestUnsetServerKeyRejectsEverything(t *testing.T) {
	withKey(t, "")
	// Before SetAuthKeyFromEnv runs there is no key. An empty stored key must
	// not make an empty presented key valid.
	r := httptest.NewRequest(http.MethodGet, "/wave/file?"+AuthKeyQueryParam+"=", nil)
	if err := ValidateIncomingRequest(r); err == nil {
		t.Error("an unset server key must reject requests")
	}
	r2 := httptest.NewRequest(http.MethodGet, "/wave/file", nil)
	r2.Header.Set(AuthKeyHeader, "anything")
	if err := ValidateIncomingRequest(r2); err == nil {
		t.Error("an unset server key must reject a presented key")
	}
}
