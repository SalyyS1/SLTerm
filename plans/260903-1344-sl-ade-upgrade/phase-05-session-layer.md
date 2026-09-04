---
phase: 5
title: "Phase 5: Session layer"
status: todo
priority: P1
effort: "3-4w"
dependencies: [4]
---

# Phase 5: Session layer

## Overview

Give agent conversations continuity and a price tag: resume a past Claude Code session from the UI,
browse a session's history and timeline, and see live token counts and estimated cost. Everything here
is a Go package plus a block view — the reference implementation is Rust, and under this project's rule
that Rust is a shell, it is a specification to reimplement rather than code to lift.

## Key Insights

- **Session discovery is a directory diff, not a CLI query.** Claude Code writes each conversation to
  `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. Snapshot the files before spawn, poll after,
  and the new file's stem is the id.
- **Do not trust a reimplemented path encoder as the lookup key.** The reference maps `\`, `/`, `:` and
  space to `-`, but a real `~/.claude/projects` listing on this machine also shows `.` mapped to `-`
  (`/home/stackops/.claude` → `-home-stackops--claude`), which that four-character rule does not produce.
  So: enumerate the directories under `~/.claude/projects` and match by the `cwd` recorded **inside** the
  JSONL entries; keep an encoder only as a fast path. Port the reference's test vectors *and* add ones
  captured from a real listing, including a dotted path.
- **Filter the snapshot to regular `.jsonl` files.** That same directory contains a subdirectory whose
  name is a valid-looking session UUID, so "the new file's stem is the id" will otherwise adopt a
  directory as a session.
- **The snapshot must cover every project dir, not just the current cwd's**, because the encoded
  directory may not exist yet on a first run in that folder.
- **An exclude set is mandatory.** Without excluding ids already claimed by other live blocks, N agents
  started in one directory all converge on the same conversation.
- **`--resume=<id>` must use the equals form.** `--resume` takes an optional argument in Claude's CLI,
  so `--resume <id>` parses as "open the picker" plus a stray positional. This is a landmine worth a
  comment in the code.
- **The fallback ladder is three-deep:** `--resume=<id>` when an id was captured → `--continue` when it
  was not → plain spawn. After a `--continue` spawn, record which session it landed on immediately, or a
  second `--continue` in the same directory hijacks a different conversation.
- **Cost and tokens come from OpenTelemetry, not from parsing JSONL.** Spawn the agent with
  `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`,
  `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<ephemeral>`,
  `OTEL_METRIC_EXPORT_INTERVAL=3000`, `OTEL_METRICS_INCLUDE_SESSION_ID=true`, and
  `OTEL_RESOURCE_ATTRIBUTES=terminal.id=<block>` — that last attribute is how one receiver demultiplexes
  many agents.
- **Counters arrive as DELTA increments** (`aggregationTemporality=1`), verified against claude
  v2.1.159: each export is the delta since the last, so the receiver sums them and the frontend takes
  **latest-value-wins, never summing again**. Token values are `asDouble`; the type key is `type` with
  camelCase values `input`/`output`/`cacheRead`/`cacheCreation`.
- **Parse defensively**: accept `asInt`-as-string, `asInt`-as-number and `asDouble`; reject NaN, inf and
  negatives before any cast; read from either `sum` or `gauge`.
- **Cache reads dominate volume but not cost.** The reference's metrics panel explains this in tooltips
  and it is the difference between a number that informs and a number that alarms.
- **Every terminal's raw output is teed to a log file** in the reference, and that log is what powers
  history, summaries and the timeline. SLTerm already writes terminal output to a **circular,
  size-capped** block file (`pkg/blockcontroller/shellcontroller.go:393,570`) — capped bytes are not a
  navigable history, so this phase needs a real per-session record either way.
- **A session summary is one `claude -p` call.** Strip ANSI from the last ~100 KB of log, pipe to
  `claude -p --model haiku "Summarize what was accomplished…"`, cache the result. Every failure path
  returns "no summary" rather than an error.
- **SLTerm has no resume, no history and no cost surface today** — verified: no `--resume`, `--continue`
  or session-id handling anywhere in `pkg/` or `frontend/`, and the only `sessionId` hits belong to the
  unrelated durable-shell input queue. Durable shell reattaches a *live* PTY; it is process persistence,
  not conversation resume.
- **New RPC families go on `WshRpcInterface`.** `pkg/wshrpc/wshrpctypes.go` closes the interface at
  `:215` with pet / ai tools / agent teams grouped under comment headers — that is the template. Methods
  end in `Command`, take `ctx` first, at most one param; `task generate` regenerates bindings and is
  deliberately uncached.

## Requirements

**Functional**

- Agent features are available on the launch paths phase 4 defines; a block launched by hand can be
  promoted, and the plan states plainly that resume flags and OTEL env are **spawn-time only**, so a
  promoted block needs a respawn to gain them.
- List past Claude Code sessions for a block's working directory, newest first, each with a preview of
  its first user message.
- Resume any of them into a new or existing block, using the correct flag form.
- Two agents started in the same directory never adopt the same session.
- A session record exists per agent run: label, start, end, working directory, session id, log path.
- Live token counts (input, output, cache read, cache write) and estimated cost for the active session,
  with an optional budget bar.
- An on-demand plain-language summary of what a session accomplished.

**Non-functional**

- All of it in Go under `pkg/`; the Rust shell gains nothing.
- The OTLP listener binds loopback on an ephemeral port and is only enabled when cost tracking is on.
- Cost tracking is opt-in and off by default, consistent with `telemetry:enabled` being off.
- Session discovery tolerates a missing or empty `~/.claude` without erroring.

## Architecture

```
pkg/claudesession/
  discover.go      project-dir enumeration + cwd match (encoder as a fast path only), snapshot of
                   regular *.jsonl files, find_new_for_cwd(exclude), list_for_cwd
  preview.go       first user message from the JSONL head, both content shapes, 120-char truncate
  resume.go        the --resume=<id> / --continue / plain ladder, and recording what --continue landed on
  record.go        per-run session rows over the existing SQLite layer
  summarize.go     ANSI strip + claude -p --model haiku, cached
pkg/otelrecv/
  server.go        loopback HTTP, OTLP/JSON, per-terminal.id demux
  aggregate.go     DELTA sums → cumulative snapshot per session
pkg/wshrpc         ClaudeSessionList/Resume/GetRecord/Summarize + SessionMetricsGet commands
frontend/app/view/sessions/     view:sessions block — list, timeline, history, insights
frontend/app/element/session-hud.tsx    tokens + cost chip, reads the phase-4 state atoms
```

The metrics contract, stated once so it is not re-derived: **the Go receiver sums DELTA exports into a
running total and publishes the cumulative snapshot. The frontend replaces its value with the latest
snapshot. It never sums.**

Sessions surface as a **block view**, not a modal, so it composes with the tiling layout the same way
`aitools` and `agentteams` already do — the reference uses modals because it has no tiling model.

## Related Code Files

- Create: `pkg/claudesession/{discover,preview,resume,record,summarize}.go` + tests
- Create: `pkg/otelrecv/{server,aggregate}.go` + tests
- Create: `frontend/app/view/sessions/{sessions.tsx,sessions-model.ts,timeline.tsx,history.tsx}`
- Create: `frontend/app/element/session-hud.tsx`
- Modify: `pkg/wshrpc/wshrpctypes.go` (new command family + data structs after the AI-tools structs),
  then `task generate`
- Modify: `pkg/blockcontroller/shellcontroller.go` (`createCmdStrAndOpts` for the resume flags — note it
  is called only on the `BlockController_Cmd` branch at `:425-431`, so a plain shell block never receives
  them; the OTLP env injection; the session-stop emit at `:608`) and `blockcontroller.go` (`Controller.Stop`
  at `:99,278,326`)
- Modify: `pkg/wconfig/defaultconfig/settings.json` (`claudesession:*`, `cost:*`),
  `widgets.json` (a sessions widget)
- Modify: `pkg/waveserver` if the OTLP listener should start with the server rather than per block
- Reference (read-only): `/home/stackops/saly/claude-terminal/src-tauri/src/claude_session.rs`,
  `otel_receiver.rs`, `terminal.rs:132-146` (resume) and `:253-263` (OTLP env),
  `commands.rs:315-335` (ladder), `:3058` (summarize), `src/lib/sessionMetrics.ts`,
  `src/components/Session{sPanel,History,Timeline,Insights,MetricsPanel}.tsx`

## Implementation Steps

1. **5.1 `pkg/claudesession` discovery.** Resolve a cwd to its project directory by enumerating
   `~/.claude/projects` and matching the `cwd` recorded inside each conversation's JSONL, with a path
   encoder as a fast path only — a reimplemented encoder is not trustworthy as the sole key (see Key
   Insights). Write the tests first, including a dotted path captured from a real listing. Snapshot only
   regular `*.jsonl` files, then find-new-with-exclude / list-for-cwd, returning
   `{id, modifiedAt, preview}` sorted newest-first.
2. **5.2 Preview.** Scan the first ~20 JSONL lines for `type == "user"`, handle both content shapes
   (plain string, or an array of blocks with `.text`), collapse whitespace, truncate to 120 chars.
3. **5.3 Resume ladder.** Inject `--resume=<id>` (equals form, with a comment saying why) or `--continue`
   into the command built by `createCmdStrAndOpts`. Do **not** persist the injected flag into the block's
   saved command — each restart re-decides. Record the landed session id right after a `--continue`.
4. **5.4 Session records.** One row per agent run over the existing SQLite layer, using SLTerm's own
   migration mechanism rather than the reference's ALTER-and-swallow loop. Emit **start** where the
   controller spawns, and **stop** from the single place that sets the terminal status —
   `pkg/blockcontroller/shellcontroller.go:608` (`bc.ProcStatus = Status_Done`) plus `Controller.Stop`
   (`blockcontroller.go:99,278,326`) — or by subscribing server-side to the controller runtime-status
   event. The status *checks* at `blockcontroller.go:214,244` are start-path gates, not transitions;
   hooking them yields records with a start and no end. Add a test that kills the child and asserts the
   end time is set.
5. **5.5 Per-session log.** Decide whether the circular block file is enough or a separate uncapped
   per-session log is needed for history and summaries. If a new log: bound it, put it under the data
   dir, and confine reads to that directory with a size cap on the tail.
6. **5.6 OTLP receiver.** Loopback HTTP, OTLP/JSON, ephemeral port, `terminal.id` demux, DELTA sums,
   defensive number parsing. Bind once per app, not once per block.
7. **5.7 Env injection.** Add the seven OTEL vars when cost tracking is on **and** the receiver bound a
   port. Never inject a half-configured set.
8. **5.8 `view:sessions`.** List for the current block's cwd with one-click resume; timeline over session
   records with duration formatting and a filter box; per-run history viewer. Resume into the session's
   recorded working directory, not the app's cwd.
9. **5.9 Session HUD.** Tokens, cost, and the phase-4 state glyph in one compact chip. Keep the
   educational tooltips explaining why cache reads are large but cheap; a budget bar that turns red at or
   over `cost:sessionbudgetusd`.
10. **5.10 Summaries.** ANSI-strip the log tail, pipe to `claude -p --model haiku`, cache per session,
    return empty on every failure path.

## Todo

- [ ] 5.1 Project-dir resolution by recorded cwd, `*.jsonl`-only snapshot, find-new-with-exclude, tests
      including a dotted path
- [ ] 5.2 First-user-message preview, both content shapes
- [ ] 5.3 `--resume=<id>` / `--continue` ladder with landed-id recording
- [ ] 5.4 Session records with start **and** end, emitted from the real status transition
- [ ] 5.5 Per-session log decision and implementation
- [ ] 5.6 Go OTLP receiver with DELTA aggregation and defensive parsing
- [ ] 5.7 OTEL env injection gated on cost tracking + a bound port
- [ ] 5.8 `view:sessions` block + widget: list, timeline, history
- [ ] 5.9 Session HUD with tokens, cost and budget bar
- [ ] 5.10 Cached `claude -p` summaries

## Success Criteria

- [ ] Run `claude` in a directory, exit, reopen: the session appears in the list with a recognisable
      preview and resumes with its context intact
- [ ] Two agents in the same directory get two different session ids
- [ ] Directories whose paths contain a space, a drive letter, and a leading dot all resolve to the right
      project dir; a UUID-named subdirectory is never adopted as a session
- [ ] Token counts move while an agent works and match `/cost` inside Claude Code within rounding
- [ ] Cost tracking off → no OTEL vars in the child environment, and no listener bound
- [ ] Killing an agent's process writes an end time; the timeline shows a finished duration, and the
      cached summary triggers
- [ ] The timeline resumes a session into its own working directory
- [ ] A summary appears for a finished session and is not recomputed on reopen
- [ ] `~/.claude` absent → empty list, no error

## Risk Assessment

- **Private, undocumented contracts.** `~/.claude/projects` layout, the JSONL shape, the OTEL metric
  names and `--resume`'s parsing are all internal to Claude Code and can change without notice.
  *Signal:* discovery returns nothing, or token counts stop moving after a Claude Code update.
  *Response:* every one of these is isolated behind one Go file with tests; treat a break as a
  patch-level fix, and keep the app fully functional with the session layer degraded (list empty, HUD
  hidden) rather than erroring.
- **Cost numbers are estimates.** Publishing a wrong dollar figure is worse than publishing none.
  *Response:* label it "estimated", show the token counts (which are measured) more prominently than the
  cost, and state the pricing table's date in the tooltip.
- **The DELTA-vs-cumulative contract is exactly the kind of thing that gets re-derived wrong.** A second
  summation in the frontend doubles every number. *Mitigation:* the contract is stated once in the
  architecture section above, and the aggregation has a unit test asserting three DELTA exports produce
  the sum once.
- **`--continue` hijacking.** *Signal:* an agent resumes someone else's conversation. *Response:* record
  the landed id immediately after spawn; the exclude set covers the concurrent case.
- **Scope creep into a full transcript viewer.** The JSONL contains the entire conversation and it is
  tempting to render it. That is a chat UI, which the landscape research explicitly advises against as a
  first move. Keep this phase to list / resume / metrics / summary.

## Security Considerations

- The OTLP listener must bind `127.0.0.1` only, on an ephemeral port, and accept only OTLP/JSON. Any
  local process can post to it; treat received metrics as untrusted numbers and never as commands.
- Session previews and summaries come from conversation content. They are shown to the user who owns
  them, but truncate hard and strip control characters before rendering.
- Session ids are injected into a command line. Reject any id that is not a plain UUID before it reaches
  `exec`; the reference rejects shell metacharacters explicitly, and Go's `exec` not using a shell is not
  a reason to skip validation.
- Log reads must be confined to the session log directory by canonicalised prefix check, with a byte cap.
- Do not send session content anywhere. The summariser runs the user's own local `claude` binary.

## Next Steps

Phase 6 (change review) shares the path-confinement helper written here. Phase 7's agent board shows
session cost per card and resumes from the board.

