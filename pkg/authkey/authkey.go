// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package authkey

import (
	"crypto/subtle"
	"fmt"
	"net/http"
	"os"
)

var authkey string

const WaveAuthKeyEnv = "SLTERM_AUTH_KEY"
const AuthKeyHeader = "X-AuthKey"

// AuthKeyQueryParam carries the key for requests that cannot set a header.
//
// Under Electron every request gets X-AuthKey injected by a session.webRequest
// handler. Neither Tauri nor Wails can do that, so subresource loads a webview
// issues on its own — <img>, <video>, markdown images, streaming preview — have
// no way to present a header. Those URLs carry the key as a query parameter
// instead.
const AuthKeyQueryParam = "authkey"

// ValidateIncomingRequest accepts the key from either the header or the query
// parameter. The comparison is constant-time: the key is a shared secret and a
// byte-wise early return leaks its prefix to anything that can time requests to
// the loopback listener.
func ValidateIncomingRequest(r *http.Request) error {
	reqAuthKey := r.Header.Get(AuthKeyHeader)
	source := AuthKeyHeader
	if reqAuthKey == "" {
		reqAuthKey = r.URL.Query().Get(AuthKeyQueryParam)
		source = AuthKeyQueryParam
	}
	if reqAuthKey == "" {
		return fmt.Errorf("no %s header or %s query param", AuthKeyHeader, AuthKeyQueryParam)
	}
	expected := GetAuthKey()
	if expected == "" {
		return fmt.Errorf("server auth key is not set")
	}
	if subtle.ConstantTimeCompare([]byte(reqAuthKey), []byte(expected)) != 1 {
		return fmt.Errorf("%s is invalid", source)
	}
	return nil
}

func SetAuthKeyFromEnv() error {
	authkey = os.Getenv(WaveAuthKeyEnv)
	if authkey == "" {
		return fmt.Errorf("no auth key found in environment variables")
	}
	os.Unsetenv(WaveAuthKeyEnv)
	return nil
}

func GetAuthKey() string {
	return authkey
}
