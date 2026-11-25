// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package wshserver

// Thin WSH RPC adapters for SLTerm's ADE backend packages:
//   - pkg/vcs           (Git status, diff, staging, commits, changelists & isolated agent worktrees)
//   - pkg/agentsessions (Multi-agent sessions, Windows CLI agent detector & executable prompt notes)
//   - pkg/otelcost      (Embedded local OTLP/JSON DELTA token & USD cost HUD)

import (
	"context"

	"github.com/SalyyS1/SLTerm/pkg/agentsessions"
	"github.com/SalyyS1/SLTerm/pkg/cmdguard"
	"github.com/SalyyS1/SLTerm/pkg/otelcost"
	"github.com/SalyyS1/SLTerm/pkg/portwatch"
	"github.com/SalyyS1/SLTerm/pkg/taskboard"
	"github.com/SalyyS1/SLTerm/pkg/vcs"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc"
)

func (ws *WshServer) VcsGetStatusCommand(ctx context.Context, data wshrpc.VcsDirRequestData) (*wshrpc.VcsStatusData, error) {
	st, err := vcs.GetStatus(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	changes := make([]wshrpc.VcsFileChangeData, 0, len(st.Changes))
	for _, c := range st.Changes {
		changes = append(changes, wshrpc.VcsFileChangeData{
			Path:        c.Path,
			OrigPath:    c.OrigPath,
			IndexStatus: c.IndexStatus,
			WorkStatus:  c.WorkStatus,
			Staged:      c.Staged,
			Unstaged:    c.Unstaged,
			Untracked:   c.Untracked,
			Conflicted:  c.Conflicted,
			Changelist:  c.Changelist,
		})
	}
	return &wshrpc.VcsStatusData{
		RepoRoot:      st.RepoRoot,
		Branch:        st.Branch,
		HeadShort:     st.HeadShort,
		Ahead:         st.Ahead,
		Behind:        st.Behind,
		IsWorktree:    st.IsWorktree,
		Changes:       changes,
		Changelists:   st.Changelists,
		StagedCount:   st.StagedCount,
		UnstagedCount: st.UnstagedCount,
	}, nil
}

func (ws *WshServer) VcsGetDiffCommand(ctx context.Context, data wshrpc.VcsDiffRequestData) (*wshrpc.VcsDiffData, error) {
	diff, err := vcs.GetDiff(ctx, data.Dir, data.Path, data.Staged)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsDiffData{Diff: diff}, nil
}

func (ws *WshServer) VcsStageCommand(ctx context.Context, data wshrpc.VcsPathsRequestData) error {
	return vcs.StageFiles(ctx, data.Dir, data.Paths)
}

func (ws *WshServer) VcsUnstageCommand(ctx context.Context, data wshrpc.VcsPathsRequestData) error {
	return vcs.UnstageFiles(ctx, data.Dir, data.Paths)
}

func (ws *WshServer) VcsDiscardCommand(ctx context.Context, data wshrpc.VcsFileRequestData) error {
	return vcs.DiscardFile(ctx, data.Dir, data.Path)
}

func (ws *WshServer) VcsCommitCommand(ctx context.Context, data wshrpc.VcsCommitRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.Commit(ctx, data.Dir, data.Message)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsPushCommand(ctx context.Context, data wshrpc.VcsDirRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.Push(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsPullCommand(ctx context.Context, data wshrpc.VcsDirRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.Pull(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsListWorktreesCommand(ctx context.Context, data wshrpc.VcsDirRequestData) ([]wshrpc.VcsWorktreeData, error) {
	wts, err := vcs.ListWorktrees(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.VcsWorktreeData, 0, len(wts))
	for _, wt := range wts {
		out = append(out, wshrpc.VcsWorktreeData{
			Path:          wt.Path,
			Head:          wt.Head,
			Branch:        wt.Branch,
			IsMain:        wt.IsMain,
			Detached:      wt.Detached,
			Bare:          wt.Bare,
			Locked:        wt.Locked,
			DirtyCount:    wt.DirtyCount,
			HydratedFiles: wt.HydratedFiles,
		})
	}
	return out, nil
}

func (ws *WshServer) VcsCreateWorktreeCommand(ctx context.Context, data wshrpc.VcsCreateWorktreeRequestData) (*wshrpc.VcsWorktreeData, error) {
	wt, err := vcs.CreateWorktree(ctx, data.Dir, data.Branch, data.TargetPath)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsWorktreeData{
		Path:          wt.Path,
		Head:          wt.Head,
		Branch:        wt.Branch,
		IsMain:        wt.IsMain,
		Detached:      wt.Detached,
		Bare:          wt.Bare,
		Locked:        wt.Locked,
		DirtyCount:    wt.DirtyCount,
		HydratedFiles: wt.HydratedFiles,
	}, nil
}

func (ws *WshServer) VcsRemoveWorktreeCommand(ctx context.Context, data wshrpc.VcsRemoveWorktreeRequestData) error {
	return vcs.RemoveWorktree(ctx, data.Dir, data.WorktreePath, data.Force)
}

func (ws *WshServer) VcsMergeWorktreeCommand(ctx context.Context, data wshrpc.VcsMergeWorktreeRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.MergeWorktree(ctx, data.Dir, data.Branch, data.WorktreePath, data.RemoveAfter)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsAssignChangelistCommand(ctx context.Context, data wshrpc.VcsChangelistAssignData) error {
	root, err := vcs.ResolveRepoRoot(ctx, data.Dir)
	if err != nil {
		return err
	}
	return vcs.AssignChangelist(root, data.Path, data.Changelist)
}

func (ws *WshServer) AdeGetHubSnapshotCommand(ctx context.Context, data wshrpc.AdeHubRequestData) (*wshrpc.AdeHubSnapshotData, error) {
	idx, err := agentsessions.ListSessions(data.Query, data.AgentFilter, data.Limit)
	if err != nil {
		return nil, err
	}
	sessions := make([]wshrpc.AdeSessionData, 0, len(idx.Sessions))
	for _, s := range idx.Sessions {
		sessions = append(sessions, wshrpc.AdeSessionData{
			ID:            s.ID,
			Agent:         s.Agent,
			Cwd:           s.Cwd,
			Title:         s.Title,
			Status:        s.Status,
			MessageCount:  s.MessageCount,
			UpdatedAtMs:   s.UpdatedAtMs,
			FilePath:      s.FilePath,
			ResumeCommand: s.ResumeCommand,
		})
	}

	rawAgents := agentsessions.DetectInstalledAgents()
	agents := make([]wshrpc.AdeDetectedAgentData, 0, len(rawAgents))
	for _, a := range rawAgents {
		agents = append(agents, wshrpc.AdeDetectedAgentData{
			ID:          a.ID,
			Name:        a.Name,
			Category:    a.Category,
			Command:     a.Command,
			Installed:   a.Installed,
			BinaryPath:  a.BinaryPath,
			Description: a.Description,
		})
	}

	rawNotes, _ := agentsessions.ListNotes()
	notes := make([]wshrpc.AdePromptNoteData, 0, len(rawNotes))
	for _, n := range rawNotes {
		notes = append(notes, wshrpc.AdePromptNoteData{
			ID:          n.ID,
			Title:       n.Title,
			Agent:       n.Agent,
			Body:        n.Body,
			Tags:        n.Tags,
			UpdatedAtMs: n.UpdatedAtMs,
		})
	}

	costSnap := otelcost.DefaultCollector().Snapshot()
	blocks := make([]wshrpc.AdeBlockCostData, 0, len(costSnap.Blocks))
	for _, b := range costSnap.Blocks {
		blocks = append(blocks, wshrpc.AdeBlockCostData{
			BlockID:      b.BlockID,
			SessionID:    b.SessionID,
			CostUSD:      b.CostUSD,
			InputTokens:  b.InputTokens,
			OutputTokens: b.OutputTokens,
			CacheTokens:  b.CacheTokens,
			UpdatedAtMs:  b.UpdatedAtMs,
		})
	}

	return &wshrpc.AdeHubSnapshotData{
		Sessions: sessions,
		Agents:   agents,
		Notes:    notes,
		Cost: wshrpc.AdeCostSnapshotData{
			TotalCostUSD:      costSnap.TotalCostUSD,
			TotalInputTokens:  costSnap.TotalInputTokens,
			TotalOutputTokens: costSnap.TotalOutputTokens,
			TotalCacheTokens:  costSnap.TotalCacheTokens,
			Blocks:            blocks,
		},
		Warnings: idx.Warnings,
	}, nil
}

func (ws *WshServer) AdeSavePromptNoteCommand(ctx context.Context, data wshrpc.AdePromptNoteData) (*wshrpc.AdePromptNoteData, error) {
	saved, err := agentsessions.SaveNote(agentsessions.PromptNote{
		ID:    data.ID,
		Title: data.Title,
		Agent: data.Agent,
		Body:  data.Body,
		Tags:  data.Tags,
	})
	if err != nil {
		return nil, err
	}
	return &wshrpc.AdePromptNoteData{
		ID:          saved.ID,
		Title:       saved.Title,
		Agent:       saved.Agent,
		Body:        saved.Body,
		Tags:        saved.Tags,
		UpdatedAtMs: saved.UpdatedAtMs,
	}, nil
}

func (ws *WshServer) AdeDeletePromptNoteCommand(ctx context.Context, data wshrpc.AdeNoteDeleteRequestData) error {
	return agentsessions.DeleteNote(data.ID)
}

func (ws *WshServer) AdeListPortsCommand(ctx context.Context) ([]wshrpc.AdePortData, error) {
	ports, err := portwatch.ListLocalPorts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.AdePortData, 0, len(ports))
	for _, p := range ports {
		out = append(out, wshrpc.AdePortData{
			Port:        p.Port,
			Protocol:    p.Protocol,
			Address:     p.Address,
			PID:         p.PID,
			Process:     p.Process,
			URL:         p.URL,
			IsDevLikely: p.IsDevLikely,
		})
	}
	return out, nil
}

func taskToRpc(t taskboard.TaskItem) wshrpc.AdeTaskData {
	return wshrpc.AdeTaskData{
		ID:           t.ID,
		Title:        t.Title,
		Description:  t.Description,
		Status:       t.Status,
		Agent:        t.Agent,
		Priority:     t.Priority,
		Branch:       t.Branch,
		RepoDir:      t.RepoDir,
		WorktreePath: t.WorktreePath,
		CreatedAtMs:  t.CreatedAtMs,
		UpdatedAtMs:  t.UpdatedAtMs,
	}
}

func (ws *WshServer) AdeListTasksCommand(ctx context.Context) ([]wshrpc.AdeTaskData, error) {
	tasks, err := taskboard.ListTasks()
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.AdeTaskData, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, taskToRpc(t))
	}
	return out, nil
}

func (ws *WshServer) AdeSaveTaskCommand(ctx context.Context, data wshrpc.AdeTaskData) (*wshrpc.AdeTaskData, error) {
	saved, err := taskboard.SaveTask(taskboard.TaskItem{
		ID:           data.ID,
		Title:        data.Title,
		Description:  data.Description,
		Status:       data.Status,
		Agent:        data.Agent,
		Priority:     data.Priority,
		Branch:       data.Branch,
		RepoDir:      data.RepoDir,
		WorktreePath: data.WorktreePath,
	})
	if err != nil {
		return nil, err
	}
	rpcVal := taskToRpc(*saved)
	return &rpcVal, nil
}

func (ws *WshServer) AdeMoveTaskCommand(ctx context.Context, data wshrpc.AdeMoveTaskRequestData) (*wshrpc.AdeTaskData, error) {
	moved, err := taskboard.MoveTask(data.ID, data.Status, data.WorktreePath)
	if err != nil {
		return nil, err
	}
	rpcVal := taskToRpc(*moved)
	return &rpcVal, nil
}

func (ws *WshServer) AdeDeleteTaskCommand(ctx context.Context, data wshrpc.AdeTaskDeleteRequestData) error {
	return taskboard.DeleteTask(data.ID)
}

func (ws *WshServer) AdeForkSessionCommand(ctx context.Context, data wshrpc.AdeForkSessionRequestData) (*wshrpc.AdeSessionData, error) {
	forked, err := agentsessions.ForkSession(data.Agent, data.SessionID)
	if err != nil {
		return nil, err
	}
	return &wshrpc.AdeSessionData{
		ID:            forked.ID,
		Agent:         forked.Agent,
		Cwd:           forked.Cwd,
		Title:         forked.Title,
		Status:        forked.Status,
		MessageCount:  forked.MessageCount,
		UpdatedAtMs:   forked.UpdatedAtMs,
		FilePath:      forked.FilePath,
		ResumeCommand: forked.ResumeCommand,
	}, nil
}

func (ws *WshServer) AdeCheckCommandRiskCommand(ctx context.Context, data wshrpc.AdeCheckCommandRiskRequestData) (*wshrpc.AdeCommandRiskData, error) {
	rep := cmdguard.AnalyzeCommand(data.Command, cmdguard.AnalyzeOptions{
		Policy: cmdguard.PolicyMode(data.Policy),
	})
	findings := make([]wshrpc.AdeCommandRiskFindingData, 0, len(rep.Findings))
	for _, f := range rep.Findings {
		findings = append(findings, wshrpc.AdeCommandRiskFindingData{
			RuleID:      f.RuleID,
			RuleName:    f.RuleName,
			Severity:    string(f.Severity),
			Message:     f.Message,
			Remediation: f.Remediation,
		})
	}
	return &wshrpc.AdeCommandRiskData{
		Verdict:      string(rep.Verdict),
		RiskScore:    rep.RiskScore,
		ErrorCount:   rep.ErrorCount,
		WarningCount: rep.WarningCount,
		Findings:     findings,
	}, nil
}
