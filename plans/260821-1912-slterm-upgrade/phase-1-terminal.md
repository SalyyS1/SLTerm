# Phase 1 — Terminal rendering hardening

**Est.** 2-3 weeks · **Runtime-independent** · **Depends on:** Phase 0 benchmarks

## Status

| Item | State | Notes |
|---|---|---|
| 1.1 Stop recreating xterm on settings change | **done** | Rebuild deps narrowed to `blockId`, scrollback, transparency, WebGL. Font size/family, `macOptionIsMeta` and bracketed paste apply in place via `term-live-options.ts`. |
| 1.2 Explicit ordered-replay invariant | **done** | `replayInitialData` in `termwrap.ts`; held appends reconciled by absolute file offset in `term-replay.ts`. |
| 1.3 Circular-filestore wrap guard | **done** | Wrap detected from the file's own `DataStartIdx`; snapshot dropped and the grid reset rather than spliced. |
| 1.4 Spawn-time PTY sizing | **done** | The first resize is what starts the shell, so it is gated on a measurement that means something; a timer starts the shell anyway for a block that never gets a layout. Remote jobs no longer hard-code 80x24 at spawn. The spawn size is recorded so a restart without runtime opts starts where the block was. |
| 1.5 Binary WS frames | **blocked — premise does not hold** | See below. The base64 round-trip is still there. Two real fixes landed on this path instead: a byte-corruption bug in the writer, and skipping the encode entirely when nothing is subscribed. |
| 1.6 Carry-over on layout remount | **done** | The outgoing instance parks its serialized screen; the incoming one restores it instead of re-reading the term file. Parked with the offset xterm has *parsed*, not the one it was handed, so writes still in xterm's queue are re-read rather than lost. Single-use, 10s TTL, bounded. |
| 1.7 Decouple background from renderer | **done** | `allowTransparency` is now always on and no longer gates WebGL: addon-webgl 0.19 honours it. Every themed window was on the slow renderer by default, because the default transparency of 0.5 made the guard fire. Also removes a rebuild trigger — a background change no longer replays the scrollback. |
| 1.8 Regression suite | **done for the stream, GUI half blocked** | `view-transitions.test.ts` asserts no duplicated and no lost scrollback across every transition in the list, by driving the real writer, carry-over store and reconciler. A mutation check confirms it fails when the parked offset stops respecting xterm's write queue. Real tile drags and SSH blocks still need a window. |

### Two bugs found in the code, not in the plan

**Held output was discarded, never replayed.** `handleNewFileSubjectData` pushed live appends into
`heldData` while the initial read was in flight, and nothing ever drained it. Every byte that
arrived during the read window was dropped on the floor — the exact failure this phase was written
to prevent, already present. Fixed by giving append events their absolute file offset
(`WSFileEventData.Offset`, from the new `filestore.AppendDataWithOffset`) so the held bytes can be
reconciled against the read instead of guessed at: already-read chunks are skipped, a partly-read
chunk is written from where the read stopped, and a gap forces a clean reread.

**`BatchedWriter` decoded bytes to a string per flush.** It built a `TextDecoder` inside `flush()`
and fed chunks through it with `{stream: true}`. The streaming state died with the decoder at the
end of each flush, so a UTF-8 character split across a flush boundary lost its leading bytes and the
continuation arrived as `U+FFFD`. One dropped byte wedges xterm's escape parser — which is precisely
the mechanism this phase identified as the cause of stacked duplicate lines. The writer now
concatenates adjacent byte chunks and never decodes.

## Goal

Make the output path provably duplicate-free and byte-faithful under every view transition, before
anything else destabilizes it. This is the phase that delivers the quality the user actually asked
for.

## Context — what the reference actually does

claude-terminal has **no dedup algorithm**. No reflow, no line buffering, no output
post-processing. Its Claude output is clean because it is scrupulously faithful to the raw PTY byte
stream, so Claude Code's own ANSI cursor-repositioning redraws (spinner, input box, progress) land
as **in-place overwrites** instead of re-appended copies. Four disciplines produce that:

1. **Real OS PTY** via `portable-pty` — not a pipe. Claude detects a tty and enables its full
   ANSI redraw UI. A pipe makes it fall back to degraded rendering, a common source of garbled
   output elsewhere.
2. **Bytes never decoded to a string** on the output hot path:
   `PTY → Vec<u8> → mpsc → number[] → Uint8Array → xterm.write()`. xterm's VT500 parser buffers
   incomplete UTF-8 and incomplete escape sequences across chunk boundaries internally, so
   arbitrary 32KB read splits cannot corrupt a sequence.
3. **No local echo.** `terminal.onData()` forwards keystrokes only to the PTY; the screen is
   painted solely by the PTY's echo coming back. Input-doubling is impossible by construction.
4. **Pre-attach buffering** (their issue #48). Output arriving in the spawn→attach race is buffered
   per-id (bounded 512KB) and replayed in order on attach. **Dropping the leading `ESC` of Claude's
   banner wedges xterm's escape parser, and every subsequent redraw then renders as stacked
   duplicate lines.** This is the actual bug other terminals have.

Plus: xterm owns reflow entirely, and PTY cols/rows are kept equal to render width so Claude wraps
at the width it is being drawn at.

## Context — where SLTerm stands

SLTerm is **already structurally sound**. `frontend/app/view/term/termwrap.ts:loadInitialTerminalData`
fetches a serialized snapshot (`cache:term:full`) plus the main term file **from a byte offset**
(`ptyOffset`), and the live WPS subscription only appends bytes past that offset. There is no
admitted duplicate-line bug and no comment suggesting one.

So this phase does **not** import a fix for a bug SLTerm doesn't have. It hardens four real weak
seams the review found.

## Work

### 1.1 Stop recreating xterm on every settings change  ← highest payoff

`frontend/app/view/term/term.tsx:329`:

```ts
}, [blockId, termSettings, termFontSize, connFontFamily]);
```

Any font-size, font-family, or settings change **disposes the entire `TermWrap` and re-runs
`loadInitialTerminalData`**. That is the most likely source of user-visible duplicated or lost
scrollback in SLTerm today.

Narrow the deps to `blockId` (plus `scrollback`/`bidi`, which genuinely require a recreate). Apply
font family and size **live**, the way `termtheme.ts`'s `TermThemeUpdater` already applies theme by
mutating `terminal.options.theme` in place without re-instantiating.

Note the asymmetry this fixes: theme changes are already live, font changes are not.

### 1.2 Explicit ordered-replay invariant

In `termwrap.ts:loadInitialTerminalData`, make the ordering an enforced, documented invariant:

1. subscribe to the WPS stream **first**
2. buffer live chunks with a hard byte cap
3. then write in exactly this order: snapshot → history-from-`ptyOffset` → buffered live chunks

This is SLTerm's equivalent of claude-terminal's `pendingOutputBuffers` drain, and it closes the
same race. Cover it with a test.

### 1.3 Circular-filestore wrap guard

SLTerm's `ptyOffset` correctness hinges on the offset staying consistent with the circular
filestore's wrap point (`pkg/blockcontroller/blockcontroller.go:HandleAppendBlockFile` writes to a
`Circular` file with `MaxSize`). If the file wraps **between** the snapshot fetch and the offset
fetch, replay can double- or under-render.

Detect the wrap and fall back to a clean full reload. This is a latent edge case, not a confirmed
bug — add the guard rather than assume it cannot happen.

### 1.4 Spawn-time PTY sizing

`pkg/shellexec/shellexec.go:StartLocalShellProc` calls `pty.StartWithSize`. Pass measured
cols/rows in via block meta so the shell never paints at the wrong width before the first resize
arrives.

claude-terminal has an open bug here — it hard-codes 120x30 at spawn and only pushes real size from
the `ResizeObserver`, leaving a race window (their own `DIAG(pty-size)` traces are hunting it, and
it produces ghost characters after `/clear`). Do not inherit that.

### 1.5 Binary WS frames for terminal output

Today output is base64-encoded in Go (`HandleAppendBlockFile` publishes `Data64`) and
`base64ToArray`-decoded in `handleNewFileSubjectData` — a double encode on the hot path.

`pkg/web/ws.go`'s `WSBatcher` already has a binary batch format
(`[count:4B LE][len:4B LE][msg bytes]...`, decoded by `decodeBinaryBatch`). Route terminal output
through it and drop the base64 round-trip.

**That premise is wrong, and the item is blocked on a decision, not on effort.** The batch format
frames *JSON messages* — it saves per-frame WebSocket overhead, not the encode. Terminal output does
not reach `WSBatcher` as a payload it could carry raw; it arrives as already-marshalled JSON, because
the event goes `wps.Broker` → `wshrpc` → `OutputCh chan []byte` → `WriteLoop`. Routing it "through
the batcher" changes nothing about base64.

Removing the encode means one of three things, each with a cost the plan did not price:

1. **Teach `wshrpc` to carry a binary payload alongside the JSON envelope.** This is the clean
   answer and it is a protocol change to a transport that is also spoken over ssh/pty to remote
   hosts. `AdaptOutputChToStream` delimits messages with `\n`, so a raw payload containing `\n`
   corrupts framing for every remote connection. Payload encoding would have to become
   transport-aware.
2. **Publish appends on a second, binary-only channel straight to the browser socket.** Cheaper, but
   it splits one ordered stream in two: `truncate` still arrives over RPC while `append` arrives over
   the new path, so a `clear` can be applied out of order against the output around it. That is a
   correctness regression traded for throughput.
3. **Leave it.** The encode costs one 4/3-sized allocation per PTY read on a path that already
   works, and no measurement on this machine says it is the bottleneck — there is no display to
   benchmark a renderer against.

What landed instead, both real: the writer no longer corrupts UTF-8 split across a flush (below), and
`HandleAppendBlockFile` now asks `wps.Broker.HasSubscribers` before encoding, so a server with no
window attached stops paying for events the broker would drop. An attached window subscribes to
`blockfile` for all scopes, so that saving is the no-client case only — durable shells and jobs
producing output while the window is closed.

**Decide 1 vs 3 with a profile, on a machine with a display.** Do not take 2.

### 1.6 Carry-over on layout-tree remount

`frontend/layout`'s `treeReducer` move/swap actions genuinely unmount a block's view. Snapshot via
`SerializeAddon` and replay verbatim on remount, matching what claude-terminal's `carryOverBuffer`
does for its tab→grid→split transitions.

**Landed as `term-carry-over.ts`.** The outgoing instance parks its serialized screen keyed by block
id; the incoming one takes it in `loadInitialTerminalData` ahead of the cache file, then range-reads
the term file from where the snapshot ends. Restores are single-use with a 10s TTL, capped at 16
screens and 4 MB each, so a closed block's screen cannot be resurrected later or held indefinitely.

Two things this had to get right that the plan did not mention:

- **xterm's `write` is asynchronous.** Serializing right after handing bytes over produces a screen
  that does not contain them, while `ptyOffset` says it does — and the replacement would then read
  *past* those bytes and never display them. So the writer now reports back when xterm has finished
  parsing a batch, and the parked offset is the parsed one. Anything in flight is read again, which
  is safe; anything skipped would have been a silent hole.
- **A snapshot has a width.** It is written at the geometry it was taken at and the terminal is put
  back afterwards, because xterm reflows on resize and restoring at the new width would rewrap lines
  that were already wrapped.

It also covers the remaining half of 1.1: scrollback, transparency and renderer changes rebuild
`TermWrap` by construction, and those transitions now carry the screen across too.

### 1.7 Decouple background from renderer choice

Transparency/background currently forces `allowTransparency=true`, which **disables WebGL** and
drops xterm to the slower canvas renderer (`term.tsx`). Every vibe background therefore costs
rendering performance — a direct conflict between two things the user values.

Move the background compositing so the renderer choice is independent of it.

**Worse than the plan thought, and simpler to fix.** The guard was not limited to backgrounds:
`term:transparency` defaults to `0.5`, so `needsTransparency` was true for a default install and
**every terminal ran on the canvas renderer**. WebGL was effectively dead code unless the user
explicitly set transparency to 0 or 1.

The premise behind the guard no longer holds either. `@xterm/addon-webgl` 0.19 (shipped here with
xterm 5.5) supports transparency: it forces colors opaque only when `allowTransparency` is *off*,
builds its character atlas with an alpha channel when it is on, enables `SRC_ALPHA` blending, and
never clears to an opaque color. Verified by reading the shipped bundle rather than the changelog —
the exact code in `node_modules` is the authority for what this build does.

So the coupling is simply removed: `allowTransparency` is always on — which is what the rest of the
architecture already assumes, since `computeTheme` hands xterm a fully transparent background and
returns the real color for the block frame to paint behind it — and WebGL attaches regardless.
`term:disablewebgl` remains the escape hatch if a driver renders it badly.

Two side effects, both wanted: a fully-opaque `term:transparency: 0` no longer paints an opaque black
grid over the themed background, and background/transparency changes no longer rebuild the terminal,
which is one fewer scrollback replay (the same class of churn 1.1 was about).

### 1.8 Regression suite

In `tests/` + `testdriver/`. Each case asserts **no duplicated and no lost scrollback**:

- font family change mid-session
- font size change mid-session
- theme change mid-session
- tile drag / move / swap in the layout tree
- split
- tab switch
- window resize during heavy output
- `clear` immediately after burst output
- remote / SSH block

Retain the existing IME and paste dedup guards in `termwrap.ts` (composition-state gating, 30ms IME
dedup window vs `lastComposedText`, paste dedup via `lastPasteData`/`lastPasteTime`) — those are
input-side and unrelated to this work, but easy to break by accident.

**Landed as `tests/view-transitions.test.ts`, for the byte stream.** Every transition in the list
above has a case, and each asserts the same two things: the output appears exactly once and in order.
The suite drives the real modules that decide it — `BatchedWriter`, `term-carry-over`, `reconcileHeldData`
— composed the way `TermWrap` composes them, against a terminal that records bytes instead of painting
them and that parses asynchronously like the real one.

It has teeth: reverting the writer to report parse completion synchronously (the pre-1.6 behaviour)
fails exactly the two cases about writes in flight, and fails them with *lost* output, which is the
bug class the phase exists for.

What it does not cover, and cannot here: the browser half. A real tile drag, a real tab switch through
the layout tree, a real SSH block and the resize that comes from a real `ResizeObserver` need a window.
That is the same gate Phase 3's benchmarks are behind — `testdriver/` runs in CI against a built app,
and this machine has no display to run it locally.

## Validation

- Full regression suite green. **Done** for the stream-level suite (`npx vitest run frontend/`).
- Font/theme change no longer disposes `TermWrap` — font size, family, `macOptionIsMeta` and bracketed
  paste apply in place via `term-live-options.ts`, and theme goes through `TermThemeUpdater`, so none of
  them is in the rebuild deps any more. **Instance-identity assertion still needs a DOM.**
- WebGL renderer confirmed active **with** a background enabled. **Needs a display** — the coupling that
  prevented it is gone (1.7) and the addon's transparency support was verified by reading the shipped
  bundle, but nothing has watched it paint.
- Throughput check: `yes | head -c 50M` in a terminal, no dropped or duplicated lines, UI responsive.
  **Needs a display.**
- Benchmark comparison against Phase 0 for the base64 removal. **Moot** — the base64 removal is blocked
  on the decision in 1.5, not on measurement of a change that was not made.

## Risk / rollback

**1.1 is the riskiest item** and also the most valuable — applying font changes live means finding
every xterm option that needs a mutate-in-place path, and getting it wrong shows up as a wrong-sized
grid rather than a crash. Land it behind the regression suite, not before it.

1.5 touches the WS wire format; version the frame type or gate it behind a setting so a bad batch
decode does not brick terminal output. 1.3 and 1.4 are additive guards. 1.7 may reveal that the
compositor needs the background moved out of the terminal element entirely — if that turns into a
layout rewrite, defer 1.7 to Phase 6 and keep the perf note documented.
