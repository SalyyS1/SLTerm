// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCorsMiddlewareAllowsTheShellOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := corsMiddleware(next)

	for _, origin := range []string{"tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/wave/file", nil)
		req.Header.Set("Origin", origin)
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("origin %q: allow-origin = %q, want %q", origin, got, origin)
		}
		if rec.Code != http.StatusTeapot {
			t.Errorf("origin %q: request did not reach the route (code %d)", origin, rec.Code)
		}
	}
}

func TestCorsMiddlewareRefusesAnUnknownOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := corsMiddleware(next)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/wave/file", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("allow-origin = %q, want empty", got)
	}
	// The request still runs: the auth key, not the origin, is what guards it.
	if rec.Code != http.StatusTeapot {
		t.Errorf("request did not reach the route (code %d)", rec.Code)
	}
}

func TestCorsMiddlewareAnswersThePreflightItself(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("preflight reached the route, which has no auth header to check")
	})
	h := corsMiddleware(next)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/wave/service", nil)
	req.Header.Set("Origin", "tauri://localhost")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Errorf("preflight status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Error("preflight did not advertise the allowed headers")
	}
}

func TestCorsMiddlewareIgnoresSameOriginRequests(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := corsMiddleware(next)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/wave/file", nil)
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("allow-origin = %q, want empty for a request with no Origin", got)
	}
	if rec.Code != http.StatusTeapot {
		t.Errorf("request did not reach the route (code %d)", rec.Code)
	}
}
