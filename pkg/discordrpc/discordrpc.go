// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package discordrpc

import (
	"fmt"
	"log"
	"sync"
	"time"
)

// DiscordPresence represents the presence data to show on Discord
type DiscordPresence struct {
	Details    string `json:"details"`    // "Coding: my-project"
	State      string `json:"state"`      // "Pikachu ⚡ Lv.7 • 78%"
	LargeImage string `json:"largeImage"` // Theme icon key
	LargeText  string `json:"largeText"`  // Theme name
	SmallImage string `json:"smallImage"` // Pet icon key
	SmallText  string `json:"smallText"`  // Pet name
	StartTime  int64  `json:"startTime"`  // Unix timestamp
}

// Client manages the Discord RPC connection
type Client struct {
	mu         sync.RWMutex
	connected  bool
	appID      string
	presence   *DiscordPresence
	stopChan   chan struct{}
	lastUpdate time.Time
	debounceMs int64
}

const (
	// DefaultAppID - replace with actual Discord Application ID
	DefaultAppID = "YOUR_DISCORD_APP_ID"
	DebounceMs   = 15000 // 15 seconds minimum between updates
)

var (
	globalClient *Client
	clientMu     sync.Mutex
)

// GetClient returns the global Discord RPC client
func GetClient() *Client {
	clientMu.Lock()
	defer clientMu.Unlock()
	if globalClient == nil {
		globalClient = NewClient(DefaultAppID)
	}
	return globalClient
}

// NewClient creates a new Discord RPC client
func NewClient(appID string) *Client {
	return &Client{
		appID:      appID,
		stopChan:   make(chan struct{}),
		debounceMs: DebounceMs,
	}
}

// Connect attempts to connect to Discord IPC
func (c *Client) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// TODO: Implement actual Discord IPC connection
	// For now, just log and mark as connected for development
	log.Println("discord-rpc: connecting to Discord IPC...")

	// Will use named pipe on Windows: \\.\pipe\discord-ipc-0
	// Or unix socket on Linux/macOS: /tmp/discord-ipc-0

	c.connected = true
	log.Println("discord-rpc: connected (stub)")
	return nil
}

// Disconnect closes the Discord IPC connection
func (c *Client) Disconnect() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.connected = false
	log.Println("discord-rpc: disconnected")
}

// IsConnected returns whether Discord is connected
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// UpdatePresence sets the Discord Rich Presence
func (c *Client) UpdatePresence(presence *DiscordPresence) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.connected {
		return fmt.Errorf("not connected to Discord")
	}

	// Rate limiting: debounce updates
	now := time.Now()
	if now.Sub(c.lastUpdate).Milliseconds() < c.debounceMs {
		c.presence = presence // Queue for next update
		return nil
	}

	c.presence = presence
	c.lastUpdate = now

	// TODO: Send presence to Discord via IPC
	log.Printf("discord-rpc: updating presence - %s | %s", presence.Details, presence.State)

	return nil
}

// BuildPresence constructs a DiscordPresence from pet/session data
func BuildPresence(project string, petName string, petLevel int, petProgress float64, startTime int64) *DiscordPresence {
	details := "Using SLTerm"
	if project != "" {
		details = fmt.Sprintf("Coding: %s", project)
	}

	state := ""
	if petName != "" {
		state = fmt.Sprintf("%s ⚡ Lv.%d • %.0f%%", petName, petLevel, petProgress*100)
	}

	return &DiscordPresence{
		Details:    details,
		State:      state,
		LargeImage: "slterm_logo",
		LargeText:  "SLTerm",
		SmallImage: "pet_icon",
		SmallText:  petName,
		StartTime:  startTime,
	}
}

// Init starts the Discord RPC client (non-blocking)
func Init() {
	go func() {
		client := GetClient()
		if err := client.Connect(); err != nil {
			log.Printf("discord-rpc: failed to connect: %v (Discord may not be running)", err)
		}
	}()
}

// Shutdown gracefully stops the Discord RPC client
func Shutdown() {
	if globalClient != nil {
		globalClient.Disconnect()
	}
}
