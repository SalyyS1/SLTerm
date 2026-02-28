// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package petengine

// Package-level convenience functions that delegate to the global store/session

// GetCurrentPet returns the current pet instance
func GetCurrentPet() (*PetInstance, error) {
	pet := GetStore().GetPet()
	return pet, nil
}

// GetProfile returns the player profile
func GetProfile() (*PlayerProfile, error) {
	profile := GetStore().GetProfile()
	return profile, nil
}

// SelectPet creates or switches to a new pet
func SelectPet(petID string) (*PetInstance, error) {
	catalogue := GetCatalogue()
	name := petID
	for _, entry := range catalogue {
		if entry.ID == petID {
			name = entry.Name
			break
		}
	}
	pet := GetStore().SelectPet(petID, name)
	GetStore().Save()
	return pet, nil
}

// Interact handles user interaction (pet/feed)
func Interact(action string) (*PetInstance, error) {
	pet := GetStore().Interact(action)
	return pet, nil
}

// AddXP adds XP to the current pet
func AddXP(amount int) (*PetInstance, error) {
	pet, _ := GetStore().AddXP(amount)
	return pet, nil
}

// GetSessionData returns current session data
func GetSessionData() (*SessionData, error) {
	session := GetSessionTracker().GetSession()
	return &session, nil
}

// GetCatalogue returns the available pet catalogue
func GetCatalogue() []PetCatalogueEntry {
	// For now, return a built-in catalogue of starter Pokémon
	return []PetCatalogueEntry{
		{ID: "pikachu", Name: "Pikachu", Type: "pokemon", SpriteSheet: "pikachu.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "bulbasaur", Name: "Bulbasaur", Type: "pokemon", SpriteSheet: "bulbasaur.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "charmander", Name: "Charmander", Type: "pokemon", SpriteSheet: "charmander.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "squirtle", Name: "Squirtle", Type: "pokemon", SpriteSheet: "squirtle.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "eevee", Name: "Eevee", Type: "pokemon", SpriteSheet: "eevee.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "jigglypuff", Name: "Jigglypuff", Type: "pokemon", SpriteSheet: "jigglypuff.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "meowth", Name: "Meowth", Type: "pokemon", SpriteSheet: "meowth.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "snorlax", Name: "Snorlax", Type: "pokemon", SpriteSheet: "snorlax.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "gengar", Name: "Gengar", Type: "pokemon", SpriteSheet: "gengar.png", FrameWidth: 40, FrameHeight: 40},
		{ID: "mew", Name: "Mew", Type: "pokemon", SpriteSheet: "mew.png", FrameWidth: 40, FrameHeight: 40},
	}
}

// Init initializes the pet engine (called on server startup)
func Init() {
	// Initialize store (loads from disk)
	store := GetStore()

	// Auto-select Pikachu if no pet is active
	if store.GetPet() == nil {
		catalogue := GetCatalogue()
		if len(catalogue) > 0 {
			store.SelectPet(catalogue[0].ID, catalogue[0].Name)
			store.Save()
		}
	}

	// Initialize session tracker (starts goroutines)
	GetSessionTracker()
}

// Shutdown gracefully stops the pet engine
func Shutdown() {
	GetSessionTracker().Stop()
}
