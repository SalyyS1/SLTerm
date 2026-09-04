# SL-ADE: Tauri 2 Windows-First Shell Research

Date: 2026-09-03 | Researcher: researcher | Status: COMPLETE (all 7 brief items covered)

Scope: Windows-primary Tauri 2 shell for SLTerm/SL-ADE. Rust shell owns zero business logic.
Reference code: `/home/stackops/saly/claude-terminal/src-tauri` (working Tauri 2 + React app, v1.31.2).
Target code: `/home/stackops/saly/SLTerm/src-tauri` (590 LOC, `dev.salyvn.slterm`, v0.20.0).
Tauri version assumed: **2.11.5** (`tauri-apps/tauri@dev crates/tauri/Cargo.toml:3`);
API names read from the `dev` branch. No source file outside this report was modified.

## 0. Baseline: what SLTerm's Tauri shell has today

Verified from source (paths absolute).

| Fact | Evidence |
|---|---|
| Window built at runtime, not in config (`app.windows: []`) — needed because the init script carries the Go backend handshake | `/home/stackops/saly/SLTerm/src-tauri/src/lib.rs:249-268`; `tauri.conf.json` `app.windows: []` |
| `decorations(false)` + `transparent(true)` (non-macOS) already set; no titlebar UI exists | `lib.rs:255`, `lib.rs:264-267` |
| Plugins registered: **none**. Only 3 deps: `tauri`, `serde`, `rand`, `hostname` | `/home/stackops/saly/SLTerm/src-tauri/Cargo.toml:15-22` |
| Capabilities: `core:default` only, `windows: ["main"]` | `/home/stackops/saly/SLTerm/src-tauri/capabilities/default.json` |
| Bundle targets: `nsis, app, dmg, deb, rpm` — **no msi**, **no `createUpdaterArtifacts`**, **no `bundle.windows` block at all** | `tauri.conf.json` `bundle.targets` |
| `tauri = { features = [] }` → no `macos-private-api`, so macOS transparency is off by design | `Cargo.toml:15` + `lib.rs:259-263` |
| Release profile already size-tuned (`opt-level="z"`, fat LTO, `panic=abort`, strip) | `Cargo.toml:31-38` |
| Data dir is **hardcoded** `~/.slterm/{data,config}`, not derived from the bundle identifier | `lib.rs:100-113` |
| Init script pattern already proven: `initialization_script()` at builder time, re-injected on navigation | `lib.rs:195-208`, `lib.rs:244-258` |
| IPC commands today: 5 (`host_open_external`, `host_open_native_path`, `host_set_fullscreen`, `host_log`, `host_show_context_menu`) | `lib.rs:213-219` |

Consequence for the plan: SLTerm's shell is a clean slate for everything in this report — nothing to un-build. The `~/.slterm` hardcoded data dir is a *lucky* property: it makes the `dev.salyvn.slterm` → SL-ADE identifier rename data-safe (see §2.6).

Reference app (`/home/stackops/saly/claude-terminal`) already ships, on Windows: frameless titlebar, updater w/ minisign + GitHub Releases, Azure Trusted Signing, tab tear-off into runtime windows, WebView2 context-menu kill, JS-level F5/Ctrl+R swallowing. It does **not** ship: Snap Layouts, tray, global shortcuts, single-instance, window-state, native app menu. Those are the genuinely new ground for SL-ADE.

## 1. Frameless window on Windows

### 1.1 The basics (already half-done in SLTerm)

`decorations(false)` is set (`lib.rs:255`). What's missing is the HTML titlebar + drag + controls.

Two drag mechanisms exist; they are not equivalent:

| Mechanism | How | Trade-off |
|---|---|---|
| `data-tauri-drag-region` attribute | Tauri's injected JS handles `mousedown` on any element carrying the attribute and calls `startDragging`/`toggleMaximize` (double-click) itself | Zero code. But it is attribute-scoped: children inherit it, so you must not put it on a container that holds buttons. Double-click-to-maximize is free. |
| `getCurrentWindow().startDragging()` on `mousedown` | Manual | Full control over exclusions. Costs you double-click-maximize (implement yourself). |

The reference app uses the manual form with a `.no-drag` opt-out class:

```tsx
// /home/stackops/saly/claude-terminal/src/components/TitleBar.tsx:142
onMouseDown={(e) => {
  if (e.buttons === 1 && (e.target as HTMLElement).closest('.no-drag') === null)
    appWindow.startDragging();
}}
```
Controls are plain buttons calling `appWindow.minimize()` / `toggleMaximize()` / `close()` (`TitleBar.tsx:330-355`), with a mac branch drawing traffic lights (`TitleBar.tsx:146-163`). Permissions required: `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-is-maximized` (see §4).

Gotcha: `startDragging()` swallows the subsequent `mouseup`, so a click that begins a drag never fires `onClick`. Hence the `e.buttons === 1` + `.no-drag` guard rather than a blanket handler.

### 1.2 Windows 11 Snap Layouts — the hard part

Status: **Tauri will not ship this** (`tauri-apps/tauri#4531`, open since 2022-06-30, labelled `status: upstream`). Maintainer FabianLars, 2024-03-30: *"This won't be implemented for v2 since we're still blocked by webview2."* Root cause, per the same thread: the Snap flyout is triggered only by `WM_NCHITTEST` returning `HTMAXBUTTON`, and that message never reaches your window because WebView2's `Chrome_RenderWidgetHostHWND` child covers the whole client area and answers first. `SetWindowSubclass` on the Tauri HWND is therefore **structurally** useless, not merely fiddly.
Evidence: https://github.com/tauri-apps/tauri/issues/4531 (comments 2023-11-06, 2024-03-30, 2026-07-29).

The technique that works (four independent plugins converged on it): create a small **transparent Win32 child window** positioned exactly over your HTML maximize button, whose window proc returns `HTMAXBUTTON` unconditionally. It never paints (NULL_BRUSH), so your CSS shows through, but it owns the mouse in that rect — so it must forward hover/click back to the page as events.

Required child-window styles (from the write-up): `WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_OVERLAPPED`, no `WS_EX_*` — **`WS_EX_LAYERED` breaks the hit test** — `NULL_BRUSH`, positioned with `SWP_ASYNCWINDOWPOS | SWP_SHOWWINDOW`. ~380 LOC if vendored.

Off-the-shelf options:

| Crate | Version / last update | Adoption | Snap overlay | Notes |
|---|---|---|---|---|
| `tauri-plugin-frame` | 1.1.8, updated 2026-05-17 (first published 2025-12-09) | 6,442 total / 4,641 recent downloads | Yes, `.snap_overlay(true)` + configurable `titlebar_height`/`button_width` | Single-author, ~9 months old. Highest capability, highest abandonment risk. |
| `tauri-plugin-decorum` | 1.1.1, updated **2024-09-22**; repo last pushed 2025-08-08 | 95,494 downloads, 322 stars, MIT | Yes — `decorum:allow-show-snap-overlay` permission implies a snap-overlay command | Author states it is "mostly in maintainance mode"; injects *its own* titlebar HTML (`button.decorum-tb-btn`, `div[data-tauri-decorum-tb]`) and asks for `withGlobalTauri: true`. Opinionated — fights a custom React titlebar. |
| `tauri-plugin-window-controls`, `tauri-plugin-decoration`, `tauri-plugin-snap-layout` | UNVERIFIED (named as equivalents, not inspected) | UNVERIFIED | claimed | |
| Vendor ~380 LOC in SLTerm's Rust shell | n/a | n/a | Yes | Zero dependency risk, and it is pure window plumbing → allowed under the "shell owns no business logic" rule. |

API shape of the plugin route:
```rust
tauri::Builder::default()
  .plugin(tauri_plugin_frame::FramePluginBuilder::new()
    .auto_titlebar(false)      // keep SLTerm's React titlebar
    .snap_overlay(true)
    .titlebar_height(32)       // MUST equal CSS
    .button_width(46)          // MUST equal CSS
    .build())
  .setup(|app| { app.get_webview_window("main").unwrap()
      .create_overlay_titlebar_with_height(32)?; Ok(()) })
```
Frontend side, because the native overlay eats the mouse over the maximize button:
`tauri-frame://snap/click` → `toggleMaximize()`; `tauri-frame://snap/mouseenter` / `mouseleave` → drive the hover class manually.

Three traps that cost the author the most time (all Windows-specific, all silent failures):

1. **`minWidth` ≤ ~500 effective px is a Microsoft requirement, not styling.** Above it the flyout still appears but the window refuses to snap into a zone. Recommended `"minWidth": 330`. **SLTerm currently sets `min_inner_size(900.0, 600.0)`** (`lib.rs:254`) → Snap Layouts would half-work out of the box. This is the single highest-value one-line finding in this section.
2. Overlay position is computed arithmetically (`x = client_right − button_width × (buttons_to_the_right + 1)`), not measured from the DOM. So Rust and CSS values must match, all caption buttons must be the same width, and nothing may sit to the right of Close. Drift = flyout silently vanishes.
3. Diagnostic for "am I in the subclassing trap": if your maximize button still shows CSS `:hover` or its native `title` tooltip, the webview got the mouse and your window did not.

DPI: the arithmetic approach was measured at 46×32 px @100% and 69×48 @150% with 0 drift, i.e. it scales. Verified on Win11 build 26200 / Tauri 2.11.5 / Rust 1.97 MSVC / WebView2 Evergreen, MIT-licensed templates + a `verify.ps1` that asserts on a live window (`PrintWindow` cannot capture the flyout — it is a separate OS window — so screenshot verification yields false failures).
Source: https://github.com/Zbrooklyn/tauri-snap-layouts (3 stars, created 2026-07-29 — treat the *technique* as credible/corroborated, the *repo* as low-adoption).

### 1.3 Rounded corners, shadow, resize border

- Rounded corners: `DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND=2)`. Microsoft's own caveat: it is a hint, and windows using **per-pixel alpha or window regions can never be rounded**. No custom radius is supported (Electron is no better: boolean `roundedCorners`, electron#47833 closed as not planned).
- CSS `border-radius` only rounds a `transparent: true` window, and `html` — not just `body` — must be transparent.
- `decorations: false` **keeps the invisible ~8px resize grab border**, which is why `outerPosition()` and `innerPosition()` disagree. All 8 edges/corners still hit-test correctly (Tauri implements this in `crates/tauri-runtime-wry/src/undecorated_resizing.rs`).
- Maximize edge clipping / taskbar overhang: **UNVERIFIED for Tauri 2.** Neither issue #4531 nor the snap-layouts write-up mentions `WM_NCCALCSIZE` or maximized overhang; the classic Win32 "maximized frameless window covers the taskbar by the frame width" bug is not documented as present in current Tauri. Do not budget for it; test it on the first Windows build.

### 1.4 Transparency + vibrancy cost on WebView2

`transparent: true` is already on for SLTerm (non-macOS, `lib.rs:264-267`), and the comment there is correct: macOS transparency needs the `macos-private-api` cargo feature, which disqualifies Mac App Store distribution.

`window-vibrancy` 0.8.0 (Apache-2.0/MIT, maintained by tauri-apps) gives Windows: `apply_blur` (Win7 / Win10 1809+), `apply_acrylic` (Win10 1809+), `apply_mica` / `apply_tabbed` (Win11 only). Linux is a no-op — the compositor owns it. https://docs.rs/window-vibrancy/latest/window_vibrancy/
No transparency-cost or drag-lag numbers are documented on that page → **the "transparency is expensive on WebView2" claim is UNVERIFIED**. It is widely repeated in issue threads but I found no measurement. Since SLTerm renders xterm.js canvases/WebGL over the whole client area, and per-pixel alpha *also* forbids DWM rounded corners (§1.3), transparency is worth questioning rather than assuming.

### 1.5 Addendum — two Windows facts found while researching §5/§6 that change §1

Both verified from source after §1.1-1.4 were written.

**(a) `app-region: drag` works natively in Tauri 2 on Windows.** wry unconditionally
enables the WebView2 non-client-region setting:
`if let Ok(settings9) = settings.cast::<ICoreWebView2Settings9>() { settings9.SetIsNonClientRegionSupportEnabled(true)?; }`
— `wry/src/webview2/mod.rs:667-669` (added in wry PR #1262). Microsoft's description of
what that buys, verbatim: regions marked `app-region: drag` are *"treated like the window's
title bar, supporting dragging of the entire WebView and its host app window; the system
menu shows upon right click, and a double click will trigger maximizing/restoration of the
window size"*
(https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2settings,
`IsNonClientRegionSupportEnabled`).

That is strictly more than `data-tauri-drag-region` or `startDragging()` give you: the
right-click system menu and double-click-maximize come from the OS, there is no
JS round-trip, and the `mouseup`-swallowing problem in §1.1 disappears.
```css
.titlebar        { app-region: drag; }
.titlebar button { app-region: no-drag; }
```
Caveats: Windows-only (WebKitGTK/macOS ignore it, so keep `data-tauri-drag-region` or
`startDragging()` for Linux/macOS); requires a WebView2 recent enough to expose
`ICoreWebView2Settings9`, otherwise the `cast` fails and the style is silently inert — one
more reason to set `minimumWebview2Version` (§6). **UNVERIFIED**: whether applying
`app-region: drag` *and* `data-tauri-drag-region` to the same element double-handles
double-click (both implement toggle-maximize). Pick one per platform.
The same doc notes the setting only takes effect **after the next navigation**, which is
fine for a window created with the style already in the bundle.

**(b) Rounded corners are a one-liner, not a DWM call.** Config schema,
`WindowConfig.shadow` (default `true`): *"`false` has no effect on decorated window,
shadow are always ON. `true` will make undecorated window have a 1px white border, and on
Windows 11, it will have a rounded corners."* Rust equivalent:
`WebviewWindowBuilder::shadow(bool)` (`crates/tauri/src/webview/webview_window.rs:673`).
So on Win11 an undecorated window with `shadow: true` is already rounded — no
`DwmSetWindowAttribute`, no unsafe block. The 1px white border is the cost, and it is
visible against a dark titlebar; **UNVERIFIED** whether it can be recolored (it is drawn
by DWM, not CSS).


### Recommendation for SL-ADE (§1)

1. **Drag: `app-region: drag` on Windows** (native system menu + double-click maximize,
   zero JS), with the manual `startDragging()` + `.no-drag` pattern from
   `/home/stackops/saly/claude-terminal/src/components/TitleBar.tsx:142` as the
   Linux/macOS fallback. Amends §1.1: the reference app's JS-only approach is proven but
   is no longer the best available on Windows (§1.5a).
2. **Drop `transparent(true)` on Windows and rely on `shadow: true` for Win11 rounded
   corners** (§1.5b) instead of CSS `border-radius` or a `DwmSetWindowAttribute` call.
   Rationale unchanged from §1.3: per-pixel alpha forbids DWM rounding, opaque is the
   cheaper compositing path, and nothing in SLTerm's design needs see-through chrome.
   Keep `transparent` only if a Mica/acrylic titlebar becomes a design requirement — then
   use `window-vibrancy`, not raw transparency.
3. **Set `min_inner_size` width to 330** (keep min height 600). One-line change, gates Snap Layouts working at all.
4. Snap Layouts: **vendor the ~380-LOC child window** into `src-tauri` rather than depend on `tauri-plugin-frame` (9 months old, one author, 6.4k downloads) or `tauri-plugin-decorum` (stale since 2024, injects its own titlebar HTML). Vendoring is pure Win32 window plumbing → compliant with the zero-business-logic rule, and immune to abandonment. Prototype against `tauri-plugin-frame` first to confirm behavior, then inline.
5. Do Snap Layouts **after** the titlebar ships, not with it — it is the one piece that can be deferred without blocking anything, and it forces titlebar geometry (button width, height, ordering) to be frozen first.

Effort: titlebar + drag + controls **1-1.5 d**. Rounded corners + `min_inner_size` **0.5 d**. Snap Layouts overlay **1.5-2.5 d** (Windows-only debugging, silent failure modes, needs a real Win11 box). Total **3-4.5 d**.

## 2. Updater

Docs: https://v2.tauri.app/plugin/updater/ | https://v2.tauri.app/distribute/windows-installer/

### 2.1 Wiring

```bash
cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
npm install @tauri-apps/plugin-updater
```
```rust
#[cfg(desktop)]
app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
```
Requires Rust ≥ 1.77.2 (SLTerm pins `rust-version = "1.82"` — fine). Desktop only.

### 2.2 Keys

```bash
npm run tauri signer generate -- -w ~/.tauri/slade.key
export TAURI_SIGNING_PRIVATE_KEY="<path or content>"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```
- Signature verification **cannot be disabled**. Lose the private key → you can never update installed clients again. Store it in a password manager *and* as a GitHub Actions secret.
- `plugins.updater.pubkey` must be the key **text**, not a path.
- `.env` files do not work for the signing env vars (docs say so explicitly).

### 2.3 Config

```json
"bundle": { "createUpdaterArtifacts": true },
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
    "endpoints": ["https://github.com/SalyyS1/SLTerm/releases/latest/download/latest.json"],
    "windows": { "installMode": "passive", "installerArgs": [] }
  }
}
```
`windows.installMode` (verified against the plugin's `WindowsUpdateInstallMode` enum, `plugins/updater/src/config.rs`):

| Mode | msiexec args | Behavior |
|---|---|---|
| `passive` (**default**) | `/passive` | Progress bar only, no interaction. Recommended. |
| `basicUi` | `/qb+` | Visible UI incl. final dialog; user must click. |
| `quiet` | `/quiet` | No feedback, **cannot self-elevate** → only safe for `currentUser` installs. |

`windows.installerArgs: Vec<OsString>` also exists (applies to both NSIS and WiX) — not documented on the docs page but present in the config struct.

Endpoint placeholders: only `{{current_version}}`, `{{target}}` (`linux`|`windows`|`darwin`), `{{arch}}` (`x86_64`|`i686`|`aarch64`|`armv7`). Custom variables unsupported. Multiple endpoints are tried in order, advancing only on **non-2XX**. TLS enforced in production unless `dangerousInsecureTransportProtocol: true`.

### 2.4 latest.json

```json
{
  "version": "0.21.0",
  "notes": "…",
  "pub_date": "2026-09-03T12:00:00Z",
  "platforms": {
    "windows-x86_64": { "signature": "<contents of .sig>", "url": "https://…/SLTerm_0.21.0_x64-setup.exe" },
    "linux-x86_64":   { "signature": "…", "url": "https://…/…AppImage" },
    "darwin-aarch64": { "signature": "…", "url": "https://…/…app.tar.gz" }
  }
}
```
- `version`: SemVer, leading `v` optional. `pub_date`: RFC 3339.
- `signature` must be the **text** of the `.sig`, not a path/URL.
- The **whole document is validated before `version` is read** → one malformed platform entry breaks updates for every platform. This is the #1 latest.json footgun.
- Dynamic-server alternative: `204` = no update; `200` + `{version,url,signature,pub_date,notes}` flat.

### 2.5 Artifacts: NSIS vs MSI

With `createUpdaterArtifacts: true` the real installers double as update payloads: `target/release/bundle/nsis/*-setup.exe` and `bundle/msi/*.msi`, each with a `.sig`. (`"v1Compatible"` wraps them in `.zip` — only for v1 migration, and it "will be removed in v3".)

| | NSIS (`-setup.exe`) | MSI (WiX v3) |
|---|---|---|
| Buildable on Linux/macOS host | Yes (with `lld`/`cargo-xwin` caveats) | **No — Windows only** |
| i18n | one multi-language binary | one installer per language |
| Per-user install w/o admin | Yes, default | Awkward |
| ARM64 | app binary is native ARM64; **the installer itself stays x86 under emulation** | — |

`tauri-action` exposes `updaterJsonPreferNsis: true` to pick NSIS as the Windows update payload when both exist (used at `/home/stackops/saly/claude-terminal/.github/workflows/release.yml:146`).

### 2.6 Does changing the bundle identifier orphan installed clients? — **No. Changing `productName` does.**

Verified against the bundler source, not docs:

- **NSIS**: `!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"` — `crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi:66`. Install dir is `$LOCALAPPDATA\${PRODUCTNAME}` (per-user) or `$PROGRAMFILES64\${PRODUCTNAME}` (per-machine) — same file :504-514. `MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"` :115.
- **MSI/WiX**: `upgrade_code = wix.upgradeCode.unwrap_or(Uuid::new_v5(NAMESPACE_DNS, "{product_name}.exe.app.x64"))` — `crates/tauri-bundler/src/bundle/windows/msi/mod.rs:619-629`. Inspect the current value with `tauri inspect wix-upgrade-code` (source comment :618).
- `BUNDLEID` is used in the NSIS template for the **URL-protocol registration** (`WriteRegStr SHCTX "Software\Classes\{{protocol}}" "" "URL:${BUNDLEID} protocol"`, :673), not for install identity.

So the sequencing rule for the SL-ADE rebrand is the inverse of the intuition in the brief:

| Change | Effect on installed Windows clients |
|---|---|
| `identifier: dev.salyvn.slterm` → `dev.salyvn.slade` | **Safe.** No uninstall-key or upgrade-code change. Breaks only: registered URL protocols, and Tauri's `app_data_dir()`/`app_config_dir()` paths. SLTerm hardcodes `~/.slterm/{data,config}` (`lib.rs:100-113`), so **no user data moves**. |
| `productName: SLTerm` → `SL-ADE` | **Orphans everyone.** New NSIS UNINSTKEY → old install is neither detected nor removed: two Add/Remove entries, two dirs (`%LOCALAPPDATA%\SLTerm` + `…\SL-ADE`), two Start Menu shortcuts. New WiX upgrade code → MSI installs side-by-side instead of upgrading. |
| `wix.upgradeCode` pinned explicitly | Makes MSI upgrades survive a `productName` change. NSIS has **no equivalent escape hatch** short of a custom `.nsi` template or an `NSIS_HOOK_PREINSTALL` that uninstalls the old key. |

**Recommendation for SL-ADE (§2):**
1. Ship the updater **before** any rename, on `productName: "SLTerm"`, so there is a working update channel to migrate people with.
2. **Pin `bundle.windows.wix.upgradeCode`** to a fixed UUID now, in the same commit that adds `msi` to targets (the reference app does exactly this: `tauri.conf.json:63-66`). Cheap insurance; free if done before the first MSI ships.
3. Rename the **identifier** freely (it is safe). Postpone the **`productName`** rename to a deliberate "migration release": either accept the double-entry (acceptable for a 0.x prerelease audience with ~0 installed base — which is SLTerm's actual situation today) or add an `NSIS_HOOK_PREINSTALL` that runs the old `UninstallString` silently.
4. Endpoint: `https://github.com/SalyyS1/SLTerm/releases/latest/download/latest.json`. **Note the prerelease trap:** `/releases/latest/` resolves to the latest *non-prerelease*. Tag `tauri-v0.20.0` is a prerelease, so this URL 404s until a full release exists — and a 404 is non-2XX, so the updater silently falls through to the next endpoint / reports no update. Either promote a real release or use a pinned/dynamic endpoint.
5. On Windows the app is **force-quit** when the installer runs. Hook `on_before_exit` to flush; more importantly, SLTerm must kill the `wavesrv` sidecar there too — `RunEvent::Exit` (`lib.rs:273-281`) may not fire on an installer-driven kill. **UNVERIFIED**: whether `RunEvent::Exit` runs during updater-triggered exit. Test explicitly; a surviving `wavesrv` holds the data-dir lock and the post-update launch fails.

Effort: **1-1.5 d** (config + plugin + a check-on-startup UI + latest.json in CI), plus **0.5 d** to prove the sidecar-shutdown path.

## 3. Windows code signing for a solo OSS dev

First fact that changes the shape of this decision: **Azure Trusted Signing was renamed Azure Artifact Signing.** Docs now live at `learn.microsoft.com/en-us/azure/artifact-signing/*` (`ms.date: 2026-05-21`, updated 2026-08-11); the resource provider is still `Microsoft.CodeSigning`, the CLI is `az artifact-signing`, and Tauri's own guide now says `cargo install artifact-signing-cli` with `signCommand`. The reference repo's workflow uses the **older** `Azure.CodeSigning.Dlib.dll` + `signtool /dlib /dmdf` path (`/home/stackops/saly/claude-terminal/.github/workflows/release.yml:108-131`, `scripts/sign-windows.ps1:23-31`) — it still works but is the legacy invocation; do not copy it blindly.

### 3.1 Option matrix

| Option | Cost | Eligibility | SmartScreen | Effort | Risk |
|---|---|---|---|---|---|
| **Azure Artifact Signing**, Basic SKU | **$9.99/mo** (secondary source: melatonin.dev; MS pricing page renders `$-` placeholders without region selected). Basic = 5,000 signatures/mo, 1 of each cert profile type. Billing starts at account creation, **not pro-rated**. | **Public Trust certs: organizations in US, CA, EU, UK, AU, NZ, JP, KR, SG, CH, NO, IL. Individual developers must be located in the United States or Canada.** Billing-account type must match identity type. | Immediate — reputation attaches to the *validated identity*, not the certificate (secondary source) | ~0.5 d CI wiring + 1-20 business days validation | Identity validation record expires 2 y after request; Entra client secret expiry surfaces as `AADSTS7000222` CI failure |
| **SignPath Foundation** (free OSS) | **Free** | OSI-approved license, **no commercial dual-licensing**, no proprietary components, actively maintained, verifiable reproducible builds, MFA on SignPath + repo, defined author/reviewer/approver roles, **every release manually approved**, homepage must carry a "Code signing policy" section with the attribution string. Discretionary acceptance, no appeal. | Real cert → real trust chain; reputation accrues to SignPath Foundation's identity (already widely used) | ~1-2 d (application + policy page + CI + per-release approval step) | **Certificate subject is "SignPath Foundation", so that becomes SL-ADE's displayed publisher — not "Salyvn".** Subscription can be paused/terminated without notice. |
| OV cert from a commercial CA | ~$200-400/yr, HSM/token required | Available to individuals | Warnings until reputation accrues; optional manual submission to MS *may* grant per-file reputation | 1 d | Tauri's own guide is explicit: *"This guide only applies to OV code signing certificates acquired before June 1st 2023!"* — the post-2023 hardware-key regime broke the old PFX-in-CI workflow |
| EV cert | ~$400-700/yr | Org only | "immediate reputation with Microsoft SmartScreen and won't show any warnings" | 1 d | Cost + org requirement |
| **Self-signed** | Free | n/a | **Zero benefit.** Not in any trust root → SmartScreen still blocks, UAC still shows "Unknown publisher". Only useful when you can push the root cert (enterprise/internal). | 0.5 d | Actively misleading: build logs say "Successfully signed" while users see identical warnings |
| **Unsigned** | Free | n/a | "Windows protected your PC" on browser download; Tauri: *"It is not required to execute your application on Windows"* | 0 | Status quo. Costs conversions, not functionality. |

Sources: https://v2.tauri.app/distribute/sign/windows/ · https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart · https://learn.microsoft.com/en-us/azure/artifact-signing/overview · https://azure.microsoft.com/en-us/pricing/details/trusted-signing/ · https://signpath.org/ · https://signpath.org/terms · https://melatonin.dev/blog/code-signing-on-windows-with-azure-trusted-signing/

### 3.2 Config shape (either Azure path)

```json
"bundle": { "windows": {
  "signCommand": "artifact-signing-cli -e https://wus2.codesigning.azure.net -a SLAdeSigning -c SLAdeProfile -d SL-ADE %1"
}}
```
`-d` matters: for `.msi` it becomes the installer name in the **UAC prompt**; omit it and a random string shows. Env: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`. `signCommand` is also the **only** way to sign when cross-compiling Windows artifacts from Linux — the built-in signtool path is Windows-host only, which matters because SLTerm's `nsis` target is currently produced on a non-Windows host.

### Recommendation for SL-ADE (§3)

**Ranked:**

1. **SignPath Foundation.** It is the only free option that produces a real trust chain, and — decisively — it carries **no geographic restriction**. Azure Artifact Signing's individual tier is US/Canada-only and its organization tier does not list Vietnam, so a Vietnam-based solo dev under the "Salyvn" brand is very likely ineligible for either. Accept that the publisher string reads "SignPath Foundation"; that is a strictly better user-facing outcome than "Unknown publisher". Blocking prerequisites to check before applying: SLTerm is Apache-2.0 (OSI, no dual license) ✓; needs a "Code signing policy" homepage section, MFA, and reproducible builds.
2. **Azure Artifact Signing Basic ($9.99/mo)** — only if the owner can validate as a US/CA individual or an entity in a listed country. Best UX (instant reputation, no per-release approval, cert rotation handled). Wire it via `signCommand` + `artifact-signing-cli`, not the legacy dlib.
3. **Ship unsigned and say so.** Explicitly acceptable for a 0.x prerelease. Put a one-line "why SmartScreen warns" note in the README rather than pretending.
4. **Never self-sign for public distribution.** It costs effort and delivers nothing; worse, it makes CI report success while users see the same warning.

Sequencing: signing is **independent of everything else in this report** and gates nothing technically — but the updater must be shipped and stable *before* signing, because a signing misconfiguration that breaks the installer is far cheaper to discover with a working update channel than without.

Effort: SignPath **1-2 d** + application lead time. Azure **0.5 d** + 1-20 business days validation.

### 3.3 macOS notarization (brief)

Not the primary platform. Requires paid Apple Developer Program membership (~$99/yr), a Developer ID Application certificate, hardened runtime, and `xcrun notarytool` submission + stapling; Tauri drives this from env vars in CI. Without notarization, Gatekeeper blocks the `.dmg`/`.app` on first launch and the user must right-click → Open. Separately, SLTerm cannot use `transparent(true)` on macOS without the `macos-private-api` feature, which disqualifies Mac App Store submission (`lib.rs:259-263`). **Exact env-var names and notarytool flags UNVERIFIED — not researched, out of Windows-first scope.**

## 4. Native surface plugins + capability JSON

### 4.1 What `core:default` already gives SLTerm

Verified from the generated ACL manifest, `/home/stackops/saly/SLTerm/src-tauri/gen/schemas/acl-manifests.json`:

`core:default` = `core:path:default` + `core:event:default` + `core:window:default` + `core:webview:default` + `core:app:default` + `core:image:default` + `core:resources:default` + `core:menu:default` + **`core:tray:default`**.

`core:window:default` is **getters only** — `allow-get-all-windows`, `allow-inner/outer-position`, `allow-inner/outer-size`, `allow-is-maximized/minimized/focused/decorated/resizable/visible`, `allow-title`, `allow-scale-factor`, monitor queries, `allow-cursor-position`, `allow-theme`, plus `allow-internal-toggle-maximize`.
Consequence: **every window *action* SLTerm's titlebar needs is currently denied.** But `core:tray:default` is already fully granted (`allow-new`, `allow-set-icon`, `allow-set-menu`, `allow-set-tooltip`, `allow-set-visible`, …) — the tray needs only a Cargo feature, no capability edit.
`core:webview:default` = `allow-get-all-webviews`, `allow-webview-position`, `allow-webview-size`, `allow-internal-toggle-devtools` → `create-webview-window` (tear-off) must be added.

### 4.2 Plugin-by-plugin

| Need | Crate | JS pkg | Permissions to add | Notes |
|---|---|---|---|---|
| Single-instance lock | `tauri-plugin-single-instance` | none | **none** — the plugin has no `permissions/` dir at all (verified: `repos/tauri-apps/plugins-workspace/contents/plugins/single-instance/permissions` → 404). Rust-only. | **Must be registered FIRST**, before any other plugin. Callback receives `(app, argv, cwd)` → focus the existing window. Pairs with `deep-link` if URL handling lands. |
| Tray icon | core (`tauri` feature `tray-icon`) | `@tauri-apps/api/tray` | already covered by `core:default` → `core:tray:default` | Also needs `image-png`/`image-ico` features to load an icon from bytes. |
| Global shortcuts | `tauri-plugin-global-shortcut` | `@tauri-apps/plugin-global-shortcut` | **`global-shortcut:default` is empty by design** — *"No features are enabled by default, as we believe the shortcuts can be inherently dangerous"*. Grant explicitly: `global-shortcut:allow-register`, `allow-unregister`, `allow-is-registered` (+`allow-register-all`/`allow-unregister-all` if used — identifier names for the `-all` variants **UNVERIFIED**). | Desktop-only. Global = OS-wide, steals the chord from every app; use sparingly (one show/hide hotkey). |
| Native dialogs | `tauri-plugin-dialog` | `@tauri-apps/plugin-dialog` | `dialog:default` = `allow-message`, `allow-save`, `allow-open` | Note `allow-ask`/`allow-confirm` are **not** in the default set. |
| Notifications | `tauri-plugin-notification` | `@tauri-apps/plugin-notification` | `notification:default` (16 perms incl. `allow-notify`, `allow-show`, `allow-request-permission`, channel mgmt) | Reference app instead shells out to `notify-rust` from a Rust command (`Cargo.toml:18`, `commands::send_notification`) — a valid alternative if the Go backend should own notification policy. |
| Window geometry persistence | `tauri-plugin-window-state` | `@tauri-apps/plugin-window-state` | `window-state:default` = `allow-filename`, `allow-restore-state`, `allow-save-window-state` | **Conflict warning:** SLTerm builds its window at runtime in `setup()` (`lib.rs:249-268`); the plugin restores state on window creation, so ordering matters. Also interacts badly with per-window tear-off labels — state is keyed by label, and `detached-<uuid>` labels are never reused. |
| Open URLs / reveal in folder | `tauri-plugin-opener` | `@tauri-apps/plugin-opener` | `opener:default` = `allow-open-url`, `allow-reveal-item-in-dir`, `allow-default-urls` (`mailto:`,`tel:`,`https://`,`http://`) | **SLTerm already implements this itself** in Rust (`host::host_open_external`, `host_open_native_path`, `lib.rs:214-215`). Prefer keeping those — fewer deps, and the web-block "open in system browser" requirement is already satisfied. Adopt the plugin only if you want the JS-side allowlist. |
| Clipboard | `tauri-plugin-clipboard-manager` | `@tauri-apps/plugin-clipboard-manager` | **`clipboard-manager:default` is empty by design.** Grant `clipboard-manager:allow-read-text`, `allow-write-text` explicitly (exactly what the reference app does, `capabilities/default.json`). | The webview's own `navigator.clipboard` works for most cases; WebView2 gates it on focus, which is why the reference app funnels everything through `src/lib/clipboard.ts`. |
| Relaunch after update | `tauri-plugin-process` | `@tauri-apps/plugin-process` | `process:default` = `allow-exit`, `allow-restart` | Needed by the updater flow (`relaunch()`). |
| Updater | `tauri-plugin-updater` | `@tauri-apps/plugin-updater` | `updater:default` = `allow-check`, `allow-download`, `allow-install`, `allow-download-and-install` | §2 |

Source for all `*:default` contents: `repos/tauri-apps/plugins-workspace` → `plugins/<name>/permissions/default.toml`.

### 4.3 Target capability file

```jsonc
// /home/stackops/saly/SLTerm/src-tauri/capabilities/default.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main", "detached-*"],          // glob needed for tear-off windows
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize", "core:window:allow-toggle-maximize",
    "core:window:allow-unmaximize", "core:window:allow-close",
    "core:window:allow-set-focus", "core:window:allow-show", "core:window:allow-hide",
    "core:window:allow-set-size", "core:window:allow-set-position",
    "core:window:allow-set-fullscreen", "core:window:allow-set-title",
    "core:webview:allow-create-webview-window",
    "dialog:default",
    "notification:default",
    "window-state:default",
    "clipboard-manager:allow-read-text", "clipboard-manager:allow-write-text",
    "global-shortcut:allow-register", "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered",
    "process:default",
    "updater:default"
  ]
}
```
Gotcha: the `windows` array is a **label** matcher, and `"main"` alone silently denies every torn-off window — a failure that shows up as IPC calls rejected only in detached windows. The reference app uses `["main", "detached-*", "drag-preview"]`.

### Recommendation for SL-ADE (§4)

Add in this order, because each is independently shippable and later ones depend on earlier UI:
1. `single-instance` (registered first in the builder) — **highest value per LOC.** Today a second launch spawns a second `wavesrv` that cannot take the `~/.slterm/data` lock, so the app fails in a confusing way. **0.5 d**
2. Window action permissions + `create-webview-window` — unblocks §1 and §7. **0.25 d**
3. `tray-icon` (core, no new dep, no capability change) + `dialog`. **1 d**
4. `window-state` — but **only after** tear-off exists, and with a decision on whether detached windows persist at all. **0.5-1 d**
5. `global-shortcut` — one hotkey (show/hide), user-configurable later via the existing Go config layer. **0.5 d**
6. `notification` — or keep it in Go/Rust if the backend should own the policy. **0.5 d**
7. Skip `opener` and `clipboard-manager` unless a concrete need appears: SLTerm already has Rust equivalents for opener, and xterm.js/`navigator.clipboard` covers clipboard. Adding them is DRY-negative.

Total **3.5-4.5 d**.

## 5. Key interception without Electron `before-input-event`

There is no Tauri equivalent of `webContents.on('before-input-event')`. Nothing in Rust
sees a keystroke that lands in the webview. So interception happens at exactly three
layers, and picking the wrong one is the usual failure.

### 5.1 What WebView2 actually swallows — authoritative list

Microsoft, `CoreWebView2Settings.AreBrowserAcceleratorKeysEnabled`
(https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2settings,
doc rev `ms.date: 2026-07-27`). Setting it false "disables all accelerator keys that
access features specific to a web browser, **including but not limited to**":

| Chord | WebView2 action | Kill switch available to Tauri today |
|---|---|---|
| `F5`, `Ctrl+R` | reload top-level document → **destroys all React state / open terminals** | JS `preventDefault` (§5.2) or COM (§5.3) |
| `Ctrl+F`, `F3` | Find on Page | same |
| `Ctrl+P` | Print | same |
| `Ctrl++` / `Ctrl+-` / `Ctrl+wheel` | zoom | **config**: `zoomHotkeysEnabled` (default `false`) → `SetIsZoomControlEnabled` |
| `F12`, `Ctrl+Shift+C`, `Ctrl+Shift+I` | DevTools | **config**: `devtools: false` → `SetAreDevToolsEnabled` |
| hardware Back / Forward / Search keys | navigation | JS or COM |
| pinch-zoom (touch) | page scale | same flag as zoom (`IsPinchZoomEnabled`) |

Explicitly **not** disabled by that flag, per the same doc: `Home`, `End`, `PageUp`,
`PageDown`, `Ctrl+X/C/V`, `Ctrl+A`, `Ctrl+Z`. Those "will always be enabled unless they
are handled in the `AcceleratorKeyPressed` event" — an event wry does not surface.

Which of these wry already wires from Tauri config (`wry/src/webview2/mod.rs`):
`SetIsStatusBarEnabled(false)` :637 · `SetAreDefaultContextMenusEnabled(pl_attrs...)` :638 ·
`SetIsZoomControlEnabled(attributes.zoom_hotkeys_enabled)` :639 ·
`SetAreDevToolsEnabled(attributes.devtools)` :640 · `SetIsPinchZoomEnabled(…zoom_hotkeys_enabled)` :660.

So zoom and DevTools are **already solved by config**. Reload/Find/Print are not.

### 5.2 Layer 1 — JS `keydown` + `preventDefault` (what the reference app ships)

```ts
// /home/stackops/saly/claude-terminal/src/hooks/useKeyboardShortcuts.ts:64
if (e.key === 'F5' || (ctrl && !shift && (e.key === 'r' || e.key === 'R'))) {
  e.preventDefault();
  …
}
```
Empirically sufficient in a shipping app (v1.31.2, Windows primary). Four gotchas, each
already encoded in that file and worth copying rather than rediscovering:

1. **With `Shift` held, `e.key` is uppercase.** `Ctrl+Shift+N` is `e.key === 'N'`, and
   `e.key === 'n'` never matches (`useKeyboardShortcuts.ts:74`). Half of all
   "my Ctrl+Shift chord doesn't fire" bugs are this.
2. **Guard editable focus.** `isFocusInNonTerminalEditable()`
   (`useKeyboardShortcuts.ts:15-25`) returns *false* for anything inside `.xterm` — so
   terminal-focused shortcuts still work — but *true* for `input`/`textarea`/
   `contenteditable`, where the native control must win or `Ctrl+P`, `Ctrl+W`, `F2`
   get stolen mid-edit.
3. **IME**: ignore `keydown` while composing — `e.isComposing === true` (equivalently
   `e.keyCode === 229`). xterm.js manages composition in its own hidden helper textarea,
   which is exactly why the guard above whitelists `.xterm`. Routing composition
   keystrokes to the PTY produces duplicated/garbled CJK and Vietnamese input.
4. **The context menu is a second reload vector.** WebView2's default menu carries
   "Refresh". `usePreventWebviewReload.ts:29-33` kills `contextmenu` globally except in
   `input, textarea, .monaco-editor, .xterm-helper-textarea, [contenteditable="true"]`,
   and adds a `beforeunload` backstop (:35-41) that cancels a refresh while terminals are
   open. Note in the same file: Tauri closes windows through the OS `close_requested`
   path, **not** `beforeunload`, so blocking `beforeunload` does not trap the user.

Cost: ~0 LOC of Rust, works on all three platforms, but it is a per-chord allowlist —
anything you forget stays live.

### 5.3 Layer 2 — the real fix, which Tauri does not expose

wry *has* it: `WebViewBuilderExtWindows::with_browser_accelerator_keys(bool)`
(`wry/src/lib.rs:1802`, impl :1883, default `true` :1768) → applied at
`wry/src/webview2/mod.rs:649-651` via `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled`.

Tauri does **not** pass it through: `WindowConfig` has no such key (checked against the
full property list of `schema.tauri.app/config/2`), and a code search for
`browser_accelerator_keys` in `tauri-apps/tauri` returns **0 hits** (GitHub code search,
2026-09-03). Filing/patching upstream is the clean long-term answer.

Escape hatch that works today — `with_webview` + raw COM:

```rust
// src-tauri/Cargo.toml
[target.'cfg(windows)'.dependencies]
webview2-com = "0.38"   // MUST match tauri 2.11.5's own dep: crates/tauri/Cargo.toml:134

// after window creation
#[cfg(windows)]
win.with_webview(|wv| unsafe {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    let core: ICoreWebView2 = wv.controller().CoreWebView2().unwrap();
    let s3: ICoreWebView2Settings3 = core.Settings().unwrap().cast().unwrap();
    s3.SetAreBrowserAcceleratorKeysEnabled(false).unwrap();
})?;
```
`PlatformWebview::controller()` returns
`webview2_com::…::ICoreWebView2Controller` (`crates/tauri/src/webview/mod.rs:181-187`).

Gotchas: (a) a `webview2-com` version other than Tauri's produces two distinct Rust types
for the same COM interface and the cast will not compile — verify with
`cargo tree -p webview2-com`; (b) Tauri's own docs warn `with_webview` is unstable
across minor versions, so pin Tauri (`crates/tauri/src/webview/mod.rs:1743`);
(c) this is Windows-only, so Layer 1 is still needed for Linux/macOS.

### 5.4 What `additionalBrowserArgs` can and cannot do

It is a Chromium command-line string, not a settings API — it **cannot** disable
accelerator keys. And per the config schema: *"By default wry passes
`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` so if you use this
method, you also need to disable these components by yourself if you want."*
Overwriting it silently re-enables the Edge out-of-band UI and SmartScreen page checks.
Rust equivalent: `WebviewWindowBuilder::additional_browser_args()`
(`crates/tauri/src/webview/webview_window.rs:1080`).

### 5.5 Alt, Alt+F4, and the app menu

- `Alt+F4` is a window-level `WM_SYSCOMMAND`, not a webview accelerator: it arrives as
  `WindowEvent::CloseRequested` and is interceptable with `api.prevent_close()`. The
  reference app's whole shutdown path hangs off that event
  (`src-tauri/src/main.rs:250-296`).
- **Do not install a native menu bar.** Alt-activation, mnemonics and the Win32 menu
  bar all come with it, and with `decorations: false` the bar has nowhere native to
  render. SLTerm already has the correct primitive: `menu.popup(window)`
  (`/home/stackops/saly/SLTerm/src-tauri/src/menu.rs:157`) with the frontend owning the
  item list and `on_menu_event` → `emit_menu_click` routing clicks back
  (`lib.rs:220-224`, `menu.rs:161-165`). Wave's `showWorkspaceAppMenu` is a popup menu at
  a point, so the only gap is position: use
  `ContextMenu::popup_at(window, position)` (`crates/tauri/src/menu/mod.rs:740`) instead
  of `popup()` so the menu opens under the hamburger rather than at the cursor.
- OS-reserved chords (`Win+*`, `Ctrl+Alt+Del`, `Ctrl+Shift+Esc`) are not interceptable by
  any layer.
- `tauri-plugin-global-shortcut` registers **OS-wide** grabs; it is the wrong tool for
  in-app accelerators — it would steal the chord from every other application.

### Recommendation for SL-ADE (§5)

1. **Config first, free:** keep `zoomHotkeysEnabled: false`, set `devtools: false` in
   release. Because SLTerm builds its window in Rust, call
   `.zoom_hotkeys_enabled(false)` explicitly rather than relying on the default.
2. **Port `usePreventWebviewReload` + the F5/`Ctrl+R` swallow + the editable-focus guard
   verbatim** from the reference app. This is the cross-platform baseline and it is
   already battle-tested against xterm.js and Monaco.
3. **Add the ~15-line COM call** to turn `AreBrowserAcceleratorKeysEnabled` off on
   Windows. It converts an allowlist (forever incomplete) into a denylist (complete by
   construction) and covers `Ctrl+F`/`Ctrl+P`/`F3`, which JS handlers usually miss. Pure
   webview plumbing → allowed under the zero-business-logic rule.
4. Keybinding *policy* (which chord does what, user overrides) stays in Go/React, per the
   architecture rule. The shell only decides which chords the webview is allowed to eat.
5. Do **not** touch `additionalBrowserArgs` unless a specific Chromium switch is needed;
   if you do, re-add the three `--disable-features` values.

Effort: **0.75-1.25 d** (0.25 config + 0.25 port JS layer + 0.5 COM hatch incl. a
Windows build to prove the cast compiles and `Ctrl+F` is dead).

## 6. WebView2 runtime + NSIS install mode

Docs: https://v2.tauri.app/distribute/windows-installer/ (source:
`tauri-apps/tauri-docs@v2 src/content/docs/distribute/windows-installer.mdx`).
Config authority: `https://schema.tauri.app/config/2` → `WebviewInstallMode`,
`NSISInstallerMode`.

### 6.1 `bundle.windows.webviewInstallMode`

Default is `{"type": "downloadBootstrapper", "silent": true}` (schema default). All five
variants take a `silent` boolean except `fixedRuntime`, which takes `path`.

| Mode | Internet at install? | Added installer size | Notes (docs table, `windows-installer.mdx:216-222`) |
|---|---|---|---|
| `downloadBootstrapper` | yes | 0 MB | **default**; not recommended for Win7 via `.msi` |
| `embedBootstrapper` | yes | ~1.8 MB | better Win7 support for `.msi` |
| `offlineInstaller` | **no** | ~127 MB | embeds the full WebView2 installer |
| `fixedRuntime` | no | ~180 MB | embeds a pinned runtime; **you** own CVE patching |
| `skip` | no | 0 MB | "Your application WILL NOT work if the user does not have the runtime installed and won't attempt to install it." |

Doc/schema discrepancy: the docs table calls the fourth mode `fixedVersion`; the schema
enum is **`fixedRuntime`** (with a required `path` pointing at an extracted `.cab`
folder). Trust the schema.

Related: `bundle.windows.minimumWebview2Version` (string) makes the installer try to
trigger a WebView2 update when the installed runtime is older.
`bundle.windows.nsis.minimumWebview2Version` is the **deprecated** location for the same
setting — use the `windows` one.

### 6.2 No runtime installed — what actually happens

- With any bootstrapper/offline/fixed mode: the installer installs or repairs the runtime,
  so this case does not arise.
- With `skip`: the app launches and the webview fails to create. Tauri's own wording is
  "WILL NOT work". No friendly error, no prompt.
- Tauri docs claim: *"On Windows 10 (April 2018 release or later) and Windows 11, the
  WebView2 runtime is distributed as part of the operating system."*
  (`windows-installer.mdx:325-330`). Microsoft's own position is narrower — the Evergreen
  Runtime ships **in** Windows 11 and reaches Windows 10 through Edge/Windows Update — so
  LTSC, N-editions, freshly imaged or update-blocked machines can legitimately lack it.
  **Exact coverage matrix UNVERIFIED**; treat "always present on Win10" as optimistic.

### 6.3 `bundle.windows.nsis.installMode`

| Mode | Admin needed | Install dir | Registry hive |
|---|---|---|---|
| `currentUser` (**default**) | no | `%LOCALAPPDATA%\<productName>` | `HKCU` |
| `perMachine` | yes | `C:\Program Files\<productName>` | `HKLM` |
| `both` | **yes, always** — even if the user then picks current-user | user's choice | `HKCU` or `HKLM` |

Interlock with the updater (§2): `installMode: "quiet"` on the updater side **cannot
self-elevate**, so a `perMachine`/`both` install combined with `quiet` updates fails
silently. `passive` (the updater default) is the only mode that is safe across all three.

Other NSIS keys worth knowing while you are in there:
`installerHooks` (a `.nsh` exposing `NSIS_HOOK_PREINSTALL` / `POSTINSTALL` /
`PREUNINSTALL` / `POSTUNINSTALL` — this is the hook that can silently uninstall a
pre-rename install, see §2.6), `template` (custom `.nsi`), `compression`
(default `lzma`), `startMenuFolder`, `languages`, `displayLanguageSelector`,
`installerIcon`, `headerImage`, `sidebarImage`.
Also `bundle.windows.allowDowngrades` (default `true`) — set it `false` to stop users
sidegrading to an older build.

### Recommendation for SL-ADE (§6)

1. **Keep `downloadBootstrapper` (the default).** SL-ADE is a developer tool downloaded
   from GitHub; a machine that can fetch a 24 MB installer can fetch the bootstrapper.
   `offlineInstaller` would take the NSIS artifact from ~24 MB to ~150 MB, which
   contradicts the entire reason Electron is being dropped.
2. **Keep `installMode: "currentUser"` (the default, and what the reference app uses —
   `tauri.conf.json` `nsis.installMode`).** No UAC prompt means SmartScreen is the only
   friction point on first run (§3), and per-user install is what an unsigned 0.x binary
   should be doing anyway. It also keeps `quiet`/`passive` updater modes safe.
3. Set `bundle.windows.minimumWebview2Version` to a known-good runtime once you have
   tested one; it is the cheapest defense against ancient WebView2 builds that break
   `IsNonClientRegionSupportEnabled` (§1) or `ICoreWebView2Settings3` (§5.3).
4. Consider `allowDowngrades: false` only after 1.0 — during prerelease you may
   deliberately want to hand someone an older build.
5. Do not use `skip`. Do not use `fixedRuntime` — it makes SL-ADE responsible for
   shipping WebView2 security patches, which a solo maintainer will not do.

Effort: **0.25 d** (config only, plus one clean-VM install test to confirm the
bootstrapper path actually runs).

## 7. Multi-window / tab tear-off

### 7.1 Two creation paths, and why the choice is forced for SLTerm

| Path | API | Can carry an init script? |
|---|---|---|
| Frontend | `new WebviewWindow(label, opts)` from `@tauri-apps/api/webviewWindow`; needs `core:webview:allow-create-webview-window` | **No** — `WebviewOptions` in `packages/api/src/webview.ts` has `dragDropEnabled` (:742), `zoomHotkeysEnabled` (:780), `useHttpsScheme` (:795) … and no `initializationScript`. By design: JS must not be able to inject privileged startup code. |
| Rust | `WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))` + `.initialization_script(...)` (`crates/tauri/src/webview/webview_window.rs:1008`) | Yes |

This matters because SLTerm's window is only usable *with* its init script — that script
carries the wavesrv endpoints and the auth key
(`/home/stackops/saly/SLTerm/src-tauri/src/lib.rs:195-208`, `:236-258`). A JS-created
window would boot into a page with no backend handle.

The DRY way out is a third option: register a one-purpose local plugin whose
`js_init_script` is the handshake —
`tauri::plugin::Builder::js_init_script()` (`crates/tauri/src/plugin.rs:371`) injects into
**every** webview the app creates, including JS-created ones. Then tear-off can stay in
the frontend where the policy belongs, and the Rust shell keeps zero logic.

Security note: `js_init_script` is main-frame-only (`for_main_frame_only: true`,
`plugin.rs:374`); the sibling `js_init_script_on_all_frames` (:400) is **not** what you
want — SLTerm's `webview` view loads arbitrary remote pages, and all-frames injection
would hand the wavesrv auth key to every iframe on those pages.

### 7.2 Labels

- Must be unique per window. Reference uses `detached-${crypto.randomUUID()}`
  (`/home/stackops/saly/claude-terminal/src/lib/tabTransfer.ts:34`).
- **Capabilities match on label.** `"windows": ["main"]` (SLTerm today) silently denies
  every IPC call from a torn-off window. Needs the glob — reference:
  `["main", "detached-*", "drag-preview"]` (`src-tauri/capabilities/default.json`).
- `tauri-plugin-window-state` keys saved geometry by label, and UUID labels are never
  reused → the state file accumulates dead entries forever. Either use stable labels
  (`detached-1..n`) or exclude detached windows from the plugin.

### 7.3 Creation is async, and the units differ

```ts
// tabTransfer.ts:37-57
const win = new WebviewWindow(label, {
  url: `index.html?mode=detached&ids=${idsParam}`,
  width: 1000, height: 680, minWidth: 480, minHeight: 320,
  decorations: false, transparent: true, title: 'ClaudeTerminal',
});
win.once('tauri://created', () => {
  win.setPosition(new PhysicalPosition(Math.round(physX), Math.round(physY)))
     .then(() => win.setFocus());
});
win.once('tauri://error', (e) => { /* creation failed */ });
```
- The constructor does not throw on failure; `tauri://created` / `tauri://error` are the
  only signals (`:48`, `:58`).
- **`x`/`y`/`width`/`height` in the options are logical pixels; a cursor position is
  physical.** Passing physical cursor coords as options puts the window at 1.5× the
  intended offset on a 150 % display. The reference explains and works around this by
  setting `PhysicalPosition` after creation (`:49-52`).
- `parent()` / `parent_raw()` (`webview_window.rs:689`, `:730`) sets a Win32 **owner**:
  per the config schema quoting MSDN, an owned window is always above its owner, is
  destroyed with it, and **hides when the owner is minimized**. That is wrong for
  tear-off — do not set a parent.

### 7.4 Cross-window IPC

- JS `emit()` **broadcasts to every window**; every listener must filter
  (`tabTransfer.ts:191`: `if (targetLabel !== myLabel || sourceLabel === myLabel) return`).
  `emitTo(label, …)` targets one. Rust: `app.emit()` vs `app.emit_to(label, …)`.
- The reference's two-event protocol is a sound template:
  `ct://tab-transfer` → target adopts, then broadcasts `ct://tab-transfer-done` → source
  releases. It is deliberately idempotent, because the broadcast reaches non-owners whose
  `detach` is a no-op (`tabTransfer.ts:172-229`).
- Drop routing is done by hit-testing the physical cursor against every window's
  `outerPosition()`/`outerSize()`, skipping the source and the drag-preview window
  (`tabTransfer.ts:113-160`) — outside all windows means "tear off here".

### 7.5 Lifecycle traps (all present in the reference)

- `on_window_event` fires for **every** window. Without a label guard, closing a torn-off
  window runs the app-shutdown path: `if window.label() != "main" { return; }`
  (`/home/stackops/saly/claude-terminal/src-tauri/src/main.rs:250-257`).
- `app_handle().exit(0)` force-closes children **without** firing their JS close handlers
  (`main.rs:289-295`). Per-window persistence must therefore happen continuously or in the
  main window's close path — never in a detached window's `beforeunload`.
- For SL-ADE specifically: the same shutdown path must also stop `wavesrv`. See the open
  question in §2.5 about `RunEvent::Exit` during an updater-driven kill.

### 7.6 HTML5 drag-and-drop conflicts with Tauri file drop

Config schema, `WindowConfig.dragDropEnabled` (default `true`): *"Disabling it is required
to use HTML5 drag and drop on the frontend on Windows."* So an HTML5-DnD tab strip forces
`dragDropEnabled: false`, which kills Tauri's file-drop events — and SLTerm's
`preview`/files view wants file drop. The reference app sidesteps this by driving the drag
with pointer events plus a separate always-on-top `drag-preview` window
(`src/App.tsx:291`, `src/hooks/useTabDrag.tsx:169`), keeping `dragDropEnabled` at its
default.

### Recommendation for SL-ADE (§7)

1. **Tear-off is architecturally cheaper for SL-ADE than it was for claude-terminal.**
   claude-terminal had to invent a transfer protocol because terminal view state lived in
   per-window Zustand while PTYs lived in Rust. SLTerm's blocks/tabs already live in the
   Go backend and the frontend is a client of the wavesrv WS endpoint — so a torn-off
   window is just a second client pointed at a different tab id via the URL. Do **not**
   port `tabTransfer.ts` wholesale; port only the drop-routing and the label conventions.
2. **Wrap the handshake in a local plugin with `js_init_script`** (main-frame-only) before
   building any second window. This is the single change that makes multi-window possible
   at all, and it also de-duplicates the existing navigation re-injection in
   `lib.rs:195-208`.
3. Create windows from the **frontend** (`new WebviewWindow`), not from Rust — once the
   plugin supplies the init script there is no reason for the shell to know about tabs.
   Add `core:webview:allow-create-webview-window` and widen `windows` to
   `["main", "detached-*"]`.
4. Keep pointer-event dragging; keep `dragDropEnabled` default so file drop survives.
5. Guard `on_window_event` by label from the first commit that can create a second window.
6. Defer `window-state` until label strategy is settled (§4 already sequences it after
   tear-off).

Effort: **2-3 d** (0.5 plugin/init-script, 0.5 permissions + label plumbing, 1-2
drag/drop routing + lifecycle guards). Excludes any Go-side work to let two clients share
one workspace, which is **UNVERIFIED** — no check was made on whether wavesrv tolerates
two simultaneous frontend clients on the same tab.

## 8. Effort summary + recommended sequencing

### 8.1 Effort roll-up

| # | Work item | Effort | Blocks | Blocked by |
|---|---|---|---|---|
| 4a | `single-instance` plugin (registered first) | 0.5 d | — | — |
| 4b | Window-action permissions + `create-webview-window` + label glob | 0.25 d | 1, 7 | — |
| 5a | Config-level key hygiene (`zoom_hotkeys_enabled(false)`, `devtools:false`) | 0.25 d | — | — |
| 5b | Port JS key-swallow + context-menu/`beforeunload` guards | 0.25 d | — | — |
| 1a | React titlebar: `app-region: drag` + min/max/close + `shadow(true)`, drop `transparent` on Windows | 1-1.5 d | 1b | 4b |
| 1b | `min_inner_size` width 900 → 330 | ~0 | 1c | — |
| 6 | `webviewInstallMode`/`installMode` config + clean-VM install test | 0.25 d | 2 | — |
| 2 | Updater: plugin + minisign key + `latest.json` in CI + `wix.upgradeCode` pin | 1-1.5 d | 3 | 6 |
| 2b | Prove sidecar shutdown on updater-driven exit | 0.5 d | 2 | 2 |
| 7 | Multi-window: `js_init_script` plugin, tear-off, lifecycle guards | 2-3 d | 4d | 4b, 1a |
| 4c | `tray-icon` + `dialog` | 1 d | — | 4b |
| 5c | `AreBrowserAcceleratorKeysEnabled(false)` via `with_webview` COM | 0.5 d | — | needs a Windows build |
| 1c | Snap Layouts overlay (vendored child window) | 1.5-2.5 d | — | 1a, 1b |
| 4d | `window-state` | 0.5-1 d | — | 7 |
| 4e | `global-shortcut` (one hotkey) | 0.5 d | — | — |
| 4f | `notification` | 0.5 d | — | — |
| 3 | Code signing (SignPath application + CI) | 1-2 d + lead time | — | 2 |

Total **12-17 d** of shell work, excluding code-signing lead time and excluding all Go/React
feature work. Roughly half of it (1c, 4d, 4e, 4f, 3, 5c) is deferrable without blocking a
usable Windows build.

### 8.2 Sequencing, and why

**Wave 1 — make the Tauri build usable on Windows at all (≈2.5 d).**
4a, 4b, 5a, 5b, 1a, 1b. Today the window has no titlebar and no way to close itself
(§0), a second launch fights over the `~/.slterm/data` lock, and one `F5` destroys the
session. Nothing else matters until this is done, and it is all local, reversible config +
frontend work.

**Wave 2 — make it distributable (≈2 d).**
6, then 2, then 2b. Order is forced: `webviewInstallMode`/`installMode` decide what the
installer *is*, the updater ships that installer as its payload, and the sidecar-shutdown
question only becomes testable once an update can actually run. Pin
`bundle.windows.wix.upgradeCode` in the same commit that adds `msi` to targets — free now,
impossible to retrofit later (§2.6).

**Wave 3 — the SL-ADE rebrand window.**
Per §2.6: rename the **identifier** whenever you like (safe; SLTerm's hardcoded
`~/.slterm` data dir means no user data moves), but treat the **`productName`** rename as a
one-time migration release, and land it **before** the updater has a real installed base —
which is now, while the only shipped artifact is a prerelease that nobody auto-updates
from. Delaying this is the single most expensive decision available in this report.

**Wave 4 — parity and polish (the rest).**
7 before 4d. 3 after 2. 1c last: it is the only item that can silently half-work
(§1.2 trap 1), it forces titlebar geometry to be frozen, and it is the only item that
genuinely requires a physical Win11 machine.

### 8.3 Cross-cutting rule this research surfaced

Five separate items (Snap Layouts, `app-region: drag`, `ICoreWebView2Settings3`,
`ICoreWebView2Settings9`, `PrintWindow`-based screenshot verification) **cannot be
validated under Xvfb on Linux**, which is the only environment SLTerm's Tauri build has
ever run in (§0). A real Windows 11 machine or VM is a hard prerequisite for Wave 1
onward, not a nice-to-have. Budget it explicitly.

## 9. Limitations of this research

- **No Windows execution.** Every Windows claim here is from source, config schema, or
  official docs — none was observed running. Items marked UNVERIFIED are the ones where
  that gap actually matters.
- **Snap Layouts evidence is thin at the repo level.** The technique is corroborated by
  four independent plugins converging on the same child-window trick, but the write-up
  used for the concrete numbers (`Zbrooklyn/tauri-snap-layouts`, 3 stars, created
  2026-07-29) is low-adoption. Treat the technique as credible, the repo as disposable.
- **macOS is out of scope** by the Windows-first brief: §3.3 is a sketch and the
  notarization env vars/flags were not researched.
- **Pricing for Azure Artifact Signing** came from a secondary source (melatonin.dev)
  because Microsoft's pricing page renders placeholders without a region selected. Verify
  before budgeting.
- **No Go-side analysis.** Whether wavesrv tolerates two frontend clients (§7), and
  whether `RunEvent::Exit` runs on an updater-driven kill (§2.5), both need code or
  runtime checks that were not performed.
- **Plugin abandonment risk was assessed on download counts and last-push dates only** —
  no audit of issue-response latency or maintainer bus factor beyond the
  self-declared "maintainance mode" note on `tauri-plugin-decorum`.
- Tauri version referenced throughout is **2.11.5** (`crates/tauri/Cargo.toml:3`); API
  names were read from `dev`, so a 2.12 release could add the missing
  `browser_accelerator_keys` passthrough and obsolete §5.3.

## 10. Unresolved questions

1. **Is the owner eligible for Azure Artifact Signing?** Individual Public Trust certs are
   US/Canada only; the organization list does not include Vietnam. If ineligible, §3
   collapses to SignPath Foundation or unsigned — and SignPath means the publisher string
   reads "SignPath Foundation", not "Salyvn". Owner decision, not a research question.
2. **Does `RunEvent::Exit` fire when the updater force-quits the app on Windows?** If not,
   `wavesrv` survives, holds the `~/.slterm/data` lock, and the post-update launch fails.
   Needs a real update run (§2.5).
3. **Does wavesrv tolerate two simultaneous frontend clients** on the same workspace/tab?
   Gates the entire §7 tear-off design; if not, tear-off needs a Go-side change that is
   outside this report's scope.
4. **Maximized frameless overhang**: does a `decorations: false` window on Win11 cover the
   taskbar or clip its edges when maximized (`WM_NCCALCSIZE`)? Not documented as a current
   Tauri bug; must be tested on the first Windows build (§1.3).
5. **Does combining `app-region: drag` with `data-tauri-drag-region`** double-handle
   double-click-to-maximize? Determines whether the titlebar needs platform-conditional
   markup or can carry both attributes unconditionally (§1.5a).
6. **Can the 1px white border** that `shadow: true` draws on an undecorated Win11 window be
   recolored or suppressed while keeping rounded corners? Affects whether the dark theme
   looks right (§1.5b).
7. **`productName` rename timing**: accept two Add/Remove entries for existing installs, or
   write an `NSIS_HOOK_PREINSTALL` that silently runs the old `UninstallString`? Cheap now
   (≈0 installed base), expensive later (§2.6, §8.2 Wave 3).
8. **Which single chord deserves a global (OS-wide) shortcut**, if any? `global-shortcut`
   steals the chord from every other application; the default answer should probably be
   "none until a user asks".
