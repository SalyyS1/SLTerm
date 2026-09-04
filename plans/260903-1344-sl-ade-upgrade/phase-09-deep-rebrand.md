---
phase: 9
title: "Phase 9: Deep rebrand"
status: todo
priority: P3
effort: "1-2w"
dependencies: [2, 3, 4, 5, 6, 7, 8]
---

# Phase 9: Deep rebrand

## Overview

**Split dependencies.** Rungs 9.1-9.5 and 9.8 only need phases 2 and 3. Steps **9.6 (Go module path) and
9.7 (repo rename)** must be last in the whole plan and require **no other branch open**: rewriting 721
import blocks conflicts with every open branch, and `task generate` on a stale branch silently regenerates
wshrpc clients carrying the old module path. That is why the frontmatter lists 2-8.

Finish what phase 2 started. Phase 2 changed what users see and what the installer keys on; this phase
changes what the code says: environment variable names, the Go module path, the copyright header, the
terminal's self-identification, and finally the repository name. All of it is mechanical, none of it is
load-bearing for shipping, and one item (the keyring service) is deliberately left alone.

## Key Insights

- **82 % of the brand footprint is two mechanical sweeps.** Of 1,463 hits for
  `SLTerm|slterm|SLTERM|Salyvn` across `pkg` + `cmd` + `frontend`: 721 are the Go import path
  `github.com/SalyyS1/SLTerm/...`, 483 are the `// Copyright 2025, Salyvn.` header in 477 files, ~145 are
  `SLTERM_*` env var names, and only ~26 are real prose or UI strings.
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
- **The repo rename is the safest step in the whole ladder.** GitHub redirects everything except project
  site URLs and published Actions; git operations against the old location keep working; release asset
  URLs stay resolvable. Two rules: do not recreate a repository under the old name, and rewrite the 721
  in-repo import statements in the same commit as `go mod edit -module`.
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

- Each sweep is its own commit, so any of them can be reverted independently.
- No remote host is broken by a variable rename.
- Nothing in this phase blocks a release; it can ship in pieces.

## Architecture

Four rungs, in order of increasing cost. Phase 2 already did rungs 1-2.

```
rung 1  DONE in phase 2   productName, identifier, exe, window title, About, icons, installer names
rung 2  DONE in phase 2   data-dir alias (~/.sl-ade → ~/.slterm), release naming
rung 3  THIS PHASE        env prefix (+aliases), TERM_PROGRAM, JWT issuer, __SLTERM_HOST__, copyright
                          headers, docs                                  [needs phases 2-3]
rung 4  LAST IN THE PLAN  Go module path + 721 imports, repository rename [needs phases 2-8, no open branch]
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
- Modify: `go.mod` + 721 import sites; `Taskfile.yml`; `package.json`; `README.md`;
  `ACKNOWLEDGEMENTS.md`; `NOTICE`; 477 copyright headers
- Modify: `frontend/wave.ts`, `frontend/app/element/quicktips.tsx`,
  `frontend/app/view/term/{term-model.ts,termutil.ts}`, `pkg/wshrpc/wshserver/wshserver.go`,
  `pkg/web/web.go` (the ~26 real prose strings)
- Modify: `src-tauri/src/lib.rs` + `frontend/util/tauri-host.ts` + its test (the
  `window.__SLTERM_HOST__` contract — both sides ship together, rename atomically)

## Implementation Steps

1. **9.1 Env alias helper**, then rename the nineteen internal variables atomically in one commit. Leave
   the remote-facing ones alone, or gate them behind a `wsh` version handshake.
2. **9.2 `TERM_PROGRAM`.** Change it and put it in the release notes; expect it to be the thing nobody
   remembers when a prompt misbehaves.
3. **9.3 JWT issuer.** Confirm no token is persisted across restarts, then rename. If any is, skip it.
4. **9.4 Host snapshot key.** Rename `window.__SLTERM_HOST__` in Rust, the frontend and its test in one
   commit.
5. **9.5 Copyright + prose sweep.** 477 headers and ~26 real strings. Mechanical; one commit each.
6. **9.6 Module path — last, with no other branch open.** `go mod edit -module github.com/SalyyS1/sl-ade`
   plus a scripted rewrite of the 721 imports, in a single commit with no other edits. Gate:
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

- [ ] 9.1 Env alias helper + internal variable rename
- [ ] 9.2 `TERM_PROGRAM` changed and noted in release notes
- [ ] 9.3 JWT issuer renamed, or skipped with a recorded reason
- [ ] 9.4 `__SLTERM_HOST__` renamed atomically across Rust, TS and its test
- [ ] 9.5 Copyright headers and prose strings
- [ ] 9.6 Go module path + 721 imports, build and tests green, `task generate` diff-clean (no open branch)
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
- **Module rename churn hides a real change, and collides with every open branch.** A 721-file diff makes
  review meaningless, and any branch from phases 4-8 conflicts in every touched import block. *Mitigation:*
  9.6 runs last with no other branch open, as one scripted commit with no other edits, and `task generate`
  must produce no diff afterwards — otherwise the regenerated clients still carry the old path.
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

This is the last phase of the plan. Remaining ideas recorded for a follow-on plan: supervisor/worker
orchestration with a visible task DAG, multi-repo workspaces, an LSP bridge for code intelligence, an
agent sandbox/trust model, and element-to-prompt design mode over the existing webview.

