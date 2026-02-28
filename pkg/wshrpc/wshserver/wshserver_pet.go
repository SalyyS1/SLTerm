// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package wshserver

// Pet System RPC command handlers
// These implement the WshRpcInterface pet commands defined in wshrpctypes.go

import (
	"context"
	"fmt"

	"github.com/SalyyS1/SLTerm/pkg/petengine"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc"
)

func (ws *WshServer) PetGetStateCommand(ctx context.Context) (*wshrpc.PetStateData, error) {
	pet, err := petengine.GetCurrentPet()
	if err != nil {
		return nil, fmt.Errorf("error getting pet state: %w", err)
	}
	if pet == nil {
		return nil, nil
	}
	return petInstanceToRPC(pet), nil
}

func (ws *WshServer) PetGetProfileCommand(ctx context.Context) (*wshrpc.PetProfileData, error) {
	profile, err := petengine.GetProfile()
	if err != nil {
		return nil, fmt.Errorf("error getting profile: %w", err)
	}
	if profile == nil {
		return nil, nil
	}
	return &wshrpc.PetProfileData{
		ActivePetID:    profile.ActivePetID,
		CompletedPets:  profile.CompletedPets,
		StreakDays:     profile.StreakDays,
		LastActiveDate: profile.LastActiveDate,
		TotalFocusTime: profile.TotalFocusTime,
		TotalCommands:  profile.TotalCommands,
		Achievements:   profile.Achievements,
	}, nil
}

func (ws *WshServer) PetGetSessionCommand(ctx context.Context) (*wshrpc.PetSessionData, error) {
	session, err := petengine.GetSessionData()
	if err != nil {
		return nil, fmt.Errorf("error getting session: %w", err)
	}
	return &wshrpc.PetSessionData{
		StartedAt:        session.StartedAt.Format("2006-01-02T15:04:05Z"),
		ActiveTime:       session.ActiveTime,
		CommandCount:     session.CommandCount,
		IsIdle:           session.IsIdle,
		CurrentProject:   session.CurrentProject,
		DiscordConnected: session.DiscordConnected,
	}, nil
}

func (ws *WshServer) PetSelectPetCommand(ctx context.Context, data wshrpc.PetSelectData) (*wshrpc.PetStateData, error) {
	if data.PetID == "" {
		return nil, fmt.Errorf("petId is required")
	}
	pet, err := petengine.SelectPet(data.PetID)
	if err != nil {
		return nil, fmt.Errorf("error selecting pet: %w", err)
	}
	return petInstanceToRPC(pet), nil
}

func (ws *WshServer) PetInteractCommand(ctx context.Context, data wshrpc.PetInteractData) (*wshrpc.PetStateData, error) {
	if data.Action == "" {
		return nil, fmt.Errorf("action is required")
	}
	pet := petengine.GetStore().Interact(data.Action)
	if pet == nil {
		return nil, fmt.Errorf("no pet active")
	}
	return petInstanceToRPC(pet), nil
}

func (ws *WshServer) PetAddXPCommand(ctx context.Context, data wshrpc.PetXPData) (*wshrpc.PetStateData, error) {
	if data.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	pet, err := petengine.AddXP(data.Amount)
	if err != nil {
		return nil, fmt.Errorf("error adding XP: %w", err)
	}
	return petInstanceToRPC(pet), nil
}

func (ws *WshServer) PetGetCatalogueCommand(ctx context.Context) ([]wshrpc.PetCatalogueEntryData, error) {
	catalogue := petengine.GetCatalogue()
	rtn := make([]wshrpc.PetCatalogueEntryData, len(catalogue))
	for i, entry := range catalogue {
		rtn[i] = wshrpc.PetCatalogueEntryData{
			ID:              entry.ID,
			Name:            entry.Name,
			SpriteSheet:     entry.SpriteSheet,
			FrameWidth:      entry.FrameWidth,
			FrameHeight:     entry.FrameHeight,
			Type:            entry.Type,
			DiscordAssetKey: entry.DiscordAssetKey,
		}
	}
	return rtn, nil
}

func (ws *WshServer) PetGetDialogueCommand(ctx context.Context, data wshrpc.PetDialogueRequestData) (*wshrpc.PetDialogueResponseData, error) {
	dialogue := petengine.GetDialogue(data.Mood, data.Hour, data.Lang)
	return &wshrpc.PetDialogueResponseData{
		Text: dialogue.Text,
		Type: dialogue.Type,
	}, nil
}

// Helper: convert petengine.PetInstance to wshrpc.PetStateData
func petInstanceToRPC(pet *petengine.PetInstance) *wshrpc.PetStateData {
	if pet == nil {
		return nil
	}
	return &wshrpc.PetStateData{
		ID:            pet.ID,
		PetID:         pet.PetID,
		Name:          pet.Name,
		Level:         pet.Level,
		XP:            pet.XP,
		XPToNext:      pet.XPToNext,
		Progress:      pet.Progress,
		Mood:          pet.Mood,
		State:         pet.State,
		Hunger:        pet.Hunger,
		Energy:        pet.Energy,
		SpawnedAt:     pet.SpawnedAt.Format("2006-01-02T15:04:05Z"),
		TotalPlaytime: pet.TotalPlaytime,
	}
}
