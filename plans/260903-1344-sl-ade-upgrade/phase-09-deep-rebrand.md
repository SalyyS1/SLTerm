---
phase: 9
title: "Phase 9: Deep rebrand"
status: todo
priority: P3
effort: "1-2w"
dependencies: [2, 3, 4, 5, 6, 7, 8, 10]
---

# Phase 9: Deep rebrand

## Overview

**This entire phase is last.** Do not execute “safe” prose/env/copyright rungs early: phase 10 adds new
packages, CLI strings, generated RPC clients, settings and docs that must participate in the same fresh census,
and early partial rename creates two naming contracts for active branches. Every step 9.1–9.8 therefore waits
for phases 2–8 and 10, requires no open implementation branch, and runs in the listed order. Rewriting import
blocks conflicts with every open branch, and `task generate` on a stale branch silently regenerates wshrpc
clients carrying the old module path. Exact import counts from 2026-09-03 are historical and must be freshly
counted at execution.

Finish what phase 2 started. Phase 2 changed what users see and what the installer keys on; this phase
changes what the code says: environment variable names, the Go module path, the copyright header, the
terminal's self-identification, and finally the repository name. All of it is mechanical, none of it is
load-bearing for shipping, and one item (the keyring service) is deliberately left alone.

## Key Insights

- **82 % of the 2026-09-03 brand census was two mechanical sweeps.** Historical count: 1,463 hits for
  `SLTerm|slterm|SLTERM|Salyvn` across `pkg` + `cmd` + `frontend`, including 721 Go import-path hits and
  483 copyright-header hits. Phase 10 and intervening code will change these numbers; freshly enumerate
  before execution and treat the report only as sizing evidence.
- **The env vars split into two classes.** Nineteen are process-scoped and set by the app on every launch
  (`_AUTH_KEY`, `_DATA_HOME`, `_CONFIG_HOME`, `_APP_PATH`, `_JWT`, `_SWAPTOKEN`, `_TABID`, `_BLOCKID`,
  `_WORKSPACEID`, `_CLIENTID`, `_JOBID`, `_ZDOTDIR`, `_WSHBINDIR`, `_SI_*`, `_PTY_OK_`) — producer and
  consumer ship together, so they rename atomically with no migration. Seven are **user-settable
  overrides** (`SLTERM_CONFIG_HOME`, `SLTERM_DATA_HOME`, `SLTERM_HOME`, `SLTERM_DEV`, `SLTERM_DEV_VITE`,
  `SLTERM_WSHFORCEUPDATE`, `SLTERM_NOCONFIRMQUIT`) and need an alias for a couple of versions.
- **Shell-integration rc snippets are templates, not user files.** They are rendered into the data dir on
  every launch with `WSHBINDIR` substituted, so renaming a variable inside them is a same-commit change
  for local shells.
- **Remote hosts are the exception.** A machine you have SSH'd into holds an older `wsh` at
  `~/.slterm/bin/wsh` that reads the **old** variable names from the **new** client's rc snippet. Either
  force a `wsh` update on connect or leave those specific variables alone. Leaving them alone is cheaper
  and the contract is internal.
- **Do not rename `wsh`.** It is inherited Wave nomenclature, carries no brand, is what remote hosts have
  on disk, and every rc snippet references it bare.
- **Do not rename the socket basenames.** `wave.sock` and `wave-remote.sock` are still *Wave*-branded, not
  SLTerm-branded, and they live inside the data dir, so the phase-2 directory alias already covers them.
  Renaming them forces a remote reprovision for no gain.
- **Do not rename the keyring service.** It is keyed on `(service, account)` strings only on all three
  platforms, so it is unaffected by the bundle identifier — but renaming the service string itself makes
  the app generate a fresh master key and the sealed secret store stops opening, with **no backup written
  on that path**. Phase 2 recorded this; the decision here is to keep `"SLTerm"` permanently with a
  comment saying why. A stale string in Keychain Access costs nothing.
- **`TERM_PROGRAM=slterm` is a third-party contract.** Starship, oh-my-posh and editors read it to
  identify the terminal. Changing it breaks nothing of ours and silently changes how other tools behave —
  change it, but treat it as user-visible and put it in the release notes.
- **`IssuerSLTerm = "slterm"` is safe to rename only if no JWT is persisted across restarts.** Minting and
  validation ship together in one process lifetime. UNVERIFIED whether any token is written to disk;
  check before touching it.
- **The repo rename is mechanically straightforward only after its gates pass.** GitHub redirects most old
  URLs, but project sites/published Actions and a recreated old repository can break assumptions. Rewrite
  every freshly enumerated in-repo import in the same commit as `go mod edit -module`; prove updater and
  clone/release URLs rather than declaring the rename intrinsically safe.
- **`sl-ade` is free everywhere checked** (GitHub org, npm, PyPI, crates.io, Homebrew cask). `slade` is
  not: an 864★ Doom editor owns the name with its own domain, and `slade-cli` is live on npm.

## Requirements

**Functional**

- Internal env vars carry the new prefix; the seven user-settable ones accept both, with a one-time
  deprecation line on the old name.
- The Go module path is `github.com/SalyyS1/sl-ade` and every import follows.
- The repository is renamed; existing clones, release URLs and `go get` keep working.
- Docs, README and copyright headers say SL-ADE / Salyvn consistently.
- Existing installs keep finding their data and their secrets.

**Non-functional**

- The entire phase starts only after phases 2–8 and 10 finish and no implementation branch remains open.
- Each sweep is its own commit, so any of them can be reverted independently.
- No remote host is broken by a variable rename.
- Failure of one rung stops later rungs; it does not authorize interleaving rebrand work with earlier phases.

## Architecture

Four rungs, executed only after all prerequisite phases. Phase 2 performed the installer/user-visible identity
migration; it did not authorize starting this deep-rebrand phase early.

```
rung 1  DONE in phase 2   productName, identifier, exe, window title, About, icons, installer names
rung 2  DONE in phase 2   data-dir alias (~/.sl-ade → ~/.slterm), release naming
rung 3  THIS PHASE, LAST  env prefix (+aliases), TERM_PROGRAM, JWT issuer, __SLTERM_HOST__, copyright
                           headers, docs [after phases 2-8 and 10]
rung 4  THEN LAST RUNGS    Go module path + every current import, repository rename
                           [same exclusive final-phase window, no open branch]
NEVER                     wsh CLI name, wave.sock basenames, keyring service "SLTerm",
                          the remote-side ~/.slterm layout and its /tmp socket paths
```

The alias helper lives in one place in `pkg/wavebase`: read `SLADE_X`, fall back to `SLTERM_X`, log the
deprecation once. Only the seven overrides route through it — aliasing the nineteen internal variables
would be noise for a contract no one outside the process can see.

## Related Code Files

- Modify: `pkg/wavebase/wavebase.go` (env alias helper, the two required vars), and every
  `SLTERM_*` reference in `pkg/`, `cmd/`, `frontend/`, `src-tauri/`
- Modify: `pkg/util/shellutil/shellutil.go` (`TERM_PROGRAM`, the rc-snippet templates)
- Modify: `pkg/util/shellutil/shellintegration/*.sh` (variable names, local shells only)
- Modify: `pkg/wavejwt/wavejwt.go` (issuer — only after confirming no token is persisted)
- Modify: `go.mod` + every current import site (fresh census after phase 10); `Taskfile.yml`; `package.json`; `README.md`;
  `ACKNOWLEDGEMENTS.md`; `NOTICE`; every current copyright header
- Modify: `frontend/wave.ts`, `frontend/app/element/quicktips.tsx`,
  `frontend/app/view/term/{term-model.ts,termutil.ts}`, `pkg/wshrpc/wshserver/wshserver.go`,
  `pkg/web/web.go` (the ~26 real prose strings)
- Modify: `src-tauri/src/lib.rs` + `frontend/util/tauri-host.ts` + its test (the
  `window.__SLTERM_HOST__` contract — both sides ship together, rename atomically)

## Implementation Steps

1. **9.1 Final-phase gate, then env alias helper.** Verify phases 2–8 and 10 complete, no implementation
   branches/processes are active, working tree is clean except this phase, capture a fresh brand/import census
   and updater/repository baseline. Only then add the alias helper and rename internal variables atomically.
   Leave remote-facing ones alone, or gate them behind a `wsh` version handshake.
2. **9.2 `TERM_PROGRAM`.** Change it and put it in the release notes; expect it to be the thing nobody
   remembers when a prompt misbehaves.
3. **9.3 JWT issuer.** Confirm no token is persisted across restarts, then rename. If any is, skip it.
4. **9.4 Host snapshot key.** Rename `window.__SLTERM_HOST__` in Rust, the frontend and its test in one
   commit.
5. **9.5 Copyright + prose sweep.** Freshly enumerate headers and real strings after phase 10. Keep
   mechanical headers and reviewed user-facing text in separate commits.
6. **9.6 Module path — last, with no other branch open.** `go mod edit -module github.com/SalyyS1/sl-ade`
   plus a scripted rewrite of every freshly enumerated import, including orchestration phase 10, in a single
   commit with no other edits. Gate:
   `go build ./... && go test ./...`, **and** `task generate && git diff --exit-code` so regenerated wshrpc
   clients are proven to carry the new path rather than silently reintroducing the old one.
7. **9.7 Repository rename — last, and gated on the updater endpoint.** The endpoint frozen in phase 2 is
   `https://github.com/SalyyS1/SLTerm/releases/latest/download/latest.json`, so every shipped client depends
   on the repo name; after a rename it survives only on GitHub's redirect, which breaks the moment anything
   is created under the old name. So: either migrate `latest.json` off the repo first, or accept the
   redirect and prove it — install a pre-rename build, rename, and confirm that client still updates. Then
   rename on GitHub, update remotes, verify a release asset URL and a fresh clone resolve. Never create a
   stub under the old name.
8. **9.8 Docs.** README download table, feature list, and the "code signing policy" section that a
   SignPath application requires (phase 2).

## Todo

- [ ] 9.1 Final-phase gate proven (2–8 and 10 complete, clean/exclusive branch, fresh census), then env alias helper + internal variable rename
- [ ] 9.2 `TERM_PROGRAM` changed and noted in release notes
- [ ] 9.3 JWT issuer renamed, or skipped with a recorded reason
- [ ] 9.4 `__SLTERM_HOST__` renamed atomically across Rust, TS and its test
- [ ] 9.5 Copyright headers and prose strings
- [ ] 9.6 Go module path + every freshly enumerated import (including phase 10), build and tests green,
      `task generate` diff-clean (no open branch)
- [ ] 9.7 Repository renamed; endpoint migrated or the post-rename update proven; old URLs still resolving
- [ ] 9.8 Docs and README

## Success Criteria

- [ ] `SLADE_DATA_HOME` works; `SLTERM_DATA_HOME` still works and logs a deprecation once
- [ ] `go build ./... && go test ./...` pass after the module rename
- [ ] A pre-rename release asset URL still downloads
- [ ] A client installed before the repo rename still receives an update after it
- [ ] A fresh `git clone` of the old URL redirects and works
- [ ] `grep -rn "SLTerm" --include='*.go' --include='*.ts*' pkg cmd frontend src-tauri` returns only
      deliberate keepers: the keyring service string and its comment
- [ ] An existing install still finds its data and opens its secrets
- [ ] An SSH remote provisioned before the rename still connects

## Risk Assessment

- **The keyring service is the one item that destroys data if touched.** *Signal:* "secrets file does not
  open with this key". *Response:* this phase does not touch it. If a future change does, the read-through
  fallback to the legacy service must land first and the legacy entry must survive at least one minor
  version so a rollback still works.
- **Remote hosts with a stale `wsh`.** *Signal:* an SSH block connects but shell integration is dead.
  *Response:* do not rename the remote-facing variables, or force a `wsh` update on connect. Prefer the
  former.
- **Module rename churn hides a real change, and collides with every open branch.** A repo-wide import diff
  makes review noisy, and any outstanding branch conflicts in touched import blocks. *Mitigation:* 9.6 runs
  last after phase 10 with no other branch open, as one scripted commit with no other edits, and
  `task generate` must produce no diff afterwards — otherwise generated clients still carry the old path.
- **The repo rename can silently kill the update channel.** *Signal:* clients report up-to-date forever
  after the rename, because a 404 is indistinguishable from "no update". *Response:* 9.7 is gated on either
  an off-repo endpoint or a proven post-rename update.
- **`TERM_PROGRAM` breaks a third-party prompt.** *Signal:* a user's starship or oh-my-posh config
  misbehaves. *Response:* documented in release notes; revert is one line if it turns out to matter.
- **The name itself.** "ADE" is a category word already used by several products, "SL-ADE" reads as the
  Doom editor's name when typed, and it is awkward to say aloud. This is recorded once, with evidence, as
  the owner's decision to make — the plan implements SL-ADE. If the owner ever wants to revisit, the
  research report lists concrete alternatives and none of the mechanics above would change.

## Security Considerations

- Do not touch the keyring service name or the sealed-secret envelope format in this phase.
- The env alias must not widen what can be overridden: only the seven documented user-settable variables
  get an alias, and `SLTERM_AUTH_KEY` is **not** among them.
- Verify no secret, token or key name changes shape during the sweeps — a renamed variable that a shell
  snippet still exports under the old name would leave a credential in the environment under two names.
- After the repository rename, confirm no workflow secret or protected-branch rule silently detached.

## Next Steps

This is the last phase. No deferred orchestration remains: phase 10 delivered the approved engine before
this mechanical rename. Possible future product ideas (multi-repo/LSP/design mode) require separate user
scope and are not commitments in this plan.

