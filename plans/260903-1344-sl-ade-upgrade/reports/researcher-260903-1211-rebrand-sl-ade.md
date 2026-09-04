# SLTerm -> SL-ADE: Gradual, Safe Rebrand (Tauri 2 + Go)

Report date: 2026-09-03. Repo: /home/stackops/saly/SLTerm (Wave Terminal fork). Status: research only, no source modified.

## 0. Scope & method
Read the 11 named files + grep census. Web-verified NSIS/Tauri/GitHub behavior against primary docs and source. Every code claim is `file:line` from /home/stackops/saly/SLTerm. Anything not verified is tagged UNVERIFIED.

Headline: only **14 keys** are load-bearing. The 1400+ grep hits are ~85% Go import path + copyright header, both mechanical. The single genuinely dangerous item is the keyring service name (sealed-secret loss), and the single unavoidable user-visible break is the Windows installer identity.

## 1. Name inventory (COSMETIC vs LOAD-BEARING)

### 1.1 Grep census `SLTerm|slterm|SLTERM|Salyvn|salyvn`
Excluded: node_modules, dist, src-tauri/target, .git.

| Dir | files | hits |
|---|---|---|
| pkg | 203 | 941 |
| frontend | 235 | 264 |
| cmd | 58 | 258 |
| emain | 18 | 46 (deleted with Electron) |
| plans | 11 | 44 |
| src-tauri | 9 | 30 |
| build | 1 | 16 |
| benchmarks | 5 | 10 |
| scripts | 4 | 4 |
| db, public, schema, schema-dist | 1 each | 1 each |
| root files | 12 | Taskfile.yml 26, README 26, eb_output 7, package.json 7, electron-builder 5, others 1-2 |

Kind breakdown across pkg+cmd+frontend (1463 hits):

| Kind | Hits | Class |
|---|---|---|
| Go import path `github.com/SalyyS1/SLTerm/...` | 721 | mechanical (single `go mod edit` + sed) |
| `// Copyright 2025, Salyvn.` header (477 files) | 483 | cosmetic |
| `SLTERM_*` env var names | ~145 | see 1.2 / 2.2 |
| lowercase `slterm` (paths, TERM_PROGRAM, jwt issuer) | 104 | mixed |
| real prose/UI strings | ~26 | cosmetic |

So: 1204 of 1463 hits (82%) are two mechanical sweeps.

### 1.2 LOAD-BEARING (exact current value + file:line)

| # | Key | Current value | Location | Breaks if changed |
|---|---|---|---|---|
| L1 | Tauri identifier | `dev.salyvn.slterm` | src-tauri/tauri.conf.json:5 | Win NSIS upgrade path + uninstall regkey + AppUserModelID; macOS bundle id, TCC/keychain ACL, LaunchServices |
| L2 | Tauri productName | `SLTerm` | src-tauri/tauri.conf.json:3 | exe name, NSIS default install dir, Start-menu shortcut, .app name, deb/rpm pkg name, artifact filenames |
| L3 | Cargo package name | `slterm` (lib `slterm_lib`) | src-tauri/Cargo.toml:2,9 | binary name fallback, `main.rs:8` call site |
| L4 | Data dir (Tauri) | `~/.slterm/data`, `~/.slterm/config` — hardcoded | src-tauri/src/lib.rs:103-105 | every workspace/tab/block/db/secret/wsh-bin of every existing install |
| L5 | Data dir (Electron) | `envPaths("slterm")` XDG, or legacy `~/.slterm` when `~/.slterm/wave.lock` exists | emain/emain-platform.ts:27-31,72-84,112-145 | same, for v* installs |
| L6 | `SLTERM_CONFIG_HOME` / `SLTERM_DATA_HOME` | required, no default; unset after read | pkg/wavebase/wavebase.go:29-30,91-100 | backend refuses to start (`"SLTERM_CONFIG_HOME not set"`) |
| L7 | Other `SLTERM_*` (26 names) | `SLTERM_APP_PATH`, `_RESOURCES_PATH`, `_ELECTRONEXECPATH`, `_DEV`, `_DEV_VITE`, `_WSHFORCEUPDATE`, `_NOCONFIRMQUIT`, `_JWT`, `_SWAPTOKEN`, `_AUTH_KEY`, `_TABID`, `_BLOCKID`, `_WORKSPACEID`, `_CLIENTID`, `_JOBID`, `_CONN`, `_PUBLICKEY`, `_VERSION`, `_ENVFILE`, `_ZDOTDIR`, `_WSHBINDIR`, `_SI_*`, `_PTY_OK_`, `_HOME` | wavebase.go:29-40; shellutil.go:227; lib.rs:127-132 | shell integration + wsh handshake; a **stale remote `~/.slterm/bin/wsh`** reads old names |
| L8 | Remote-host layout | `.slterm`, `~/.slterm/bin/wsh`, `~/.slterm/wave-remote.sock`, `~/.slterm/client/<id>/slterm.sock`, `~/.slterm/jobs`, `/tmp/slterm-<uid>/<jobid>.sock` | wavebase.go:64,66,67,189,441,454 | every SSH remote already provisioned; server-side files you cannot migrate from the client's installer |
| L9 | Local socket basenames | `wave.sock`, `wave-remote.sock` | wavebase.go:60-61 | already Wave-branded, **not** SLTerm — leave alone |
| L10 | Keyring service / user | service `SLTerm`, user `secrets-master-key` | pkg/secretstore/master_key.go:24-25 | **sealed secret store becomes unreadable** — see 2.4 |
| L11 | wsh CLI name | `wsh` (`Use: "wsh"`), bin dir `<dataHome>/bin` | cmd/wsh/cmd/wshcmd-root.go:22; shellutil.go:83,227,429 | user muscle memory, scripts, remote installs. **Not** brand-named — nothing forces a change |
| L12 | `TERM_PROGRAM` | `slterm` | pkg/util/shellutil/shellutil.go:224 | third-party prompt/shell detection (starship, ohmyposh) |
| L13 | JWT issuer | `IssuerSLTerm = "slterm"` | pkg/wavejwt/wavejwt.go:18,130 | in-flight tokens fail validation across a version boundary |
| L14 | Go module path | `github.com/SalyyS1/SLTerm` | go.mod:1 | 721 import sites; anyone `go get`-ing the module |
| L15 | Electron appId / productName / shortcut / deb symlinks | appId `dev.salyvn.slterm`; productName `SLTerm`; `shortcutName: "SLTerm"`; `/usr/bin/slterm` -> `/opt/SLTerm/slterm` | package.json:7,13; electron-builder.config.cjs:13-15,62,66-67,78,85,108,113 | moot once Electron is deleted, but the **already-shipped v* installs** own these registry/alternatives entries |
| L16 | Workflow artifact names | `installers-${{matrix.label}}`, `tauri-installers-${{matrix.label}}` | .github/workflows/release.yml:136; release-tauri.yml:118 | CI-internal only, zero user impact |
| L17 | Updater endpoint identity | **does not exist yet** for Tauri. tauri.conf.json has no `plugins.updater`, no `bundle.createUpdaterArtifacts`, no signing keys. Electron uses `publish: {provider:"generic", url:"https://github.com/SalyyS1/SLTerm/releases"}` | tauri.conf.json (whole file); electron-builder.config.cjs:124-127 | see 3 — this absence is the rebrand's biggest asset |

### 1.3 COSMETIC (change any time, zero migration)
| Item | Current | Location |
|---|---|---|
| Window title | `document.title = "SLTerm"`, `"SLTerm - <tab>"` | frontend/wave.ts:41,121,186 |
| Rust window title | `.title("SLTerm")` | src-tauri/src/lib.rs:252 |
| Tauri descriptions | `"Open-Source Modern Terminal by Salyvn"`, copyright, publisher `Salyvn`, shortDescription | tauri.conf.json:34-37; Cargo.toml:4 |
| Copyright headers | `// Copyright 2025, Salyvn.` x477 files | repo-wide |
| UI strings | "Open SLTerm AI Panel", "Focus SLTerm AI", "Switch to SLTerm App" | frontend/app/element/quicktips.tsx:160,196; frontend/app/view/term/term-model.ts:188 |
| Paste temp filename | `slterm_paste_<ts>_<rand>.<ext>` | frontend/app/view/term/termutil.ts:81 |
| stderr log prefix | `[slterm]` | src-tauri/src/lib.rs:230; menu.rs:163 |
| Icons | src-tauri/icons/*, build/icon.ico, build/icon.icns | — |
| Docs | README.md (26), ACKNOWLEDGEMENTS, NOTICE, feature.md, Taskfile.yml (26) | — |
| Error prose | "AI features are not available in SLTerm" etc. | pkg/wshrpc/wshserver/wshserver.go:100,964,969; pkg/web/web.go:492 |
| ARM64 dialog + FAQ URL | "SLTerm has detected a performance issue" | emain/emain-platform.ts:49-58 (dies with Electron) |

Borderline, treat as cosmetic-with-a-note: `window.__SLTERM_HOST__` (src-tauri/src/lib.rs:200; frontend/util/tauri-host.ts:38) — private shell<->renderer contract, both sides ship in the same bundle, so rename atomically in one commit. Test at frontend/util/tests/tauri-host.test.ts:22 pins the name.

## 2. Migration mechanics

**Blast-radius reality check (verify before over-engineering).** `gh api repos/SalyyS1/SLTerm` returns stars=1, forks=0, subscribers=0, 10 releases. Real external install base is ~0. The migrations below matter for *your own machines and any remote hosts you have SSH'd into*, not for a user population. Budget effort accordingly — but the keyring item (2.4) is still a must-do because losing your own secrets is losing them.

**Correction to the brief:** `tauri-v0.20.0` is `prerelease: false, draft: false` on GitHub (published 2026-09-03T10:19:54Z, i.e. *after* `v0.20.0`), even though release-tauri.yml:143 sets `prerelease: true`. So `.../releases/latest` currently resolves to the **Tauri** release. Someone marked it as a full release after publish, or the workflow's `prerelease` input was overridden. Confirm which before wiring `releases/latest/download/latest.json`.

### 2.1 Data + config dir
Tauri path is *one hardcoded expression*: `dirs_home().join(".slterm")` then `data`/`config` (src-tauri/src/lib.rs:103-105). The Go side never computes it — it hard-requires `SLTERM_DATA_HOME`/`SLTERM_CONFIG_HOME` and errors out if absent (wavebase.go:91-100).

Recommended: **alias, do not move.** Keep `~/.slterm` as the on-disk directory forever and decouple it from the display name. Add `fn data_root()` that returns the first existing of `~/.sl-ade`, `~/.slterm`, else `~/.sl-ade`. Cost: ~8 lines of Rust, zero migration risk, no copy of a multi-GB block-file tree, no half-migrated state if the process dies mid-copy.

Rejected: copy-then-delete. The dir holds a live SQLite DB (db/), the wsh binary that remote hosts' rc files reference by absolute path, and secrets.enc. A partial copy is a corrupted profile. Rejected: symlink — breaks on Windows without developer mode/admin.

Electron's version (emain/emain-platform.ts:72-84) already implements exactly this "legacy dir wins if it has the marker file" pattern using `wave.lock`. Copy that shape, do not invent one. Note Tauri and Electron **already disagree**: Electron defaults to XDG (`~/.config/slterm`, `~/.local/share/slterm`) unless `~/.slterm/wave.lock` exists; Tauri unconditionally uses `~/.slterm/{data,config}`. If your Electron install never had a `wave.lock`, the Tauri build has been running against a *different, empty* profile. Verify on your own box before assuming the rebrand is what moves your data.

### 2.2 `SLTERM_*` env vars (26 names)
Two classes:

| Class | Vars | Migration |
|---|---|---|
| Process-scoped, set by the shell on every launch | `_AUTH_KEY`, `_DATA_HOME`, `_CONFIG_HOME`, `_APP_PATH`, `_JWT`, `_SWAPTOKEN`, `_TABID`, `_BLOCKID`, `_WORKSPACEID`, `_CLIENTID`, `_JOBID`, `_ZDOTDIR`, `_WSHBINDIR`, `_SI_*`, `_PTY_OK_` | **None needed.** Producer and consumer ship in the same binary set. Rename atomically in one commit. rc snippets are regenerated from templates into the data dir each launch (shellutil.go:384-435), so no stale file on the *local* box |
| User-settable overrides | `SLTERM_CONFIG_HOME`, `SLTERM_DATA_HOME`, `SLTERM_HOME`, `SLTERM_DEV`, `SLTERM_DEV_VITE`, `SLTERM_WSHFORCEUPDATE`, `SLTERM_NOCONFIRMQUIT` | **Alias for 2 minor versions.** One helper: read `SLADE_X`, fall back to `SLTERM_X`, log a deprecation line once |

Add the alias helper in one place in `pkg/wavebase` and route the seven override reads through it. Do **not** alias the 19 internal vars — that is DRY-violating noise for a contract nobody outside the process can see.

### 2.3 Unix socket / named pipe
`DomainSocketBaseName = "wave.sock"`, `RemoteDomainSocketBaseName = "wave-remote.sock"` (wavebase.go:60-61) are still **Wave**-branded, not SLTerm-branded. They live inside the data dir, so the dir alias covers them. **Leave them alone** — renaming buys nothing and forces a remote-host reprovision.

The one real trap: `/tmp/slterm-<uid>/<jobid>.sock` (wavebase.go:441) and `~/.slterm/client/<clientid>/slterm.sock` (wavebase.go:189) are constructed as literal strings for the *remote* side. A client that renames these while an old `wsh` sits on a remote host at `~/.slterm/bin/wsh` gets a silent connect failure. Gate any change here behind a wsh version handshake, or simply do not change them.

### 2.4 Keyring service + sealed secret store — THE hazard
Current: `keyringService = "SLTerm"`, `keyringUser = "secrets-master-key"` (pkg/secretstore/master_key.go:24-25). Backend: zalando/go-keyring v0.2.8, keyed on **(service, account) strings only** — verified per OS:

| OS | Storage call | Keyed on | Bundle id involved? |
|---|---|---|---|
| macOS | `/usr/bin/security add-generic-password -U -s <service> -a <user>` | keyring_darwin.go:86,45-47 | **No** |
| Windows | `wincred.NewGenericCredential(service + ":" + user)` | keyring_windows.go:44,97-99 | **No** |
| Linux | Secret Service item, attrs `{username, service}` | keyring_unix.go:29-31,43-45 | **No** |

So changing `identifier` from `dev.salyvn.slterm` is safe for secrets. Changing `keyringService` is **not**. Exact failure chain if you rename the service string with no fallback:

1. `readMasterKeyFile()` -> `ErrNotExist` (keyring-backed installs have no `secrets.key`) — master_key.go:53-56
2. `keyring.Get("SL-ADE", "secrets-master-key")` -> `ErrNotFound` — master_key.go:62
3. Falls through to **generating a fresh random key** and `keyring.Set` — master_key.go:76-80
4. `secrets.enc` (secretstore.go:24) was sealed under the old key -> `aead.Open` fails -> `"secrets file does not open with this key"` — pkg/secretstore/envelope.go:61-66
5. No backup is written on this path. `SecretsBackupName` is only produced by the Electron->keyring migration (secretstore.go:140-145)

Recovery is manual (the old entry is still in the OS keyring under service `SLTerm`), but the app will never look there.

**Fix — read-through fallback, ~12 lines, mandatory:**
```go
const keyringService = "SL-ADE"
const legacyKeyringService = "SLTerm"
// in loadOrCreateMasterKey, after the primary Get misses with ErrNotFound:
if stored, err := keyring.Get(legacyKeyringService, keyringUser); err == nil {
    if key, decErr := decodeMasterKey(stored); decErr == nil {
        _ = keyring.Set(keyringService, keyringUser, stored) // adopt under the new name
        return key, KeyBackendKeyring, nil
    }
}
```
Do **not** delete the legacy entry in the same release — if the user rolls back to `tauri-v0.20.0`, the old build needs it. Delete it one minor version later, or never (a stale 32-byte keyring row costs nothing).

Alternative worth considering: **do not rename the service at all.** Keep `keyringService = "SLTerm"` permanently, add a comment saying why. Zero code, zero risk. The only cost is a stale string in Keychain Access / Credential Manager. Under KISS this is the better call unless you specifically want the OS credential UI to read "SL-ADE".

`keyringUser = "secrets-master-key"` carries no brand — never touch it.

### 2.5 wsh CLI + shell-integration rc snippets
`wsh` is not brand-named (`Use: "wsh"`, cmd/wsh/cmd/wshcmd-root.go:22). **Do not rename it.** It is inherited Wave nomenclature, it is what remote hosts have on disk at `~/.slterm/bin/wsh` (wavebase.go:66), and every rc snippet references it bare (`wsh token "$SLTERM_SWAPTOKEN" zsh`, zsh_zshrc.sh:4).

rc snippets (pkg/util/shellutil/shellintegration/{bash_bashrc,zsh_zshrc,zsh_zlogin,pwsh_wavepwsh,fish_wavefish}.sh) are **templates rendered at launch** into the data dir with `WSHBINDIR` substituted (shellutil.go:384-385). They are not user-owned files. Renaming `SLTERM_WSHBINDIR` -> `SLADE_WSHBINDIR` inside them is a same-commit, zero-migration change **for local shells**.

The exception is remote hosts. A remote with an old `wsh` binary in `~/.slterm/bin/` will read the *old* var names from the *new* client's rc snippet. Two options: (a) bump the wsh version and let the existing force-update path (`SLTERM_WSHFORCEUPDATE`) push a new binary, or (b) do not rename these vars at all. Given the internal-only nature of the contract, (b) is cheaper.

`TERM_PROGRAM = "slterm"` (shellutil.go:224) is read by *third-party* prompts (starship, oh-my-posh, VS Code shell detection). Changing it breaks nothing of yours but silently changes how other tools identify the terminal. Change it, but treat it as a user-visible contract, note it in release notes, and expect it to be the thing nobody remembers when a prompt misbehaves.

`IssuerSLTerm = "slterm"` (pkg/wavejwt/wavejwt.go:18,130): tokens are minted and validated in the same process lifetime, so a rename is safe **if** minting and validating code ship together. Verify no token is persisted across restarts before changing. UNVERIFIED: whether any JWT is written to disk.

### 2.6 Windows installer: in-place upgrade or two apps? — VERIFIED, decisive
Read from the Tauri v2 NSIS template (`tauri-apps/tauri@dev`, `crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi`) and `nsis/mod.rs`:

| NSIS symbol | Derived from | Line |
|---|---|---|
| `UNINSTKEY` = `Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}` | **productName** | installer.nsi:66 |
| `MANUKEY` = `Software\${MANUFACTURER}`, `MANUPRODUCTKEY` = `${MANUKEY}\${PRODUCTNAME}` (stores saved INSTDIR) | publisher + **productName** | installer.nsi:67-68, 682 |
| default INSTDIR = `$PROGRAMFILES64\${PRODUCTNAME}` / `$LOCALAPPDATA\${PRODUCTNAME}` | **productName** | installer.nsi:504-514 |
| `MULTIUSER_INSTALLMODE_INSTDIR` | **productName** | installer.nsi:115 |
| Start-menu / desktop shortcut filename | **productName** | installer.nsi:828, 948, 975 |
| Installer filename `{productName}_{version}_{arch}-setup.exe` | **productName** | nsis/mod.rs:651-655 |
| `MANUFACTURER` | `publisher`, else `bundle_id.split('.').nth(1)` -> here `Salyvn` | nsis/mod.rs:268-271 |
| **AppUserModelID** on the .lnk (`SysAllocString(w "${BUNDLEID}")`) | **identifier** | utils.nsh:74-82; installer.nsi:949,952,976 |
| custom URL protocol registration `URL:${BUNDLEID} protocol` | identifier | installer.nsi:673 |
| uninstaller's data cleanup `RmDir /r "$APPDATA\${BUNDLEID}"`, `$LOCALAPPDATA\${BUNDLEID}` | identifier | installer.nsi:882-883 |

Conclusions:

1. **`productName` is the upgrade key on Windows, not `identifier`.** Change `productName` -> new UNINSTKEY -> **a second ARP entry, a second install dir, a second shortcut. The old install is not removed.** Two apps.
2. **Change `identifier` alone and the upgrade is in place.** UNINSTKEY, MANUPRODUCTKEY and INSTDIR are all productName-derived, so the installer finds and overwrites the existing install normally.
3. **Renaming just the exe is explicitly supported.** The installer stores `MainBinaryName` in UNINSTKEY, deletes the old binary, and retargets existing shortcuts (installer.nsi:691-698, 914-933). So `slterm.exe` -> `sl-ade.exe` with `productName` unchanged is clean.
4. **But an identifier change leaves a stale AppUserModelID.** `CreateOrUpdateStartMenuShortcut` retargets an existing shortcut and then `Return`s at installer.nsi:930-932, *before* the `SetLnkAppUserModelId` calls at 949/952. Only a freshly created shortcut gets the new AUMID. Consequence: taskbar grouping, jump lists and toast notifications keep using `dev.salyvn.slterm` until the user deletes the shortcut or reinstalls. Cosmetic-but-weird; fix by shipping a one-shot Rust step that rewrites its own shortcut AUMID, or accept it.
5. Uninstall never removes SLTerm's data, because the data lives in `~/.slterm` and the uninstaller only wipes `$APPDATA\${BUNDLEID}` / `$LOCALAPPDATA\${BUNDLEID}` (installer.nsi:882-883). Good for migration continuity, bad hygiene. Unrelated to the rebrand, worth a ticket.

macOS/Linux for completeness: macOS identity is the bundle id, so changing it means a new `.app` treated as a distinct app by LaunchServices/TCC (screen recording, accessibility, notification grants reset — user must re-approve). Linux deb/rpm package name comes from productName; changing it leaves the old package installed until `apt remove` — same two-apps outcome, but trivially fixed by hand.

### 2.7 Updater continuity
There is **no Tauri updater today**. src-tauri/tauri.conf.json has no `plugins.updater`, no `bundle.createUpdaterArtifacts`, no `pubkey`; `Cargo.toml` has no `tauri-plugin-updater` dependency (Cargo.toml:15-22). The Electron side has `publish: {provider: "generic", url: "https://github.com/SalyyS1/SLTerm/releases"}` (electron-builder.config.cjs:124-127) and ships `latest.yml`/`latest-mac.yml`/`latest-linux.yml` on every `v*` release. Note the generic provider fetches `${url}/${channelFile}` = `https://github.com/SalyyS1/SLTerm/releases/latest.yml`, which is not a URL GitHub serves — so the Electron auto-updater is very likely already dead. UNVERIFIED: never observed at runtime. If true, updater continuity for existing installs is a non-problem.

Tauri updater facts that constrain the plan (v2.tauri.app/plugin/updater):
- Endpoint placeholders are only `{{target}}`, `{{arch}}`, `{{current_version}}`. **No productName, no identifier.** So the endpoint URL survives a rebrand untouched — the only brand string in the loop is the manifest's asset `url`, which you author.
- Signature is mandatory: "Tauri's updater needs a signature to verify that the update is from a trusted source. This cannot be disabled." Losing the private key means "you will NOT be able to publish new updates to the users that have the app already installed." The `pubkey` is the true identity of the update channel — treat the keypair as the thing that must not change, not the name.
- Linux: **AppImage only.** SLTerm currently bundles `deb`, `rpm` (tauri.conf.json:20-26) and no AppImage -> there is no Linux self-update path at all. Windows NSIS is supported; macOS updates via a `.app.tar.gz`, not the dmg you currently ship (tauri.conf.json:23).
- Windows: "the application is automatically exited when the install step is executed". The updater runs the downloaded setup.exe with `/UPDATE` (installer.nsi:488-490).

The `/UPDATE` flag is what makes 3 non-negotiable: with `$UpdateMode = 1`, `CreateOrUpdateStartMenuShortcut` and `CreateOrUpdateDesktopShortcut` **return early and create no shortcut** (installer.nsi:934-943, 967-975).

## 3. Sequencing rule: identifier BEFORE updater. Not negotiable.

**Rule: land every identity change (`productName`, `identifier`, exe name, install dir) in a build that users install by hand, and only then ship the updater.**

Evidence chain, all from installer.nsi:
1. The Tauri updater downloads the new NSIS setup and runs it with `/UPDATE` -> `$UpdateMode = 1` (installer.nsi:488-490).
2. If `productName` changed, `MANUPRODUCTKEY` (`Software\Salyvn\SL-ADE`) does not exist, so no saved INSTDIR is found (installer.nsi:355, 682) and INSTDIR falls back to the default `$LOCALAPPDATA\SL-ADE` / `$PROGRAMFILES\SL-ADE` (installer.nsi:499-514). The old install at `...\SLTerm` is untouched.
3. Because `$UpdateMode = 1`, **no shortcut is created** (installer.nsi:936-942, 969-974). The user's existing Start-menu/pinned `SLTerm.lnk` still points at the *old* exe in the *old* directory.
4. `RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe"` (installer.nsi:420) relaunches from the new dir, so the update *looks* like it worked once.
5. Every subsequent launch from the shortcut runs the **old** build, which then reports an update is available, downloads it, "installs" it, and relaunches the new one — an invisible infinite update loop plus two ARP entries.

That is a silent, self-perpetuating failure and it is worse than any manual reinstall. Concretely for this repo:

```
tauri-v0.21.0  productName SL-ADE, identifier dev.salyvn.slade, exe sl-ade.exe
               NO updater. Release notes: "manual reinstall required, uninstall SLTerm first."
tauri-v0.22.0  add plugins.updater + pubkey + createUpdaterArtifacts + AppImage target.
               Identity is now frozen for the life of the pubkey.
```

Corollary: `identifier` alone could safely change *after* the updater ships (UNINSTKEY is productName-keyed, so the in-place upgrade still works) — but you would eat the stale-AUMID issue and, on macOS, a full loss of TCC grants. Do both at once, before the updater. There is no reason to split them.

Second corollary: generate the updater keypair **once, now**, and store it in repo secrets before anything else. It outlives every name.

## 4. Repo / release naming

**Repo rename is the safest step in the whole ladder.** Per GitHub docs: "all existing information, with the exception of project site URLs, is automatically redirected to the new name" and for git "operations targeting the previous location will continue to function as if made on the new location". Two documented exceptions:
- **GitHub Pages URLs are not redirected.** Not applicable — SLTerm has no Pages site. UNVERIFIED (not checked).
- **Actions are not redirected**: "GitHub will not redirect calls to an action hosted by a renamed repository." Not applicable — this repo consumes actions, does not publish one.
- The redirect breaks only if **you** re-create a repo under the old name: "do not reuse the original name of the renamed repository". So do not create a stub `SalyyS1/SLTerm` after renaming.
- The docs say nothing about REST/GraphQL redirects. UNVERIFIED.

**Release URLs are stable across a repo rename** by the same redirect. Existing asset URLs like `https://github.com/SalyyS1/SLTerm/releases/download/tauri-v0.20.0/SLTerm_0.20.0_x64-setup.exe` keep resolving. What is *not* stable is the go module path — `github.com/SalyyS1/SLTerm` in go.mod:1. Go's proxy resolves via the VCS URL, so redirects work for `go get`, but the 721 in-repo import statements should be rewritten in the same commit as `go mod edit -module`.

**Tag scheme once Electron is deleted.** Current: `v[0-9]+.[0-9]+.[0-9]+*` -> release.yml (Electron, full release); `tauri-v[0-9]+.[0-9]+.[0-9]+*` -> release-tauri.yml (prerelease per config). Recommendation:

| Step | Action |
|---|---|
| 1 | Delete `.github/workflows/release.yml` with `emain/` |
| 2 | Change release-tauri.yml's trigger from `tauri-v*` to `v[0-9]+.[0-9]+.[0-9]+*` and rename the file to `release.yml`. One tag scheme, one runtime |
| 3 | **Do not reuse a `v0.20.x` tag** — `v0.20.0` already exists as an Electron release. Start the unified scheme at `v0.21.0` |
| 4 | Keep the old `tauri-v*` tags and releases forever. They are the only download URLs any existing install knows |
| 5 | Flip `prerelease: true` -> `false` in the same commit, and fix the current inconsistency where `tauri-v0.20.0` is already a full release despite the workflow asking for a prerelease |

Do not migrate to a `sl-ade-v*` prefix. Tag prefixes should encode *channel*, not brand; `v*` is what every tool (`gh release`, cargo-dist, changelog generators, `git describe`) expects.

## 5. Name collision check + identifier set proposals

### 5.1 Collision evidence (probed 2026-09-03)

| Name | Where | Verdict |
|---|---|---|
| `SLADE` | `sirjuddington/SLADE`, 864 stars, "It's a Doom editor", own domain `slade.mancubus.net` (HTTP 200) | **Hard collision.** 20-year-old, actively used desktop app. Do not use the `slade` slug |
| `slade` | npm (v0.0.6, RBAC lib, last modified 2022-05-18) | taken, dormant |
| `slade-cli` | npm v3.2.2, "CLI for generating NestJS DDD boilerplate", modified **2026-08-29** | **taken and live, in dev tooling.** Avoid |
| `slade` | PyPI HTTP 200 | taken |
| `slade` | crates.io — "crate `slade` does not exist" | free |
| `slade` | GitHub user/org — HTTP 200 | taken |
| `slade` | Homebrew cask — 404 | free |
| `sl-ade` | GitHub org 404, npm 404, PyPI 404, crates 404, brew cask 404 | **fully free** |
| `sl-ade-dev` | GitHub org 404 | free |
| `sladev` | GitHub 200 (taken), crates free | mixed |
| `ade` | npm (v0.1.0, 2022) and crates.io (updated 2026-08-27) both taken | avoid bare `ade` |
| Trademark | UNVERIFIED. The USPTO IBD and TMSearch endpoints both returned 301/NoSuchKey; WebSearch was unavailable this session. `SLADE` as a Doom-editor mark is a common-law use risk regardless of registration |

**The bigger naming problem is not collision, it is that "ADE" is now a category word, not a name.** Probed GitHub 2026-09-03: `warpdotdev/warp` (64,773 stars) describes itself as "an agentic development environment"; `openchamber/openchamber` (9,531) "Agentic Development Environment based on OpenCode"; `generalaction/emdash` (5,584) "the Open-Source Agentic Development Environment"; `bearlyai/OpenADE` (409) puts ADE in the product name; `fynnfluegge/agtx` (1,472) same category phrase. Naming the product "SL-ADE" is like naming an editor "SL-IDE" — it describes the shelf, not the thing on it, and it will read as derivative of Warp's positioning. Also: `SL-ADE` is unpronounceable as spoken words, and reads as "slade" (the Doom editor) when a human types it. That is the worst of both worlds.

The owner's decision on the name is a decision, not a technical question, and this report does not overturn it. But if the name is still open: use "ADE" in the **tagline** and pick a pronounceable product name. Sets B and C below give that option without changing any of the migration mechanics.

### 5.2 Proposed identifier sets (ranked)

Rules the sets satisfy: identifier is alphanumeric + hyphen + period only (Tauri config schema, `identifier` description); productName is the Windows/macOS/Linux upgrade key so it changes exactly once; exe rename uses the `mainBinaryName` config key rather than the Cargo package name.

**Set A — "SL-ADE", the brief's name (RECOMMENDED, because it is the stated decision and it is technically clean)**

| Field | Value | Note |
|---|---|---|
| Display / `productName` | `SL-ADE` | tauri.conf.json:3. INSTDIR becomes `%LOCALAPPDATA%\SL-ADE`; hyphen is path-legal |
| Slug / repo | `sl-ade` | GitHub org+repo, npm, PyPI, crates, brew all free |
| Tauri `identifier` | `dev.salyvn.sl-ade` | hyphen permitted per config schema |
| `mainBinaryName` | `sl-ade` -> `sl-ade.exe` | new config key; keeps Cargo package name `slterm` stable so no Rust churn |
| Cargo package | leave `slterm` / `slterm_lib` | internal only, zero user surface. Rename later if it bothers you |
| Data dir | keep `~/.slterm` | aliased, see 2.1 |
| Env prefix | `SLADE_` | 7 override vars aliased, 19 internal renamed in place |
| Keyring service | keep `"SLTerm"` | or rename with the fallback from 2.4 |
| npm `name` | `sl-ade` | package.json:2 |

**Set B — "Salyade" (pronounceable, one word, no category word in the name)**

| Field | Value |
|---|---|
| Display / `productName` | `Salyade` |
| Slug / repo | `salyade` |
| identifier | `dev.salyvn.salyade` |
| exe / env prefix / data dir | `salyade` / `SALYADE_` / `~/.salyade` (alias `~/.slterm`) |

Rationale: keeps the "Saly" author brand that already owns the bundle-id namespace `dev.salyvn.*`, is one pronounceable token, has zero collisions in the dev-tool space, and leaves "the AI Development Environment" free to be the tagline where it does actual marketing work. UNVERIFIED: `salyade` availability on npm/crates (not probed).

**Set C — keep "SLTerm" as productName forever, rebrand only what users read (ZERO migration)**

| Field | Value |
|---|---|
| `productName` | `SLTerm` (unchanged) |
| identifier | `dev.salyvn.slterm` (unchanged) |
| Window title / About / README / docs / icons | `SL-ADE` |
| Everything in section 2 | untouched |

Rationale: this is what "gradual and safe" actually means in the strict sense. Cost: the Windows ARP entry and install path keep saying SLTerm forever, which is the one place a rename is genuinely hard to undo. Worth naming as an option so the trade-off is explicit; not recommended, because the owner's stated intent is a real rebrand and a 1-star repo is exactly when you should take the identity hit.

**Ranking: A, then B, then C.** A is the stated decision and carries no technical penalty over B beyond the naming critique above. C is the fallback if you want the rebrand without ever touching installer identity.

## 6. Phased rebrand ladder

Independent of the ADE feature work. Rungs 1 and 4 can land today; rung 2 must land in the release *before* the updater; rung 3 is optional forever.

### Rung 1 — cosmetic, zero migration, ship any time
No installer identity, no data path, no env var, no keyring. Land in one PR.

| File | Key / line | Change |
|---|---|---|
| frontend/wave.ts | :41, :121, :186 | `document.title` |
| src-tauri/src/lib.rs | :252 | `.title("SLTerm")` |
| src-tauri/tauri.conf.json | :34 copyright, :36 shortDescription | brand text only — **not** :3 productName, **not** :5 identifier |
| src-tauri/Cargo.toml | :4 description | text only — **not** :2 name |
| frontend/app/element/quicktips.tsx | :160, :196 | UI strings |
| frontend/app/view/term/term-model.ts | :188 | "Switch to SLTerm App" |
| pkg/wshrpc/wshserver/wshserver.go | :100, :964, :969 | error prose |
| pkg/web/web.go | :492 | comment |
| README.md (26), ACKNOWLEDGEMENTS.md, NOTICE, feature.md, Taskfile.yml (26) | — | docs + task descriptions |
| src-tauri/icons/*, build/icon.ico, build/icon.icns | — | new artwork; filenames stay (referenced at tauri.conf.json:27-33) |
| 477 files | `// Copyright 2025, Salyvn.` | leave, or one sed pass — either is fine |

Optional in rung 1: `window.__SLTERM_HOST__` -> `__SLADE_HOST__` (src-tauri/src/lib.rs:200 + frontend/util/tauri-host.ts:38 + frontend/util/tests/tauri-host.test.ts:22). Same-bundle contract, must be one atomic commit.

Gate: `task build:...` succeeds; app launches under Xvfb; `frontend/util/tests/tauri-host.test.ts` passes.

### Rung 2 — installer / identity. One release. MUST precede the updater.
| File | Key | From -> To |
|---|---|---|
| src-tauri/tauri.conf.json | `productName` (:3) | `SLTerm` -> `SL-ADE` |
| src-tauri/tauri.conf.json | `identifier` (:5) | `dev.salyvn.slterm` -> `dev.salyvn.sl-ade` |
| src-tauri/tauri.conf.json | add `mainBinaryName` | -> `sl-ade` |
| src-tauri/tauri.conf.json | add `bundle.targets` `appimage` | needed later for any Linux updater |
| package.json | `productName` (:7), `name` (:2), `build.appId` (:13) | keep in sync so nothing reads a stale value |
| .github/workflows/release-tauri.yml | :109-113 asset glob | already extension-based, verify `SL-ADE_*_x64-setup.exe` is collected |

Release-note text is part of this rung, not an afterthought: **"Uninstall SLTerm before installing SL-ADE. Your data in `~/.slterm` is preserved."** Because UNINSTKEY is productName-keyed (installer.nsi:66), skipping this leaves two ARP entries.

Known accepted side effects: stale AppUserModelID on pre-existing Windows shortcuts (installer.nsi:930-932); macOS TCC/notification grants reset (new bundle id); old `slterm` deb/rpm package remains until removed by hand.

Gate: on a clean Windows VM, install `tauri-v0.20.0`, then install the rung-2 build, then check `Software\Microsoft\Windows\CurrentVersion\Uninstall\*` for exactly the entries you expect. This is the one gate that cannot be skipped, and Linux-under-Xvfb cannot substitute for it.

### Rung 3 — data / env / CLI. Optional; do the alias, skip the move.
| Item | File | Action |
|---|---|---|
| Data dir | src-tauri/src/lib.rs:103-105 | `data_root()` = first existing of `~/.sl-ade`, `~/.slterm`, else `~/.sl-ade`. Do **not** copy |
| Override env vars (7) | pkg/wavebase/wavebase.go:29-40 | one `lookupEnvWithLegacy(newName, oldName)` helper; `SLADE_*` wins, `SLTERM_*` warns |
| Internal env vars (19) | wavebase.go:29-40, shellutil.go:227, lib.rs:127-132, rc snippets, frontend/util/isdev.ts:7-8 | rename in place, same commit, no aliases |
| Keyring | pkg/secretstore/master_key.go:24 | **either** leave as `"SLTerm"` **or** rename + legacy read-through from 2.4. Never rename without the fallback |
| `TERM_PROGRAM` | pkg/util/shellutil/shellutil.go:224 | `slterm` -> `sl-ade`; note in release notes (third-party prompts read it) |
| JWT issuer | pkg/wavejwt/wavejwt.go:18,130 | rename only after confirming no JWT is persisted |
| Remote layout | wavebase.go:64,66,67,189,441,454 | **do not change.** Renaming orphans every provisioned SSH host |
| `wsh` | cmd/wsh/cmd/wshcmd-root.go:22 | **do not rename.** Not brand-named |
| Go module | go.mod:1 | `go mod edit -module` + rewrite 721 imports, one mechanical commit, separate PR |

Gate: launch with `~/.slterm` present and `~/.sl-ade` absent, confirm the existing workspace/tabs load; then with only `~/.sl-ade`; then a secret round-trip (write, restart, read) on each OS you care about.

### Rung 4 — repo / release. Independent of rungs 1-3, safest of all.
| Item | Action |
|---|---|
| GitHub repo | rename `SalyyS1/SLTerm` -> `SalyyS1/sl-ade`. Do **not** later create a repo named `SLTerm` |
| Local clones | `git remote set-url origin` (docs recommend it even though redirects work) |
| Old releases/tags | keep `v0.14.0`..`v0.20.0` and `tauri-v0.20.0` forever |
| Tag scheme | delete release.yml with `emain/`; retrigger release-tauri.yml on `v*`; start at `v0.21.0` |
| Workflow artifact names | release-tauri.yml:118 `tauri-installers-*` -> `installers-*`; CI-internal, no user impact |
| electron-builder.config.cjs, emain/, electron.vite.config.ts | delete with the Electron shell; takes 46 emain hits + 5 config hits with them |

## 7. Trade-off matrix

| Approach | Migration risk | User-visible break | Effort | Reversible? | Verdict |
|---|---|---|---|---|---|
| Rung 1 only (Set C) | none | none | ~1h | fully | safe floor; not the stated goal |
| Rungs 1+2+4, keep data dir + env + keyring (Set A minus rung 3) | **near zero** | one manual reinstall on Windows/macOS | ~3h + a Windows VM test | rung 2 is one-way in practice | **recommended** |
| Full 1-4 with data-dir *alias* | low | same reinstall + `SLTERM_*` deprecation warnings | ~1d | yes | fine, do it later |
| Full 1-4 with data-dir *copy* | **high** (SQLite + secrets.enc mid-copy) | possible profile corruption | ~2d + recovery code | no | reject |
| Rename keyring service without fallback | **critical** (secrets locked out, no backup — envelope.go:61-66) | secrets unreadable, silent until first read | ~0 | manual keyring surgery | reject |
| Change identity *after* the updater ships | **critical** (silent update loop, §3) | user keeps running the old build forever | ~0 | requires a hand-reinstall anyway | reject |

## 8. Adoption risk

Low across the board, and mostly because the blast radius is one user.

- **Install base**: stars=1, forks=0, watchers=0 (`gh api repos/SalyyS1/SLTerm`, 2026-09-03). Rung 2's manual-reinstall cost is paid by the author.
- **Tauri NSIS template stability**: the productName-keyed UNINSTKEY has been the shape since Tauri 1.x and the template carries explicit backward-compat code for a WiX-era layout (installer.nsi:194-208) and for the old "productName as MAINBINARYNAME" convention (installer.nsi:914-916). Tauri clearly treats this as a compatibility surface. Low churn risk.
- **`createUpdaterArtifacts`**: docs say "This setting will be removed in v3". A v3 migration will touch the updater config, not the identity. Note it, do not plan around it.
- **go-keyring v0.2.8**: single-maintainer-org (zalando), stable API, `MockInit` already used in tests (pkg/secretstore/master_key_test.go:45,83). Abandonment risk is real but the surface used is ~4 functions; replacement is a day.
- **GitHub rename redirect**: documented behavior, but the docs explicitly do not cover the REST/GraphQL case and do not cover a third party claiming the old name. Both are unlikely; neither is guaranteed.
- **The name itself** is the highest-variance item, and it is a positioning risk rather than a technical one: "ADE" is now a crowded category label (§5.1) and `SL-ADE` collides phonetically with an 864-star, 20-year-old desktop app.

## 9. Limitations / not covered

- **No Windows or macOS execution.** Every Windows claim comes from reading the Tauri NSIS template and bundler source, not from running an installer. Section 2.6/3 conclusions are source-verified, not empirically verified. The brief states only the Linux build has ever launched.
- **Trademark search failed.** USPTO endpoints returned 301/NoSuchKey; WebSearch had no available accounts this session. §5.1 registry probes are not a trademark clearance.
- **Code signing not researched.** The brief lists it as missing; it interacts with the rebrand (a cert's CN is a name, `certificateSubjectName: "Salyvn"` at electron-builder.config.cjs:67), but it was out of scope here.
- **Not read**: `cmd/wsh` beyond the root command name; `frontend/util/endpoints.ts` (grep found zero brand strings, so nothing to report); the AppImage bundling path; whether SLTerm registers any custom URL protocol (installer.nsi:673 would key it on the identifier — grep found none in tauri.conf.json, so assumed none).
- **`SalyyS1` vs `Salyvn`** are two different strings in the repo (GitHub handle vs brand). Any sed sweep must handle both; this report treats the GitHub-handle occurrences as part of the module path / URLs only.
- Did not cost or sequence the rebrand against the unbuilt work (claudesession, vcs, pet rewrite, keybindings). Rungs 1-4 are orthogonal to all of it.

## 10. Unresolved questions

1. `tauri-v0.20.0` is `prerelease: false` on GitHub while release-tauri.yml:143 sets `prerelease: true`. Was it flipped by hand? It currently owns `/releases/latest`, which determines whether `releases/latest/download/latest.json` is a viable updater endpoint.
2. Is the Electron auto-updater actually functional? `provider: generic, url: .../releases` (electron-builder.config.cjs:124-127) implies fetching `https://github.com/SalyyS1/SLTerm/releases/latest.yml`, which GitHub does not serve. If it is already dead, updater continuity is a non-issue and rung 2 gets cheaper.
3. Does your existing Electron profile live in `~/.slterm` or in XDG paths? Electron uses XDG unless `~/.slterm/wave.lock` exists (emain/emain-platform.ts:72-84); Tauri unconditionally uses `~/.slterm` (lib.rs:103-105). If they differ, the Tauri build has been running against a separate profile and the "migration" you need is Electron->Tauri, not SLTerm->SL-ADE.
4. Keyring service: rename with the read-through fallback, or freeze at `"SLTerm"` forever? KISS says freeze.
5. Is the name still open? If yes, §5.1's category-word and SLADE-phonetic-collision findings are worth ten minutes before rung 2 makes the name expensive.
6. Windows AppImage/Linux updater: do you want self-update on Linux at all? If yes, `appimage` must be added to `bundle.targets` (tauri.conf.json:20-26) — deb/rpm cannot self-update.
7. Should `~/.slterm` ever become `~/.sl-ade`, or is the alias permanent? A permanent alias is one fewer moving part but leaves a name mismatch a future reader will trip over.

## Sources
Primary, all fetched 2026-09-03:
- Tauri NSIS installer template (authoritative for every Windows identity claim): https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
- Tauri NSIS bundler (MANUFACTURER derivation, installer filename): https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs
- Tauri NSIS macros (`SetLnkAppUserModelId` -> BUNDLEID): https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/windows/nsis/utils.nsh
- Tauri config schema (`identifier` charset, `productName` platform notes, `mainBinaryName`): https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/config.schema.json
- Tauri v2 updater docs (endpoints/placeholders, signing, per-platform formats, Windows exit behavior): https://v2.tauri.app/plugin/updater/
- GitHub repository rename behavior: https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository
- SLADE Doom editor: https://github.com/sirjuddington/SLADE , https://slade.mancubus.net/
- Registry probes: `registry.npmjs.org`, `crates.io/api/v1/crates`, `pypi.org/pypi`, `formulae.brew.sh/api/cask`, `api.github.com/users`
- Repo/release state: `gh api repos/SalyyS1/SLTerm`, `.../releases`, `.../releases/tags/tauri-v0.20.0`
- go-keyring v0.2.8 source, local module cache: `keyring_darwin.go`, `keyring_windows.go`, `keyring_unix.go`

Secondary/derived: `gh search repos` for the "agentic development environment" category census.


