---
phase: 5
title: "Phase 5: Session layer"
status: todo
priority: P1
effort: "4-6w"
dependencies: [4]
---

# Phase 5: Session layer

## Overview and dependencies

First-class **Claude Code and Codex** conversation continuity, history, timeline, usage and explicit summaries. Reuse phase-4 provider adapters/managed launches; no Claude-only session subsystem exposed as provider-neutral support. Read [architecture contract](./architecture-contract.md). Owner: session maintainer, exclusively taking RPC/schema/controller/config seams from phase 4. Phase 6 does not supply a helper backwards in time: provider-home confinement is implemented here; repository authorization belongs to phase 6.

## Requirements

- Discover, preview, filter, resume and inspect history for both providers. Scope identity by provider + account home + execution host + provider session ID, with recorded cwd/profile. Never read remote history from local home or silently change account.
- Explicit session resume only. Missing/deleted/ambiguous session → visible choice to retry, select another or start new. **No automatic resume→continue→new fallback.** Continue-most-recent, if offered, is a distinct user action with resolved session confirmation.
- For Claude managed new launches prefer explicit provider session-ID allocation where current CLI supports it; correlate verified launch events. Directory-diff/newest-mtime discovery is fallback evidence, not concurrency-safe identity by itself. Codex IDs/formats are adapter-defined, not assumed UUIDs.
- CLI argv is version-tested. Official spaced `--resume <id>` is valid documentation; do not inherit claude-terminal's equals-only claim without empirical evidence. Never concatenate IDs into shell syntax.
- One conversation can have many launch records; historical sessions are not live PTYs. Restart restores layout and scrollback but marks interrupted launches, offering explicit resume rather than recreating agents automatically.
- Token counters with source/time; estimated monetary cost with pricing revision; subscription quota separately with provider/source/reset/freshness. Unknown is not zero, unavailable quota is not inferred from tokens.
- Opt-in metrics and summaries separately. Summary preview warns that local provider CLI sends supplied text upstream, may consume quota/cost; cancel/failure visible. No automatic summary at process exit.
- Bounded private history/log retention, deletion/export controls, malformed/large/truncated transcript safety; never store credentials or product-upload telemetry by default.

## Architecture and data flow

Adapter-specific discovery under approved host/provider home → normalized session index → SQLite conversation/launch/history metadata → paginated sessions view. Provider files remain source-owned/read-only. Do not rename/edit provider transcripts. Incremental index by file identity/offset + replacement detection; cap enumeration, record bytes, parsing depth and preview size. Claude cwd encoding is only a fast path; inspect recorded cwd and only regular JSONL files. Codex reader is independently versioned and reads verified rollout/history contracts, not Claude JSONL fields.

Launch receipt + exact resume request → identity reservation transaction → provider argv builder → managed launch → session handshake or uncertain identity diagnostic. Unique live ownership prevents concurrent adoption in same account/host; retry gets new launch generation. Provider session identity can be unknown until trustworthy evidence; never fabricate it from cwd alone.

Process completion `pkg/blockcontroller/shellcontroller.go:599-617` and explicit stop `:98-124` close a launch record exactly once. Phase-4 reducer owns event capture; session service subscribes rather than inventing a second wait loop. Raw stream remains on existing `HandleAppendBlockFile` path (`pkg/blockcontroller/blockcontroller.go:365-389`). Private per-launch log defaults are now user-validated: 10 MiB per launch, 500 MiB total and 30-day retention, configurable. Rotation/eviction writes visible truncation markers; provider transcript history and raw terminal log remain distinct. Storage failure follows phase 4's fenced segment-gap contract and never silently alters live terminal delivery.

Metrics: provider structured usage/transcript or opt-in OTLP → normalized event keyed by source/session/generation/interval → backend aggregate → cumulative versioned snapshot; frontend replaces, never sums. Read OTLP temporality instead of assuming every provider/version is DELTA. Deduplicate replay/export retries; cumulative counter reset starts a new source generation; preserve uncertainty where exact dedupe impossible. Never add transcript totals to OTLP totals for the same work. Receiver binds loopback only while enabled, bounded body/time/rate; random per-generation credentials where exporter supports headers. Local metrics are untrusted data, never commands. Account quota comes only from supported provider integration; no credential scraping or undocumented refresh-token use.

## File inventory

Existing modify/reference seams:
- `pkg/blockcontroller/shellcontroller.go:427,599-617`, `blockcontroller.go:99,278,326` lifecycle and phase-4 adapter integration (do not change every spawn independently).
- `pkg/wstore/wstore_dbsetup.go:28-36` migration runner; next available `db/migrations-wstore/` migration pair for sessions/history.
- `pkg/wshrpc/wshrpctypes.go:31` additive session RPCs; `Taskfile.yml:228` generation; generated three client/type files in architecture contract.
- `frontend/app/block/block.tsx:54-55` lazy view pattern; existing widget/config schema/default files; phase-4 state/adapter files (created by prerequisite).
New proposed: `pkg/agentsession/{index,claude,codex,resume,record,history,summary,metrics}.go` and tests; `pkg/otelrecv/{server,aggregate}.go` and tests; `pkg/wshrpc/wshserver/wshserver_agentsession.go`; `frontend/app/view/sessions/{sessions,sessions-model,timeline,history}.tsx` (use `.ts` for non-JSX models), `frontend/app/element/session-hud.tsx`.
Read-only local reference: `/home/stackops/saly/claude-terminal/src-tauri/src/{claude_session,terminal,otel_receiver}.rs`; verified resume implementation `terminal.rs:132-143`, OTLP DELTA example `otel_receiver.rs:10,156`, restore `src/store/terminalStore.ts:536-554`. Examples are not current provider contracts; pin fixture versions before porting.

## Steps

1. Specify normalized identity and adapter session capabilities; test paths with spaces/dots/drive letters, custom homes, two accounts and WSL/SSH. Persist provider identity without leaking credentials.
2. Add backward-compatible SQL tables/indexes and migration/backup tests. Index Claude and Codex with defensive incremental readers and visible warnings; missing home is empty state, unreadable home is an error.
3. Implement exact-resume reservations and argv building; explicit-ID Claude launch and Codex provider correlation. Test concurrent same-cwd launches and external provider process creating files at the same time.
4. Integrate launch lifecycle, crash reconciliation, bounded raw-log retention and paginated transcript/history rendering. Output replay uses offsets/generation, not string overlap deletion.
5. Implement metrics normalization and OTLP optional receiver. Parse integer strings/numbers, finite doubles, temporality, reset and missing fields. Respect existing provider telemetry config; do not silently override user endpoint.
6. Build sessions list/timeline/history, resume action into recorded context, HUD and separate quota panel. All unsupported/stale/missing states named.
7. Implement consented summary jobs through provider adapter with bounded input/output, timeout/cancel, cache keyed by session revision + provider/model/prompt revision. Errors remain retryable errors, not empty success.
8. Add delete/export actions with preview and confirmation; deletion affects app index/log only unless a separate provider-supported delete was explicitly requested. Never delete external history by inference.

## Test matrix

| Level | Cases | Observable result |
|---|---|---|
| Unit | Claude/Codex fixtures, malformed/partial JSONL, oversized line, UUID directory, cwd collisions | bounded parse, no wrong adoption, visible diagnostics |
| Unit | exact resume missing; opaque ID; changed account/host; same-cwd concurrent reservation | no implicit continue, no shell interpolation, unique active owner |
| Unit | DELTA/cumulative/retry/reset/NaN/negative/missing usage | no double count; unknown preserved |
| Integration | real SQLite migration, kill during index update, file truncate/replace, disk full | restart consistent; capture failure visible |
| Integration | provider absent/auth denied, invalid session, summary cancel/network failure | typed error and retry; no hidden new conversation |
| E2E | both providers run→quit→reopen→explicit resume; two accounts and WSL path | correct context/history; no auto-spawn on restart |
| E2E | metrics off, summary consent denied, retained log limit | no listener/summary traffic; visible truncation |

Implementation commands: focused Go session/OTLP tests, focused `npx vitest run`, generation + typecheck, full Go/frontend suites. Real provider smoke records include CLI version, mode, OS and sanitized evidence, not private transcript content.

## Success criteria

- [ ] Both Claude and Codex sessions list and explicitly resume with correct provider/home/host/cwd.
- [ ] Same-cwd concurrent agents never adopt each other's conversation; ambiguous evidence stays unresolved.
- [ ] Missing resume target never invokes continue/new without another user decision.
- [ ] Interrupted/ended launches have truthful timeline state and do not respawn on app restart.
- [ ] Token, estimated cost and quota are distinct; missing data is visibly unknown.
- [ ] Metrics off opens no receiver; summary only runs after content/provider disclosure and approval.
- [ ] Summary failure/cancel visible; completed summary cached by content revision, not stale forever.
- [ ] Retention/replay tests preserve live bytes, bound disk usage and expose historical truncation.

## Risks / rollback

High × high: provider private-history drift → version-isolated readers and fixtures, explicit unsupported state; block exact-resume claim until smoke verified. Medium × high: cross-account/session mixup → composite identity and reservation; fail closed on ambiguity. Medium × high: sensitive log exfiltration → local private storage, opt-in content preview and provider disclosure, no analytics payload. Medium × high: metrics corruption → source exclusivity/temporality tests and uncertainty labels.

Rollback disables session writes/receivers/summarizer after stopping owned jobs, keeps session records/logs and provider files untouched, returns terminal-only UI. Additive migrations remain; restore backup only with consent and app stopped. Existing ordinary terminals and phase-4 state keep working. Next phase 6 adds repository/worktree review without importing session identity from block meta.
