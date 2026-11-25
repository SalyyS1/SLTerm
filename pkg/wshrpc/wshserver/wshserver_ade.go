// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package wshserver

// Thin WSH RPC adapters for SLTerm's ADE backend packages:
//   - pkg/vcs           (Git status, diff, staging, commits, changelists & isolated agent worktrees)
//   - pkg/agentsessions (Multi-agent sessions, Windows CLI agent detector & executable prompt notes)
//   - pkg/otelcost      (Embedded local OTLP/JSON DELTA token & USD cost HUD)

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/SalyyS1/SLTerm/pkg/adestats"
	"github.com/SalyyS1/SLTerm/pkg/adeworkspace"
	"github.com/SalyyS1/SLTerm/pkg/agentsessions"
	"github.com/SalyyS1/SLTerm/pkg/agentwatch"
	"github.com/SalyyS1/SLTerm/pkg/cmdguard"
	"github.com/SalyyS1/SLTerm/pkg/nltcmd"
	"github.com/SalyyS1/SLTerm/pkg/otelcost"
	"github.com/SalyyS1/SLTerm/pkg/portwatch"
	"github.com/SalyyS1/SLTerm/pkg/projectdetect"
	"github.com/SalyyS1/SLTerm/pkg/sshaudit"
	"github.com/SalyyS1/SLTerm/pkg/taskboard"
	"github.com/SalyyS1/SLTerm/pkg/updatecheck"
	"github.com/SalyyS1/SLTerm/pkg/vcs"
	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc"
)

func init() {
	otelcost.DefaultCollector().SetOnBudgetExceeded(func(totalUSD, budgetUSD float64) {
		agentwatch.DefaultHub().Record(
			"security",
			"attention",
			fmt.Sprintf("AI Cost Guard exceeded ($%.2f / $%.2f)", totalUSD, budgetUSD),
			"Open ADE Hub → Activity & Runtime to inspect per-block token usage or adjust budget.",
			"",
			"",
		)
	})
}

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
	agentwatch.DefaultHub().Record("worktree", "info", "Created agent worktree "+wt.Branch, wt.Path, "", wt.Path)
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

func (ws *WshServer) VcsDraftCommitCommand(ctx context.Context, data wshrpc.VcsDirRequestData) (*wshrpc.VcsActionResultData, error) {
	draft, err := vcs.DraftCommitMessage(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: draft}, nil
}

func (ws *WshServer) VcsGetLogCommand(ctx context.Context, data wshrpc.VcsLogRequestData) ([]wshrpc.VcsCommitEntryData, error) {
	entries, err := vcs.GetLog(ctx, data.Dir, data.Limit)
	if err != nil {
		return nil, err
	}
	return commitEntriesToRpc(entries), nil
}

func (ws *WshServer) VcsGetFileLogCommand(ctx context.Context, data wshrpc.VcsFileLogRequestData) ([]wshrpc.VcsCommitEntryData, error) {
	entries, err := vcs.GetFileLog(ctx, data.Dir, data.Path, data.Limit)
	if err != nil {
		return nil, err
	}
	return commitEntriesToRpc(entries), nil
}

func commitEntriesToRpc(entries []vcs.CommitEntry) []wshrpc.VcsCommitEntryData {
	out := make([]wshrpc.VcsCommitEntryData, 0, len(entries))
	for _, e := range entries {
		out = append(out, wshrpc.VcsCommitEntryData{
			Hash:       e.Hash,
			ShortHash:  e.ShortHash,
			Author:     e.Author,
			RelDate:    e.RelDate,
			Subject:    e.Subject,
			Decoration: e.Decoration,
		})
	}
	return out
}

func (ws *WshServer) VcsShowCommitCommand(ctx context.Context, data wshrpc.VcsShowCommitRequestData) (*wshrpc.VcsDiffData, error) {
	out, err := vcs.ShowCommit(ctx, data.Dir, data.Hash)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsDiffData{Diff: out}, nil
}

func (ws *WshServer) VcsAssignChangelistCommand(ctx context.Context, data wshrpc.VcsChangelistAssignData) error {
	root, err := vcs.ResolveRepoRoot(ctx, data.Dir)
	if err != nil {
		return err
	}
	return vcs.AssignChangelist(root, data.Path, data.Changelist)
}

func (ws *WshServer) VcsListBranchesCommand(ctx context.Context, data wshrpc.VcsDirRequestData) ([]wshrpc.VcsBranchData, error) {
	branches, err := vcs.ListBranches(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.VcsBranchData, 0, len(branches))
	for _, b := range branches {
		out = append(out, wshrpc.VcsBranchData{
			Name:      b.Name,
			Current:   b.Current,
			ShortHash: b.ShortHash,
			Subject:   b.Subject,
		})
	}
	return out, nil
}

func (ws *WshServer) VcsCheckoutBranchCommand(ctx context.Context, data wshrpc.VcsCheckoutBranchRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.CheckoutBranch(ctx, data.Dir, data.Branch, data.Create)
	if err != nil {
		return nil, err
	}
	agentwatch.DefaultHub().Record("worktree", "info", "Switched branch to "+data.Branch, data.Dir, "", data.Dir)
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsListStashesCommand(ctx context.Context, data wshrpc.VcsDirRequestData) ([]wshrpc.VcsStashEntryData, error) {
	stashes, err := vcs.ListStashes(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.VcsStashEntryData, 0, len(stashes))
	for _, s := range stashes {
		out = append(out, wshrpc.VcsStashEntryData{
			Ref:     s.Ref,
			RelDate: s.RelDate,
			Message: s.Message,
		})
	}
	return out, nil
}

func (ws *WshServer) VcsStashPushCommand(ctx context.Context, data wshrpc.VcsStashPushRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.StashPush(ctx, data.Dir, data.Message, data.IncludeUntracked)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsStashPopCommand(ctx context.Context, data wshrpc.VcsStashPopRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.StashPop(ctx, data.Dir, data.Ref)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsPruneWorktreesCommand(ctx context.Context, data wshrpc.VcsDirRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.PruneWorktrees(ctx, data.Dir)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) VcsListMergedBranchesCommand(ctx context.Context, data wshrpc.VcsDirRequestData) ([]string, error) {
	return vcs.ListMergedBranches(ctx, data.Dir)
}

func (ws *WshServer) VcsDeleteBranchCommand(ctx context.Context, data wshrpc.VcsDeleteBranchRequestData) (*wshrpc.VcsActionResultData, error) {
	out, err := vcs.DeleteBranch(ctx, data.Dir, data.Branch, data.Force)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: out}, nil
}

func (ws *WshServer) AdeGetHubSnapshotCommand(ctx context.Context, data wshrpc.AdeHubRequestData) (*wshrpc.AdeHubSnapshotData, error) {
	idx, err := agentsessions.ListSessions(data.Query, data.AgentFilter, data.Limit)
	if err != nil {
		return nil, err
	}
	agentwatch.DefaultHub().ObserveSessions(idx.Sessions)
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
	costRpc := costToRpc(costSnap)

	return &wshrpc.AdeHubSnapshotData{
		Sessions: sessions,
		Agents:   agents,
		Notes:    notes,
		Cost:     costRpc,
		Warnings: idx.Warnings,
	}, nil
}

func costToRpc(costSnap otelcost.Snapshot) wshrpc.AdeCostSnapshotData {
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
	return wshrpc.AdeCostSnapshotData{
		TotalCostUSD:      costSnap.TotalCostUSD,
		TotalInputTokens:  costSnap.TotalInputTokens,
		TotalOutputTokens: costSnap.TotalOutputTokens,
		TotalCacheTokens:  costSnap.TotalCacheTokens,
		BudgetUSD:         costSnap.BudgetUSD,
		BudgetExceeded:    costSnap.BudgetExceeded,
		Blocks:            blocks,
	}
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

func (ws *WshServer) AdePreviewSessionCommand(ctx context.Context, data wshrpc.AdeForkSessionRequestData) (*wshrpc.AdeSessionPreviewData, error) {
	prev, err := agentsessions.ReadSessionPreview(data.Agent, data.SessionID, 12)
	if err != nil {
		return nil, err
	}
	msgs := make([]wshrpc.AdeTranscriptMessageData, 0, len(prev.Messages))
	for _, m := range prev.Messages {
		msgs = append(msgs, wshrpc.AdeTranscriptMessageData{
			Role: m.Role,
			Text: m.Text,
		})
	}
	return &wshrpc.AdeSessionPreviewData{
		ID:              prev.ID,
		Agent:           prev.Agent,
		Cwd:             prev.Cwd,
		Title:           prev.Title,
		Messages:        msgs,
		HandoffMarkdown: prev.HandoffMarkdown,
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

func wsToRpc(w adeworkspace.WorkspaceProfile) wshrpc.AdeWorkspaceData {
	return wshrpc.AdeWorkspaceData{
		ID:           w.ID,
		Name:         w.Name,
		RepoDir:      w.RepoDir,
		DefaultAgent: w.DefaultAgent,
		LayoutPreset: w.LayoutPreset,
		DevPort:      w.DevPort,
		Color:        w.Color,
		LastOpenedMs: w.LastOpenedMs,
		UpdatedAtMs:  w.UpdatedAtMs,
	}
}

func (ws *WshServer) AdeListWorkspacesCommand(ctx context.Context) ([]wshrpc.AdeWorkspaceData, error) {
	list, err := adeworkspace.ListWorkspaces()
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.AdeWorkspaceData, 0, len(list))
	for _, w := range list {
		out = append(out, wsToRpc(w))
	}
	return out, nil
}

func (ws *WshServer) AdeSaveWorkspaceCommand(ctx context.Context, data wshrpc.AdeWorkspaceData) (*wshrpc.AdeWorkspaceData, error) {
	saved, err := adeworkspace.SaveWorkspace(adeworkspace.WorkspaceProfile{
		ID:           data.ID,
		Name:         data.Name,
		RepoDir:      data.RepoDir,
		DefaultAgent: data.DefaultAgent,
		LayoutPreset: data.LayoutPreset,
		DevPort:      data.DevPort,
		Color:        data.Color,
	})
	if err != nil {
		return nil, err
	}
	rpcVal := wsToRpc(*saved)
	return &rpcVal, nil
}

func (ws *WshServer) AdeDeleteWorkspaceCommand(ctx context.Context, data wshrpc.AdeWorkspaceDeleteRequestData) error {
	return adeworkspace.DeleteWorkspace(data.ID)
}

func (ws *WshServer) AdeCheckUpdateCommand(ctx context.Context, data wshrpc.AdeCheckUpdateRequestData) (*wshrpc.AdeUpdateInfoData, error) {
	cur := wavebase.WaveVersion
	if cur == "" || cur == "0.0.0" {
		cur = "0.48.0"
	}
	info, err := updatecheck.CheckLatest(ctx, cur, data.Force)
	if err != nil {
		return nil, err
	}
	return &wshrpc.AdeUpdateInfoData{
		CurrentVersion:  info.CurrentVersion,
		LatestVersion:   info.LatestVersion,
		UpdateAvailable: info.UpdateAvailable,
		ReleaseName:     info.ReleaseName,
		ReleaseURL:      info.ReleaseURL,
		DownloadURL:     info.DownloadURL,
		PublishedAt:     info.PublishedAt,
		NotesPreview:    info.NotesPreview,
		CheckedAtMs:     info.CheckedAtMs,
	}, nil
}

func dlStateToRpc(st updatecheck.DownloadState) *wshrpc.AdeUpdateProgressData {
	return &wshrpc.AdeUpdateProgressData{
		Active:          st.Active,
		Stage:           st.Stage,
		Version:         st.Version,
		DownloadedBytes: st.DownloadedBytes,
		TotalBytes:      st.TotalBytes,
		Percent:         st.Percent,
		FilePath:        st.FilePath,
		Error:           st.Error,
	}
}

func (ws *WshServer) AdeStartSelfUpdateCommand(ctx context.Context, data wshrpc.AdeSelfUpdateRequestData) (*wshrpc.AdeUpdateProgressData, error) {
	st, err := updatecheck.StartSelfUpdate(data.DownloadURL, data.Version)
	if err != nil {
		return nil, err
	}
	return dlStateToRpc(st), nil
}

func (ws *WshServer) AdeGetUpdateProgressCommand(ctx context.Context) (*wshrpc.AdeUpdateProgressData, error) {
	return dlStateToRpc(updatecheck.GetDownloadState()), nil
}

func (ws *WshServer) AdeGetRuntimeStatsCommand(ctx context.Context) (*wshrpc.AdeRuntimeStatsData, error) {
	s := adestats.Collect(ctx)
	procs := make([]wshrpc.AdeTrackedProcessData, 0, len(s.Processes))
	for _, p := range s.Processes {
		procs = append(procs, wshrpc.AdeTrackedProcessData{
			PID:   p.PID,
			Name:  p.Name,
			Role:  p.Role,
			RSSMB: p.RSSMB,
		})
	}
	return &wshrpc.AdeRuntimeStatsData{
		SidecarHeapMB:  s.SidecarHeapMB,
		SidecarSysMB:   s.SidecarSysMB,
		Goroutines:     s.Goroutines,
		UptimeSec:      s.UptimeSec,
		Platform:       s.Platform,
		ActiveAgents:   s.ActiveAgents,
		ActiveDevProcs: s.ActiveDevProcs,
		Processes:      procs,
	}, nil
}

func (ws *WshServer) AdeAuditSSHConfigCommand(ctx context.Context, data wshrpc.AdeSSHAuditRequestData) (*wshrpc.AdeSSHAuditReportData, error) {
	filename := "inline-ssh-config"
	content := data.Content
	if strings.TrimSpace(content) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		filename = filepath.Join(home, ".ssh", "config")
		raw, err := os.ReadFile(filename)
		if err != nil {
			if os.IsNotExist(err) {
				return &wshrpc.AdeSSHAuditReportData{
					File:     filename + " (not found)",
					Findings: []wshrpc.AdeSSHAuditFindingData{},
				}, nil
			}
			return nil, err
		}
		content = string(raw)
	}
	rep := sshaudit.AuditConfig(filename, content)
	findings := make([]wshrpc.AdeSSHAuditFindingData, 0, len(rep.Findings))
	for _, f := range rep.Findings {
		findings = append(findings, wshrpc.AdeSSHAuditFindingData{
			RuleID:      f.RuleID,
			RuleName:    f.RuleName,
			Severity:    string(f.Severity),
			CWE:         f.CWE,
			Line:        f.Line,
			HostContext: f.HostContext,
			Message:     f.Message,
			Remediation: f.Remediation,
		})
	}
	return &wshrpc.AdeSSHAuditReportData{
		File:         rep.File,
		StanzaCount:  rep.StanzaCount,
		ErrorCount:   rep.ErrorCount,
		WarningCount: rep.WarningCount,
		Findings:     findings,
	}, nil
}

func (ws *WshServer) AdeInspectProjectCommand(ctx context.Context, data wshrpc.VcsDirRequestData) (*wshrpc.AdeProjectReportData, error) {
	rep, err := projectdetect.Inspect(data.Dir)
	if err != nil {
		return nil, err
	}
	cmds := make([]wshrpc.AdeProjectCommandData, 0, len(rep.Commands))
	for _, c := range rep.Commands {
		cmds = append(cmds, wshrpc.AdeProjectCommandData{
			Label:   c.Label,
			Command: c.Command,
			Source:  c.Source,
		})
	}
	return &wshrpc.AdeProjectReportData{
		Dir:                rep.Dir,
		Name:               rep.Name,
		Stacks:             rep.Stacks,
		Commands:           cmds,
		HasGit:             rep.HasGit,
		HasClaudeMD:        rep.HasClaudeMD,
		HasAgentsMD:        rep.HasAgentsMD,
		HasMcpJSON:         rep.HasMcpJSON,
		HasWorktreeInclude: rep.HasWorktreeInclude,
		HasDotEnv:          rep.HasDotEnv,
		EnvExampleCount:    rep.EnvExampleCount,
		MissingEnvKeys:     rep.MissingEnvKeys,
	}, nil
}

func (ws *WshServer) AdeEnsureWorktreeIncludeCommand(ctx context.Context, data wshrpc.VcsDirRequestData) (*wshrpc.VcsActionResultData, error) {
	p, created, err := projectdetect.EnsureWorktreeInclude(data.Dir)
	if err != nil {
		return nil, err
	}
	if created {
		return &wshrpc.VcsActionResultData{Output: "Created " + p}, nil
	}
	return &wshrpc.VcsActionResultData{Output: "Already exists: " + p}, nil
}

func (ws *WshServer) AdeGetActivityCommand(ctx context.Context) (*wshrpc.AdeActivityFeedData, error) {
	if idx, err := agentsessions.ListSessions("", "all", 40); err == nil {
		agentwatch.DefaultHub().ObserveSessions(idx.Sessions)
	}
	snap := agentwatch.DefaultHub().Snapshot()
	evs := make([]wshrpc.AdeActivityEventData, 0, len(snap.Events))
	for _, e := range snap.Events {
		evs = append(evs, wshrpc.AdeActivityEventData{
			ID:        e.ID,
			Kind:      e.Kind,
			Severity:  e.Severity,
			Title:     e.Title,
			Detail:    e.Detail,
			SessionID: e.SessionID,
			Cwd:       e.Cwd,
			CreatedMs: e.CreatedMs,
			Read:      e.Read,
		})
	}
	return &wshrpc.AdeActivityFeedData{
		UnreadCount:  snap.UnreadCount,
		WaitingCount: snap.WaitingCount,
		Events:       evs,
	}, nil
}

func (ws *WshServer) AdeMarkActivityReadCommand(ctx context.Context) error {
	agentwatch.DefaultHub().MarkAllRead()
	return nil
}

func (ws *WshServer) AdeSetCostBudgetCommand(ctx context.Context, data wshrpc.AdeCostBudgetRequestData) (*wshrpc.AdeCostSnapshotData, error) {
	otelcost.DefaultCollector().SetBudget(data.BudgetUSD)
	snap := costToRpc(otelcost.DefaultCollector().Snapshot())
	return &snap, nil
}

func (ws *WshServer) AdeResetCostCommand(ctx context.Context) (*wshrpc.AdeCostSnapshotData, error) {
	otelcost.DefaultCollector().Reset()
	snap := costToRpc(otelcost.DefaultCollector().Snapshot())
	return &snap, nil
}

func (ws *WshServer) AdeKillDevPortCommand(ctx context.Context, data wshrpc.AdeKillPortRequestData) (*wshrpc.VcsActionResultData, error) {
	killed, err := portwatch.KillDevPort(ctx, data.Port, data.PID)
	if err != nil {
		return nil, err
	}
	msg := fmt.Sprintf("Stopped dev server %s (PID %d) on :%d", killed.Process, killed.PID, killed.Port)
	agentwatch.DefaultHub().Record("system", "info", msg, killed.URL, "", "")
	return &wshrpc.VcsActionResultData{Output: msg}, nil
}

func (ws *WshServer) AdeReadContextFileCommand(ctx context.Context, data wshrpc.AdeContextFileRequestData) (*wshrpc.AdeContextFileData, error) {
	content, exists, err := projectdetect.ReadContextFile(data.Dir, data.Name)
	if err != nil {
		return nil, err
	}
	return &wshrpc.AdeContextFileData{
		Dir:     data.Dir,
		Name:    data.Name,
		Exists:  exists,
		Content: content,
	}, nil
}

func (ws *WshServer) AdeWriteContextFileCommand(ctx context.Context, data wshrpc.AdeWriteContextFileRequestData) (*wshrpc.VcsActionResultData, error) {
	p, err := projectdetect.WriteContextFile(data.Dir, data.Name, data.Content)
	if err != nil {
		return nil, err
	}
	return &wshrpc.VcsActionResultData{Output: "Saved " + p}, nil
}

func (ws *WshServer) AdeSuggestCommandsCommand(ctx context.Context, data wshrpc.AdeNltQueryRequestData) ([]wshrpc.AdeNltSuggestionData, error) {
	raw := nltcmd.Suggest(data.Query, data.Limit)
	out := make([]wshrpc.AdeNltSuggestionData, 0, len(raw))
	for _, s := range raw {
		out = append(out, wshrpc.AdeNltSuggestionData{
			ID:          s.ID,
			Title:       s.Title,
			Category:    s.Category,
			WindowsCmd:  s.WindowsCmd,
			UnixCmd:     s.UnixCmd,
			Recommended: s.Recommended,
			Explanation: s.Explanation,
			Verdict:     s.Verdict,
			RiskScore:   s.RiskScore,
		})
	}
	return out, nil
}
