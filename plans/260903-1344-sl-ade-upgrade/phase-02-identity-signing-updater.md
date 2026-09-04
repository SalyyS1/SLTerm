---
phase: 2
title: "Phase 2: Identity, signing, updater"
status: todo
priority: P1
effort: "2-3w"
dependencies: [1]
---

# Phase 2: Identity, signing, updater

## Overview

Rename the product to **SL-ADE** and give it an update channel — in that order, in two separate
releases. The order is not a preference: the Tauri NSIS installer keys the Windows upgrade path on
`productName`, so renaming *after* the updater ships produces a silent, self-perpetuating failure.
Signing runs alongside and gates nothing.

## Key Insights

All from the Tauri v2 bundler source (`crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi`)
unless noted.

- **`productName` is the Windows upgrade key, not `identifier`.**
  `UNINSTKEY = Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}` (`:66`),
  `MANUPRODUCTKEY = Software\${MANUFACTURER}\${PRODUCTNAME}` holds the saved INSTDIR (`:67-68,682`),
  default INSTDIR is `$LOCALAPPDATA\${PRODUCTNAME}` / `$PROGRAMFILES64\${PRODUCTNAME}` (`:504-514`),
  and the WiX `upgrade_code` is derived from `"{product_name}.exe.app.x64"` (`msi/mod.rs:619-629`).
  Change `productName` → new uninstall key, new install dir, **two** Add/Remove entries.
- **Changing `identifier` alone is safe.** It drives the URL-protocol registration (`:673`), the
  AppUserModelID on the shortcut (`utils.nsh:74-82`) and Tauri's own `app_data_dir()`. SLTerm does not
  use `app_data_dir()` — `lib.rs:100-113` hardcodes `~/.slterm/{data,config}` — so **no user data
  moves.**
- **Renaming after the updater ships is a loop, not an inconvenience.** The updater runs the new
  setup with `/UPDATE` → `$UpdateMode = 1` (`:488-490`). In that mode `CreateOrUpdateStartMenuShortcut`
  and the desktop equivalent **return without creating a shortcut** (`:934-943,967-975`). So: new
  install lands in `…\SL-ADE`, the relaunch works once, and every later launch from the user's
  existing `SLTerm.lnk` runs the **old** build, which finds an update, installs it, relaunches — for
  ever.
- **`bundle.windows.wix.upgradeCode` must be pinned before the first MSI ships.** It is the only
  escape hatch that lets an MSI survive a future `productName` change; NSIS has no equivalent short of
  an `NSIS_HOOK_PREINSTALL` that uninstalls the old key.
- **The minisign keypair is the true channel identity.** Signature verification cannot be disabled;
  losing the private key means never updating installed clients again. Generate it once, first, and
  store it in a password manager *and* repo secrets.
- **`latest.json` is validated as a whole document before `version` is read.** One malformed platform
  entry breaks updates on every platform.
- **Linux self-update is AppImage-only.** SLTerm ships `deb` + `rpm` and no AppImage → today there is
  no Linux update path at all. macOS updates need a `.app.tar.gz`, not the `dmg` currently bundled.
- **Azure Artifact Signing (renamed from Trusted Signing) is probably not available here.** Public
  Trust certs are limited to organisations in US/CA/EU/UK/AU/NZ/JP/KR/SG/CH/NO/IL, and individual
  developers must be in the US or Canada. Vietnam is not listed. **SignPath Foundation** is free, has
  no geographic restriction, and is exactly how Orca signs its Windows builds — at the cost of the
  displayed publisher becoming "SignPath Foundation" rather than "Salyvn".
- **`RunEvent::Exit` on an updater-driven exit is UNVERIFIED.** If it does not fire, `wavesrv`
  survives, holds the data-dir lock, and the post-update launch fails. Orca shipped exactly this bug
  ("app updates leave previous daemon generations running forever").
- **The endpoint URL must be permanent, and it must be chosen here.** `plugins.updater.endpoints` is
  compiled into every shipped binary, so a URL that has to change later can only be changed by an update
  delivered through the URL that is being abandoned — the same self-perpetuating trap as the rename. A
  tag-pinned URL is therefore wrong: it can announce exactly one release. Use
  `/releases/latest/download/latest.json` and make the Tauri line the only non-prerelease (mark Electron's
  `v*` releases prerelease in this phase), so the URL never moves. `release-tauri.yml:143` currently says
  `prerelease: true` while `tauri-v0.20.0` is published as a full release — fix that inconsistency here,
  not in phase 3.
- **The endpoint embeds the repository name, so the repo rename is part of frozen identity.** Phase 9's
  rename survives only on GitHub's redirect, which breaks the moment anything is created under the old
  name. Either host `latest.json` off-repo, or treat "repo name" as frozen along`productName` and gate
  phase 9's rename on an endpoint migration.
- **There is no in-app channel to announce the rename**, because the updater does not exist yet
  (`tauri-host.ts:156,212` are stubs, `Cargo.toml` has no `tauri-plugin-*`). Release notes alone will not
  reach existing installs, and both products resolve the same `~/.slterm` profile — so the second one
  launched dies on a real cross-process lock (`pkg/wavebase/wavebase-win.go:16-28`, surfaced at
  `pkg/waveserver/waveserver.go:468`) with a message about a lock, not about a duplicate install. Use the
  `NSIS_HOOK_PREINSTALL` escape hatch this plan already names: detect
  `…\CurrentVersion\Uninstall\SLTerm` and run its uninstaller.
- **Name collision, recorded once:** `sirjuddington/SLADE` is an 864★ Doom editor with its own domain,
  and `slade-cli` on npm is live in dev tooling. The `sl-ade` slug itself is free on GitHub, npm,
  PyPI, crates.io and Homebrew. "SL-ADE" is the owner's decision and this plan implements it; the
  collision and the "ADE is a category word" critique are noted in the research report, not re-argued.

## Requirements

**Functional**

- One release (`tauri-v0.21.0`) changes every identity string and ships **no** updater. Release notes say
  plainly: uninstall SLTerm first, this is a manual reinstall.
- The next release (`tauri-v0.22.0`) adds the updater and can update itself to `tauri-v0.22.1`, verified
  round-trip on Windows.
- Linux and macOS have a real update path (AppImage target, `.app.tar.gz`), or their absence is stated
  in the release notes rather than silently broken.
- The sidecar is dead before the installer runs; a post-update launch acquires the data-dir lock.
- Sealed secrets still open after the rename.
- The existing `~/.slterm` profile is still found after the rename.

**Non-functional**

- Identity is frozen for the life of the minisign key after `tauri-v0.22.0` — and "identity" includes the
  **repository name**, because the updater endpoint embeds it. Phase 9's repo rename is therefore gated on
  either an off-repo endpoint or an explicit post-rename update test.
- Signing is best-effort: an unsigned build ships with a documented SmartScreen note rather than
  blocking the release.

## Architecture

Two releases, deliberately:

```
tauri-v0.21.0  IDENTITY ONLY, no updater
  productName        SLTerm            → SL-ADE
  identifier         dev.salyvn.slterm → dev.salyvn.sl-ade
  mainBinaryName     (absent)          → sl-ade            # renames the exe without touching Cargo
  window title, About, icons, README, publisher strings
  bundle.windows.wix.upgradeCode = <pinned UUID>           # before the first MSI
  bundle.targets += msi, appimage                          # AppImage is the Linux update payload
  NSIS_HOOK_PREINSTALL: uninstall a pre-rename SLTerm install
  release-tauri.yml: prerelease -> false; Electron v* releases marked prerelease
  data-dir resolution: first existing of ~/.sl-ade, ~/.slterm, else ~/.sl-ade
  keyring service: UNCHANGED ("SLTerm")                    # see Risk
  Cargo package name: UNCHANGED (slterm/slterm_lib)        # internal only

tauri-v0.22.0  UPDATER
  tauri-plugin-updater + tauri-plugin-process
  bundle.createUpdaterArtifacts = true
  plugins.updater.pubkey / endpoints / windows.installMode = "passive"
  CI: generate latest.json from the signed artifacts, attach to the release
  frontend: UpdatePill + banner gating + WhatsNewModal over changelog.json
```

`identifier` and `productName` move in the same release because splitting them buys nothing: the
identifier change is free, and doing it later would still cost a stale AppUserModelID and, on macOS, a
full reset of TCC grants.

**Tags stay on the `tauri-v*` prefix through this phase**, but **release-channel ownership moves here**.
`v*` still triggers Electron's `release.yml`, so pushing `v0.21.0` here would build the wrong runtime — the
tag *trigger* change waits for phase 3. What does not wait: `prerelease: false` on the Tauri line, marking
Electron's releases prerelease, and freezing the endpoint URL. Phase 3 then only deletes the Electron
workflow and renames the file, with the endpoint string untouched. Split any other way and either phase 2
cannot demonstrate an update, or every install verified in phase 2 stops updating the moment phase 3
lands — in the one phase after which no Electron rollback exists.

## Related Code Files

- Modify: `src-tauri/tauri.conf.json` (productName, identifier, mainBinaryName, targets, bundle.windows,
  plugins.updater, createUpdaterArtifacts), `src-tauri/Cargo.toml` (version, updater + process plugins)
- Modify: `src-tauri/src/lib.rs` (data-dir resolution, window title, sidecar shutdown on update exit)
- Create: `frontend/app/modals/whatsnew.tsx`, `frontend/app/element/update-pill.tsx`,
  `frontend/app/store/updater.ts`, `changelog.json`
- Modify: `frontend/util/tauri-host.ts` (the four updater members stop being stubs)
- Modify: `.github/workflows/release-tauri.yml` (signing env, updater artifacts, `latest.json`,
  macOS x64 runner, AppImage + MSI bundles, launch smoke test)
- Modify: `README.md`, `src-tauri/icons/*`, `package.json` (name/version)
- Reference (read-only): `/home/stackops/saly/claude-terminal/src/store/updaterStore.ts`,
  `src/components/UpdatePill.tsx`, `AutoUpdater.tsx`, `WhatsNewModal.tsx`,
  `scripts/sign-windows.ps1`, `docs/AUTO_UPDATE.md`

## Implementation Steps

1. **2.1 Generate the minisign keypair first** (`npx tauri signer generate`). Store the private key in
   a password manager and as `TAURI_SIGNING_PRIVATE_KEY` in repo secrets. Nothing else in this phase
   starts until this exists — it outlives every name.
2. **2.2 Verify the data-dir premise before renaming.** Electron resolves XDG paths unless
   `~/.slterm/wave.lock` exists (`emain/emain-platform.ts:72-84`); Tauri unconditionally uses
   `~/.slterm/{data,config}`. Confirm which profile the current install actually uses — the two builds
   may have been running against different, unrelated data.
3. **2.3 Data-dir resolution.** Replace the hardcoded join with "first existing of `~/.sl-ade`,
   `~/.slterm`, else `~/.sl-ade`". Alias, never copy: the directory holds a live SQLite DB, `secrets.enc`,
   and the `wsh` binary that remote hosts reference by absolute path. A partial copy is a corrupted
   profile, and a symlink needs admin/developer mode on Windows.
4. **2.4 Identity rename.** productName, identifier, `mainBinaryName`, window title, About, publisher,
   copyright, icons, README. Pin `wix.upgradeCode`. Add `msi` and `appimage` to `bundle.targets`. Add an
   `NSIS_HOOK_PREINSTALL` that detects `…\CurrentVersion\Uninstall\SLTerm` and runs its uninstaller, so
   the rename does not leave two products sharing one data dir. Leave the Cargo package name, `wsh`, the
   `wave.sock` basenames and the keyring service alone.
5. **2.5 Ship `tauri-v0.21.0` by hand, and make the release channel unambiguous.** Set `prerelease: false`
   on the Tauri workflow and mark Electron's `v*` releases prerelease, so `/releases/latest/` resolves to
   the Tauri line permanently. Release notes lead with the uninstall-first instruction and name the two
   Add/Remove entries a user would otherwise see. Install it on Windows from the NSIS artifact and confirm:
   the old install is gone, the app starts, existing workspace/tabs are present, secrets decrypt, `wsh`
   works. Also confirm the first-run path reports "SLTerm is still installed" rather than a raw lock error
   if the hook was skipped.
6. **2.6 Sidecar shutdown on update exit.** Call phase 1's `shutdown_backend()` directly before
   `update.install()` and set the update-in-progress flag so confirm-on-quit does not block an unattended
   install; keep `RunEvent::Exit` as a backstop only. Then determine empirically whether `RunEvent::Exit`
   fires on an updater-driven exit, and record the answer. Test **unattended** — an update with no user at
   the keyboard — not just an update the tester clicks through.
7. **2.7 Updater wiring.** Add the plugins, `createUpdaterArtifacts`, `plugins.updater` with
   `installMode: "passive"`, and the endpoint — `/releases/latest/download/latest.json`, made unambiguous by
   2.5. Write down that this string is frozen: it is compiled into every shipped binary, so changing it
   later requires shipping an update through the URL being abandoned. Keep `webviewInstallMode` at its
   `downloadBootstrapper` default
   (`offlineInstaller` adds ~127 MB, `fixedRuntime` ~180 MB **and** makes SL-ADE responsible for
   WebView2 CVE patching) and `nsis.installMode` at `currentUser` — note the interlock: the updater's
   `quiet` mode cannot self-elevate, so `perMachine`/`both` plus `quiet` fails silently. `passive` is
   the only mode safe across all three install modes. Set `minimumWebview2Version` to a runtime you
   have actually tested; it is the cheapest defense against ancient WebView2 builds that break the
   phase-1 COM calls.
8. **2.8 CI.** Emit `latest.json` from the signed artifacts with `updaterJsonPreferNsis`, add a macOS
   x64 runner, collect the `.app`/`.tar.gz` (today's glob at `release-tauri.yml:111-113` drops it), and add
   a smoke step that launches the built binary headlessly and asserts the `WAVESRV-ESTART` handshake. Add
   one assertion that the endpoint string in the built config is byte-identical to the previous release's,
   so an accidental change fails CI rather than the field.
9. **2.9 Updater UX.** Port `UpdatePill` (renders only for available/ready/error), the banner gating
   (dismiss-until-next-launch, snooze 4h, notified-version dedupe), and `WhatsNewModal` over a bundled
   `changelog.json`. Read `autoupdate:enabled` / `autoupdate:channel` / `autoupdate:intervalms` from the
   existing Go settings (`pkg/telemetry` already exposes `IsAutoUpdateEnabled()` and
   `AutoUpdateChannel()`) rather than re-deriving them.
10. **2.10 Prove the round trip twice.** Publish `tauri-v0.22.0`, then `tauri-v0.22.1`, and update Windows
    in place from the app. Then publish `tauri-v0.22.2` and confirm a client installed from **0.22.0** —
    not 0.22.1 — still sees it. One hop proves the plumbing; two hops prove the endpoint is not
    single-use. Repeat the first hop on Linux via AppImage. Record both results.
11. **2.11 Signing, in parallel.** Apply to SignPath Foundation: needs the OSI licence (Apache-2.0 ✓,
    no dual licensing), MFA on SignPath and GitHub, a "Code signing policy" section on the project
    homepage with their attribution string, and a manual approval step per release. If Azure Artifact
    Signing turns out to be available, prefer it for UX (instant reputation, no per-release approval)
    and wire it through `bundle.windows.signCommand` with `artifact-signing-cli`, not the legacy dlib.
    Never self-sign: CI reports success while users see the identical warning.

## Todo

- [ ] 2.1 Minisign keypair generated and stored in two places
- [ ] 2.2 Confirm which data profile the current installs actually use
- [ ] 2.3 Data-dir resolution aliases `~/.slterm`
- [ ] 2.4 Identity rename + pinned `wix.upgradeCode` + msi/appimage targets
- [ ] 2.5 `tauri-v0.21.0` published and hand-installed on Windows, old install removed by the hook, data intact
- [ ] 2.5b `prerelease: false` on the Tauri line; Electron `v*` releases marked prerelease
- [ ] 2.6 `shutdown_backend()` called before install; sidecar proven dead **unattended**
- [ ] 2.7 Updater plugin, config and endpoint
- [ ] 2.8 CI: `latest.json`, macOS x64, `.app` collected, `prerelease: false`, launch smoke test
- [ ] 2.9 UpdatePill + banner gating + WhatsNewModal, driven by the existing `autoupdate:*` settings
- [ ] 2.10 Two hops verified: 0.22.0 → 0.22.1, and a 0.22.0 client → 0.22.2 (endpoint not single-use)
- [ ] 2.11 Signing applied for; unsigned fallback documented in the README

## Success Criteria

- [ ] Windows: install `tauri-v0.21.0` by hand, then let the app update itself to `tauri-v0.22.1` — one Add/Remove
      entry, one install dir, shortcut still launches the current build
- [ ] A machine with SLTerm already installed ends up with **one** product after installing `tauri-v0.21.0`
- [ ] A client installed from `tauri-v0.22.0` receives `tauri-v0.22.2` without any endpoint change
- [ ] The pre-rename workspace, tabs and secrets are all present after the rename
- [ ] An **unattended** `tauri-v0.22.x` update performed while a shell block is running leaves no orphaned
      `wavesrv`, and the new process acquires the data-dir lock on its first attempt
- [ ] `latest.json` validates and contains every platform that has an artifact; platforms without an
      update path are absent, not malformed
- [ ] Linux AppImage self-updates, or the release notes say Linux updates manually
- [ ] `release-tauri.yml`'s `prerelease` flag matches what the release actually is
- [ ] The README states the signing status honestly, including why SmartScreen may warn

## Risk Assessment

- **Rename-after-updater is the catastrophic ordering error.** *Signal it happened:* two Add/Remove
  entries, or an update that "succeeds" every launch. *Response:* it is not recoverable by another
  update — users must uninstall both entries by hand. Hence the two-release split; do not merge them
  to save a release.
- **Keyring service rename would silently destroy access to sealed secrets.** The chain:
  `readMasterKeyFile` misses → `keyring.Get("SL-ADE", …)` misses → a **fresh random key is generated
  and stored** (`pkg/secretstore/master_key.go:76-80`) → `secrets.enc` no longer opens, and this path
  writes no backup. *Response:* this plan does not rename it. If it is ever renamed, add the
  read-through fallback to the legacy service first and keep the legacy entry for at least one minor
  version.
- **Signing may simply not be available.** *Signal:* SignPath declines (discretionary, no appeal) and
  Azure requires a jurisdiction the owner is not in. *Response:* ship unsigned with a README note.
  This is the pre-decided answer; do not let it block the phase.
- **SignPath changes the displayed publisher** to "SignPath Foundation". Accept it — strictly better
  than "Unknown publisher" — or pay for Azure if eligible.
- **A tag-pinned endpoint is a one-shot channel.** It looks correct in the first round-trip test and then
  silently stops, because a later release publishes its manifest at a URL no installed client fetches.
  *Signal:* clients report up-to-date forever after one successful update. *Response:* the endpoint is
  `/releases/latest/download/latest.json`, made unambiguous in 2.5 by marking Electron's releases
  prerelease, and CI asserts the string never changes. The two-hop test in 2.10 is what would have caught
  this.
- **macOS TCC grants reset** when the bundle identifier changes: screen recording, accessibility and
  notification permissions must be re-approved. Cosmetic, but mention it in the release notes.

## Security Considerations

- The minisign private key is the single point of failure for every future update. Treat leaking it as
  equivalent to shipping arbitrary code to every install: it permits signing a malicious update that
  clients will accept.
- `dangerousInsecureTransportProtocol` must stay off; the endpoint is HTTPS.
- Do not commit `TAURI_SIGNING_PRIVATE_KEY` or the Azure/SignPath credentials. `.env` files do not
  work for the signing env vars anyway — Tauri documents this explicitly.
- `signCommand` is the only path that can sign a Windows artifact from a non-Windows host, which
  matters because the NSIS bundle is currently produced with a Zig cross-toolchain.

## Next Steps

Phase 3 deletes Electron and can only start once this phase has proven a Windows install and update
cycle — Electron is the sole rollback until then. Phase 9 finishes the rebrand (env vars, module path,
repo name); nothing in it is load-bearing for shipping.

