<p align="center">
  <a href="https://github.com/SalyyS1/SLTerm">
    <img alt="SLTerm Logo" src="./assets/appicon-windows.png" width="120">
  </a>
</p>

<h1 align="center">SLTerm</h1>

<p align="center">
  <strong>Open-Source Modern Terminal by Salyvn</strong>
</p>

<p align="center">
  <a href="https://github.com/SalyyS1/SLTerm/releases"><img src="https://img.shields.io/github/v/release/SalyyS1/SLTerm?style=flat-square&color=00E5CC" alt="Release"></a>
  <a href="https://github.com/SalyyS1/SLTerm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SalyyS1/SLTerm?style=flat-square" alt="License"></a>
  <a href="https://github.com/SalyyS1/SLTerm/releases"><img src="https://img.shields.io/github/downloads/SalyyS1/SLTerm/total?style=flat-square&color=58C142" alt="Downloads"></a>
</p>

---

SLTerm is a modern, feature-rich terminal built on Electron. It combines the power of a traditional terminal with a graphical workspace — file previews, web browsing, and rich customization — all in one window.

## Windows ADE development preview

The `feat/ade-zig-core` branch also includes an isolated **Tauri + Zig + ConPTY**
workspace preview. It supports tiled/free terminal panes, session actions, custom
shortcuts, themes, local backgrounds/fonts, Zig-owned SQLite preferences,
an on-demand Windows process resource panel, a local Monaco editor/diff and
explicit background operation through the Windows tray.
See the [preview build and test guide](docs/terminal-preview.md).

This source-only, unsigned preview is not the completed ADE or a replacement for
the Electron release. AI chat, SSH/SFTP, legacy-profile import and durable
background sessions are not connected to this entrypoint. The numerical
performance gate was explicitly deferred for implementation; comparable
measurements, compatibility checks and approved budgets remain release work.

## ✨ Features

- **Drag & Drop Workspace** — Organize terminal blocks, editors, and web browsers in a flexible tiled layout
- **Built-in Editor** — Edit local and remote files with syntax highlighting
- **Rich File Previews** — Markdown, images, video, PDFs, CSVs, directories
- **One-Click SSH Connections** — Full terminal and file system access to remote servers
- **🌐 i18n Support** — English & Vietnamese, with easy extension to more languages
- **🎨 Theming** — 18 built-in themes, custom backgrounds, transparency, and blur effects
- **Command Blocks** — Isolate and monitor individual commands
- **`wsh` CLI** — Powerful command system for managing your workspace from the terminal
- **Cross-platform installers** — NSIS for Windows, `.dmg` for macOS, AppImage and `.deb` for Linux

## 📥 Installation

Download from [**Releases**](https://github.com/SalyyS1/SLTerm/releases).

### Windows

| File                     | Description                  |
| ------------------------ | ---------------------------- |
| `SLTerm-win32-x64-*.exe` | NSIS Installer (recommended) |
| `SLTerm-win32-x64-*.zip` | Portable ZIP                 |

### macOS

| File                         | Description                 |
| ---------------------------- | --------------------------- |
| `SLTerm-darwin-arm64-*.zip`  | Apple Silicon (recommended) |
| `SLTerm-darwin-x64-*.zip`    | Intel                       |

Unzip and move `SLTerm.app` to `/Applications`. Builds are currently unsigned, so
the first launch needs right-click → **Open** (or
`xattr -dr com.apple.quarantine /Applications/SLTerm.app`) to get past Gatekeeper.
A `.dmg` will return once the project has a signing certificate.

### Linux

| File                          | Description             |
| ----------------------------- | ----------------------- |
| `SLTerm-linux-x86_64-*.AppImage` | Portable (recommended) |
| `SLTerm-linux-amd64-*.deb`       | Debian / Ubuntu        |

### Minimum Requirements

- Windows 10 1809 or later (x64)
- macOS 11 or later (arm64, x64)
- Linux glibc-2.28+ (Debian 10, Ubuntu 20.04, RHEL 8)

## 🛠️ Building from Source

```bash
# Clone
git clone https://github.com/SalyyS1/SLTerm.git
cd SLTerm

# Install dependencies
npm install

# Development
npm run dev

# Production build
npm run build:prod

# Build installer (Windows)
npx electron-builder --win --x64 --config electron-builder.config.cjs
```

Build commands are defined in [package.json](package.json).

## 🌐 Internationalization (i18n)

SLTerm supports multiple languages:

| Language   | Status      |
| ---------- | ----------- |
| English    | ✅ Complete |
| Tiếng Việt | ✅ Complete |

Switch languages instantly in **Settings → Language** — no restart required.

To add a new language, create a JSON file in `frontend/i18n/locales/` following the structure of `en.json`.

## 📁 Project Structure

```
SLTerm/
├── emain/          # Electron main process
├── frontend/       # React frontend
│   ├── app/        # Main application components
│   ├── i18n/       # Internationalization (locales)
│   └── logos/      # App logos
├── pkg/            # Go backend packages
├── cmd/            # Go entry points (wavesrv, wsh)
├── assets/         # Branding assets
└── build/          # Build resources (icons)
```

## 📝 License

SLTerm is licensed under the [Apache-2.0 License](LICENSE).

**Based on [Wave Terminal](https://github.com/wavetermdev/waveterm)** — forked and customized by [Salyvn](https://github.com/SalyyS1).

## 🙏 Acknowledgements

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for the full list of dependencies and credits.
