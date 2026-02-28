// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package petengine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/google/uuid"
)

var (
	globalStore *PetStore
	storeMu     sync.Mutex
)

// PetStore handles persistence of pet and profile data
type PetStore struct {
	mu      sync.RWMutex
	pet     *PetInstance
	profile *PlayerProfile
	dataDir string
}

// GetStore returns the global pet store singleton
func GetStore() *PetStore {
	storeMu.Lock()
	defer storeMu.Unlock()
	if globalStore == nil {
		globalStore = NewPetStore()
	}
	return globalStore
}

// NewPetStore creates a new pet store
func NewPetStore() *PetStore {
	configDir := wavebase.GetWaveDataDir()
	dataDir := filepath.Join(configDir, "pet")
	os.MkdirAll(dataDir, 0755)

	store := &PetStore{
		dataDir: dataDir,
	}
	store.Load()
	return store
}

// petFilePath returns the path to pet.json
func (s *PetStore) petFilePath() string {
	return filepath.Join(s.dataDir, "pet.json")
}

// profileFilePath returns the path to profile.json
func (s *PetStore) profileFilePath() string {
	return filepath.Join(s.dataDir, "profile.json")
}

// Load reads pet and profile data from disk
func (s *PetStore) Load() {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load pet
	petData, err := os.ReadFile(s.petFilePath())
	if err == nil {
		var pet PetInstance
		if json.Unmarshal(petData, &pet) == nil {
			s.pet = &pet
		}
	}

	// Load profile
	profileData, err := os.ReadFile(s.profileFilePath())
	if err == nil {
		var profile PlayerProfile
		if json.Unmarshal(profileData, &profile) == nil {
			s.profile = &profile
		}
	}

	// Initialize defaults if not loaded
	if s.profile == nil {
		s.profile = &PlayerProfile{
			CompletedPets: []string{},
			Achievements:  []string{},
			StreakDays:    0,
		}
	}
}

// Save writes pet and profile data to disk
func (s *PetStore) Save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.pet != nil {
		petData, err := json.MarshalIndent(s.pet, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal pet: %w", err)
		}
		if err := os.WriteFile(s.petFilePath(), petData, 0644); err != nil {
			return fmt.Errorf("write pet: %w", err)
		}
	}

	if s.profile != nil {
		profileData, err := json.MarshalIndent(s.profile, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal profile: %w", err)
		}
		if err := os.WriteFile(s.profileFilePath(), profileData, 0644); err != nil {
			return fmt.Errorf("write profile: %w", err)
		}
	}

	return nil
}

// GetPet returns the current pet instance
func (s *PetStore) GetPet() *PetInstance {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pet
}

// GetProfile returns the player profile
func (s *PetStore) GetProfile() *PlayerProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.profile
}

// SelectPet creates or switches to a new pet
func (s *PetStore) SelectPet(petID string, name string) *PetInstance {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.pet = &PetInstance{
		ID:        uuid.New().String(),
		PetID:     petID,
		Name:      name,
		Level:     1,
		XP:        0,
		XPToNext:  CalcXPToNext(1),
		Progress:  0,
		Mood:      MoodHappy,
		State:     StateActive,
		Hunger:    0,
		Energy:    1.0,
		SpawnedAt: time.Now(),
	}

	s.profile.ActivePetID = s.pet.ID
	return s.pet
}

// AddXP adds experience points and handles level ups
// Returns true if pet leveled up
func (s *PetStore) AddXP(amount int) (*PetInstance, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pet == nil {
		return nil, false
	}

	s.pet.XP += amount
	leveledUp := false

	// Level up loop
	for s.pet.XP >= s.pet.XPToNext && s.pet.Level < MaxLevel {
		s.pet.XP -= s.pet.XPToNext
		s.pet.Level++
		s.pet.XPToNext = CalcXPToNext(s.pet.Level)
		leveledUp = true
	}

	// Cap at max level
	if s.pet.Level >= MaxLevel {
		s.pet.XP = s.pet.XPToNext
	}

	// Update progress
	if s.pet.XPToNext > 0 {
		s.pet.Progress = float64(s.pet.XP) / float64(s.pet.XPToNext)
	}

	return s.pet, leveledUp
}

// UpdateMood updates the pet's mood based on hunger, energy, and time
func (s *PetStore) UpdateMood() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pet == nil {
		return
	}

	if s.pet.Hunger > 0.7 {
		s.pet.Mood = MoodHungry
	} else if s.pet.Energy < 0.3 {
		s.pet.Mood = MoodSleepy
	} else if s.pet.Energy > 0.7 && s.pet.Hunger < 0.3 {
		s.pet.Mood = MoodHappy
	} else {
		s.pet.Mood = MoodNeutral
	}
}

// UpdateState sets the pet's current state
func (s *PetStore) UpdateState(state string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pet != nil {
		s.pet.State = state
	}
}

// Interact handles user interactions (pet, feed)
func (s *PetStore) Interact(action string) *PetInstance {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pet == nil {
		return nil
	}

	switch action {
	case "pet":
		s.pet.Energy = min(1.0, s.pet.Energy+0.1)
		s.pet.Mood = MoodHappy
	case "feed":
		s.pet.Hunger = max(0, s.pet.Hunger-0.5)
		if s.pet.Mood == MoodHungry {
			s.pet.Mood = MoodHappy
		}
	}

	return s.pet
}

// UpdatePlaytime adds elapsed seconds to total playtime
func (s *PetStore) UpdatePlaytime(seconds int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pet != nil {
		s.pet.TotalPlaytime += seconds
	}
}

// IncrementCommands increments the total command count
func (s *PetStore) IncrementCommands() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.profile != nil {
		s.profile.TotalCommands++
	}
}

// CheckStreak checks and updates the daily streak
func (s *PetStore) CheckStreak() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.profile == nil {
		return
	}

	today := time.Now().Format("2006-01-02")
	if s.profile.LastActiveDate == today {
		return // Already counted today
	}

	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	if s.profile.LastActiveDate == yesterday {
		s.profile.StreakDays++
	} else if s.profile.LastActiveDate != "" {
		s.profile.StreakDays = 1 // Reset streak
	} else {
		s.profile.StreakDays = 1 // First day
	}

	s.profile.LastActiveDate = today
}

// SetCustomDialogues saves custom dialogues
func (s *PetStore) SetCustomDialogues(dialogues []CustomDialogue) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.profile != nil {
		s.profile.CustomDialogues = dialogues
	}
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
