// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package wshserver

// RPC handlers for the AI-tooling surface: Claude Code skills, MCP servers,
// agents and slash commands, plus the read-only agent-teams view.
//
// These are thin adapters. All filesystem knowledge and all path validation
// lives in pkg/aitools and pkg/agentteams; this file only translates between
// their types and the wire types.

import (
	"context"
	"fmt"

	"github.com/SalyyS1/SLTerm/pkg/agentteams"
	"github.com/SalyyS1/SLTerm/pkg/aitools"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc"
)

func itemToRPC(item aitools.Item) wshrpc.AIToolsItemData {
	return wshrpc.AIToolsItemData{
		Kind:        string(item.Kind),
		Name:        item.Name,
		Scope:       string(item.Scope),
		Path:        item.Path,
		Description: item.Description,
		SizeBytes:   item.SizeBytes,
		ModTimeMs:   item.ModTimeMs,
	}
}

func itemsToRPC(items []aitools.Item) []wshrpc.AIToolsItemData {
	// Return an empty slice rather than nil so the JSON is [] and the frontend
	// never has to guard against null before mapping.
	out := make([]wshrpc.AIToolsItemData, 0, len(items))
	for _, item := range items {
		out = append(out, itemToRPC(item))
	}
	return out
}

func (ws *WshServer) AIToolsGetInventoryCommand(ctx context.Context, data wshrpc.AIToolsInventoryRequestData) (*wshrpc.AIToolsInventoryData, error) {
	inv, err := aitools.ReadInventory(data.ProjectDir)
	if err != nil {
		return nil, fmt.Errorf("error reading AI tools inventory: %w", err)
	}
	mcp := make([]wshrpc.AIToolsMCPServerData, 0, len(inv.MCP))
	for _, server := range inv.MCP {
		mcp = append(mcp, wshrpc.AIToolsMCPServerData{
			Name:       server.Name,
			Transport:  server.Transport,
			Command:    server.Command,
			Args:       server.Args,
			URL:        server.URL,
			Env:        server.Env,
			Scope:      string(server.Scope),
			SourcePath: server.SourcePath,
		})
	}
	return &wshrpc.AIToolsInventoryData{
		Skills:   itemsToRPC(inv.Skills),
		Agents:   itemsToRPC(inv.Agents),
		Commands: itemsToRPC(inv.Commands),
		MCP:      mcp,
		Warnings: inv.Warnings,
	}, nil
}

func (ws *WshServer) AIToolsReadItemCommand(ctx context.Context, data wshrpc.AIToolsItemRefData) (*wshrpc.AIToolsItemContentData, error) {
	content, err := aitools.ReadItem(aitools.Kind(data.Kind), aitools.Scope(data.Scope), data.Name, data.ProjectDir)
	if err != nil {
		return nil, err
	}
	return &wshrpc.AIToolsItemContentData{Content: content}, nil
}

func (ws *WshServer) AIToolsWriteItemCommand(ctx context.Context, data wshrpc.AIToolsWriteItemData) error {
	return aitools.WriteItem(aitools.Kind(data.Kind), aitools.Scope(data.Scope), data.Name, data.ProjectDir, data.Content)
}

func (ws *WshServer) AIToolsDeleteItemCommand(ctx context.Context, data wshrpc.AIToolsItemRefData) error {
	return aitools.DeleteItem(aitools.Kind(data.Kind), aitools.Scope(data.Scope), data.Name, data.ProjectDir)
}

func (ws *WshServer) AgentTeamsGetSnapshotCommand(ctx context.Context) (*wshrpc.AgentTeamsSnapshotData, error) {
	snap, err := agentteams.ReadSnapshot()
	if err != nil {
		return nil, fmt.Errorf("error reading agent teams: %w", err)
	}
	teams := make([]wshrpc.AgentTeamsTeamData, 0, len(snap.Teams))
	for _, team := range snap.Teams {
		members := make([]wshrpc.AgentTeamsMemberData, 0, len(team.Config.Members))
		for _, m := range team.Config.Members {
			members = append(members, wshrpc.AgentTeamsMemberData{
				AgentID:   m.AgentID,
				Name:      m.Name,
				AgentType: m.AgentType,
				Model:     m.Model,
				JoinedAt:  m.JoinedAt,
				Cwd:       m.Cwd,
			})
		}
		teams = append(teams, wshrpc.AgentTeamsTeamData{
			DirName:     team.DirName,
			Name:        team.Config.Name,
			Description: team.Config.Description,
			CreatedAt:   team.Config.CreatedAt,
			LeadAgentID: team.Config.LeadAgentID,
			Members:     members,
			Tasks:       tasksToRPC(team.Tasks),
		})
	}
	return &wshrpc.AgentTeamsSnapshotData{Teams: teams, Warnings: snap.Warnings}, nil
}

func (ws *WshServer) AgentTeamsGetTasksCommand(ctx context.Context, data wshrpc.AgentTeamsTasksRequestData) ([]wshrpc.AgentTeamsTaskData, error) {
	tasks, err := agentteams.ReadTasks(data.TeamName)
	if err != nil {
		return nil, err
	}
	return tasksToRPC(tasks), nil
}

func tasksToRPC(tasks []agentteams.Task) []wshrpc.AgentTeamsTaskData {
	out := make([]wshrpc.AgentTeamsTaskData, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, wshrpc.AgentTeamsTaskData{
			ID:         t.ID,
			Subject:    t.Subject,
			Status:     t.Status,
			Owner:      t.Owner,
			BlockedBy:  t.BlockedBy,
			ActiveForm: t.ActiveForm,
		})
	}
	return out
}
