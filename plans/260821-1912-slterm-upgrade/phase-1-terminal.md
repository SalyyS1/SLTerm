# Phase 1 — Terminal rendering hardening

**Est.** 2-3 weeks · **Runtime-independent** · **Depends on:** Phase 0 benchmarks

## Status

| Item | State | Notes |
|---|---|---|
| 1.1 Stop recreating xterm on settings change | **done** | Rebuild deps narrowed to `blockId`, scrollback, transparency, WebGL. Font size/family, `macOptionIsMeta` and bracketed paste apply in place via `term-live-options.ts`. |
| 1.2 Explicit ordered-replay invariant | **done** | `replayInitialData` in `termwrap.ts`; held appends reconciled by absolute file offset in `term-replay.ts`. |
| 1.3 Circular-filestore wrap guard | **done** | Wrap detected from the file's own `DataStartIdx`; snapshot dropped and the grid reset rather than spliced. |
| 1.4 Spawn-time PTY sizing | open | |
| 1.5 Binary WS frames | **partly** | The base64 round-trip is still there. What *was* fixed is a byte-corruption bug the review missed — see below. |
| 1.6 Carry-over on layout remount | open | |
| 1.7 Decouple background from renderer | open | |
| 1.8 Regression suite | **partly** | Unit tests cover the reconciliation, the writer and scrollback resolution. The view-transition suite is not built. |

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

### 1.6 Carry-over on layout-tree remount

`frontend/layout`'s `treeReducer` move/swap actions genuinely unmount a block's view. Snapshot via
`SerializeAddon` and replay verbatim on remount, matching what claude-terminal's `carryOverBuffer`
does for its tab→grid→split transitions.

### 1.7 Decouple background from renderer choice

Transparency/background currently forces `allowTransparency=true`, which **disables WebGL** and
drops xterm to the slower canvas renderer (`term.tsx`). Every vibe background therefore costs
rendering performance — a direct conflict between two things the user values.

Move the background compositing so the renderer choice is independent of it.

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

## Validation

- Full regression suite green.
- Font/theme change no longer disposes `TermWrap` (assert via instance identity in a test).
- WebGL renderer confirmed active **with** a background enabled.
- Throughput check: `yes | head -c 50M` in a terminal, no dropped or duplicated lines, UI responsive.
- Benchmark comparison against Phase 0 for the base64 removal.

## Risk / rollback

**1.1 is the riskiest item** and also the most valuable — applying font changes live means finding
every xterm option that needs a mutate-in-place path, and getting it wrong shows up as a wrong-sized
grid rather than a crash. Land it behind the regression suite, not before it.

1.5 touches the WS wire format; version the frame type or gate it behind a setting so a bad batch
decode does not brick terminal output. 1.3 and 1.4 are additive guards. 1.7 may reveal that the
compositor needs the background moved out of the terminal element entirely — if that turns into a
layout rewrite, defer 1.7 to Phase 6 and keep the perf note documented.
