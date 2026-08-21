# Phase 0.7 — CI repair and a release pipeline that can actually run

**Status:** done · Released as **v0.19.0** · PR [#61](https://github.com/SalyyS1/SLTerm/pull/61) merged to `main`

## Goal

Stop the permanently-failing CI runs, and replace the inherited release pipeline
with one that works in this fork.

## CI: three failing workflows, two of them pre-existing

### TestDriver.ai Build — `EBADPLATFORM`

```
npm error notsup Unsupported platform for @rollup/rollup-linux-x64-gnu@4.60.4:
  wanted {"os":"linux"} (current: {"os":"win32"})
```

`@rollup/rollup-linux-x64-gnu` was a hard `dependencies` entry, so `npm ci` on the
`windows-latest` runner died — three retries, every time. Someone added the
linux-only native binary as a regular dependency to work around npm's
optional-dependency bug on a Linux dev machine, and it broke Windows CI
permanently.

Confirmed pre-existing: the scheduled run on `main` and an unrelated dependabot
PR were both failing the same way.

**Fix:** move it to `optionalDependencies`. Rollup publishes its platform
binaries as optional deps precisely so each host resolves its own; npm now skips
it on Windows instead of erroring, and Linux still gets it.

### Docsite CI/CD — failing since 2026-04-10

```
cd docs && npm run build
npm error Missing script: "build"
```

There is **no `docs/` directory in this fork** — zero tracked files. (The
`v0.17.0` tag points at a commit literally titled "Delete docs directory".) But
`package.json` still declared `docs` as a workspace, the Taskfile still had three
`docsite:*` tasks that `cd docs`, and the workflow still deployed `docs/build` to
the GitHub Pages domain the now-deleted `CNAME` pointed at.

It fired on this branch because its trigger includes `paths: Taskfile.yml`.

**Fix:** removed the workflow, the workspace entry, and the three tasks. CI that
cannot pass should not exist.

### Merge Gatekeeper

Not a separate bug — it gates on `Build Docsite`, so removing that satisfied it.

## Release: the inherited pipeline could never run

`build-helper.yml` built into a private S3 staging bucket; `publish-release.yml`
copied from that bucket to a release bucket, then pushed to Snapcraft and WinGet.
Between them they referenced **17 secrets** — AWS keys for a
`slterm-github-artifacts` bucket, Apple notarization credentials,
`SNAPCRAFT_LOGIN_CREDS`, `WINGET_BUMP_PAT`.

`gh secret list` returns **nothing**. Zero secrets configured. None of it could
ever work.

Worse: both fired on the same `v*` tag pattern, so cutting a release would have
produced two *more* permanently-failing runs — the exact problem being fixed.

**Replaced** with `.github/workflows/release.yml`:

- uses only `GITHUB_TOKEN`; attaches installers straight to a GitHub Release
- signing secrets read if present, unsigned fallback if not, so it works today
  and improves silently once certificates exist
- `fail-fast: false` — one platform failing still ships the others rather than
  producing an empty release
- `workflow_dispatch` builds without publishing, so the pipeline can be exercised
  without cutting a release

Removed the four now-dead `artifacts:*` Taskfile tasks and `ARTIFACTS_BUCKET`.

## The Taskfile was Windows-only

`build:server` called only `build:server:windows` behind a `platforms: [windows]`
guard, and `build:wsh` built only the two Windows targets. On a macOS or Linux
runner, `task package` would have packaged **an app with no backend at all**.

Meanwhile `build/icon.icns`, `build/entitlements.mac.plist` and
`build/deb-postinstall.tpl` were all still in the repo — upstream's mac/linux
support had been cut from the Taskfile but its assets left behind.

Restored `build:server:darwin` and `build:server:linux`; `build:wsh` now covers
all six OS/arch pairs. `wsh` is installed onto remote machines over SSH, so its
target set is independent of what the desktop app runs on.

`electron-builder.config.cjs` had **no `mac` or `linux` section**. Added dmg+zip
and AppImage+deb. macOS ships per-arch rather than universal: `wavesrv` is a
separate CGO build per architecture, so a universal app would mean `lipo`-ing two
Go binaries for no benefit over two downloads.

## Version drift

The bump to `0.17.0` failed with `tag 'v0.17.0' already exists`. `package.json`
read `0.16.0`, but the repository already had tags and releases through
**v0.18.0** — the manifest had fallen behind the release history:

```
v0.16.1  v0.16.2  v0.17.0  v0.18.0 ← latest published
```

Released as **v0.19.0**. Worth checking `git tag -l 'v*' | sort -V | tail` before
any future bump rather than trusting `package.json`.

## Validation

- CI fully green on `eaeb53c`: CodeQL, Merge Gatekeeper, **TestDriver.ai Build**
  — the last of which had never passed on this repo before
- `npm ci` verified against the regenerated lock
- Linux AppImage packaged locally: 159MB, valid ELF
- Windows NSIS packaged locally: 129MB, `MZ` magic + Nullsoft signature
- Taskfile checked for dangling `- task:` references

## Not verified

**The macOS build path has never run.** It was dead behind the `platforms`
guard, and it cannot be built or tested on a Linux host. `build:server:darwin`
runs for the first time on the `macos-latest` / `macos-13` runners. If it fails,
`fail-fast: false` means Windows and Linux artifacts still publish.

Two pre-existing dangling Taskfile references were left alone:
`build:server:quickdev` and `build:backend:quickdev:windows` are referenced by
the quickdev dev tasks but were never defined, on `main` either. Nothing in CI
uses them, and inventing task bodies was out of scope.
