// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package petengine

import "time"

// PetInstance — the active pet being raised
type PetInstance struct {
	ID            string    `json:"id"`
	PetID         string    `json:"petId"`
	Name          string    `json:"name"`
	Level         int       `json:"level"`
	XP            int       `json:"xp"`
	XPToNext      int       `json:"xpToNext"`
	Progress      float64   `json:"progress"` // 0.0 - 1.0
	Mood          string    `json:"mood"`     // happy, neutral, sad, hungry, sleepy
	State         string    `json:"state"`    // ACTIVE, IDLE, SLEEPING, CELEBRATING, GRABBED
	Hunger        float64   `json:"hunger"`   // 0.0 (sated) - 1.0 (starving)
	Energy        float64   `json:"energy"`   // 0.0 (exhausted) - 1.0 (full)
	SpawnedAt     time.Time `json:"spawnedAt"`
	TotalPlaytime int64     `json:"totalPlaytime"` // seconds
}

// PlayerProfile — player progression data
type PlayerProfile struct {
	ActivePetID     string           `json:"activePetId"`
	CompletedPets   []string         `json:"completedPets"`
	StreakDays      int              `json:"streakDays"`
	LastActiveDate  string           `json:"lastActiveDate"` // YYYY-MM-DD
	TotalFocusTime  int64            `json:"totalFocusTime"` // seconds
	TotalCommands   int              `json:"totalCommands"`
	Achievements    []string         `json:"achievements"`
	CustomDialogues []CustomDialogue `json:"customDialogues,omitempty"`
}

// CustomDialogue — user-defined pet dialogue
type CustomDialogue struct {
	ID       string `json:"id"`
	TextVI   string `json:"textVi"`
	TextEN   string `json:"textEn"`
	Mood     string `json:"mood,omitempty"`     // show only for this mood, empty = all
	TimeFrom int    `json:"timeFrom,omitempty"` // show from this hour (0-23), 0 = anytime
	TimeTo   int    `json:"timeTo,omitempty"`
}

// SessionData — current session (not persisted across restarts)
type SessionData struct {
	StartedAt        time.Time `json:"startedAt"`
	ActiveTime       int64     `json:"activeTime"` // seconds
	CommandCount     int       `json:"commandCount"`
	IdleSince        time.Time `json:"idleSince"`
	IsIdle           bool      `json:"isIdle"`
	CurrentProject   string    `json:"currentProject"`
	DiscordConnected bool      `json:"discordConnected"`
}

// PetCatalogueEntry — metadata for a pet type
type PetCatalogueEntry struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	SpriteSheet     string             `json:"spriteSheet"`
	FrameWidth      int                `json:"frameWidth"`
	FrameHeight     int                `json:"frameHeight"`
	Animations      map[string]AnimDef `json:"animations"`
	Type            string             `json:"type"` // pokemon, shimeji, custom
	DiscordAssetKey string             `json:"discordAssetKey"`
}

// AnimDef — animation frame definition
type AnimDef struct {
	Frames []int `json:"frames"`
	FPS    int   `json:"fps"`
	Loop   bool  `json:"loop"`
}

// XP and leveling constants
const (
	MaxLevel           = 10
	XPPerMinute        = 2
	XPPerCommand       = 5
	XPPerFocusSession  = 50
	XPStreakMultiplier = 25
	IdleTimeoutSec     = 300 // 5 minutes
	SaveIntervalSec    = 30

	MoodHappy   = "happy"
	MoodNeutral = "neutral"
	MoodSad     = "sad"
	MoodHungry  = "hungry"
	MoodSleepy  = "sleepy"

	StateActive      = "ACTIVE"
	StateIdle        = "IDLE"
	StateSleeping    = "SLEEPING"
	StateCelebrating = "CELEBRATING"
	StateGrabbed     = "GRABBED"
)

// CalcXPToNext returns XP needed for the next level
// Formula: 100 * level * 1.5
func CalcXPToNext(level int) int {
	return int(float64(100*level) * 1.5)
}
