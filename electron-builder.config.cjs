const { Arch } = require("electron-builder");
const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");

const windowsShouldSign = !!process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
    appId: pkg.build.appId,
    productName: pkg.productName,
    executableName: pkg.productName,
    // `${platform}` resolves to the BUILD HOST's platform, so cross-building a
    // Windows installer from Linux produced "SLTerm-linux-x64-*.exe" — and that
    // wrong name propagated into latest.yml, which the auto-updater reads.
    // Target names are pinned per-platform below instead; this stays as the
    // fallback for any target without its own artifactName.
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    generateUpdatesFilesForAllChannels: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    asar: true, // compress app files for smaller distribution
    files: [
        {
            from: "./dist",
            to: "./dist",
            filter: [
                "**/*",
                "!bin/*",
                "bin/wavesrv.${arch}*",
                "bin/wsh*",
                "!**/*.map",  // exclude source maps from production
                "!**/*.d.ts", // exclude TypeScript declarations
                "!**/test/**",
                "!**/*.test.*",
                "!**/*.spec.*",
            ],
        },
        {
            from: ".",
            to: ".",
            filter: ["package.json"],
        },
        "!node_modules", // We don't need electron-builder to package in Node modules as Vite has already bundled any code that our program is using.
    ],
    directories: {
        output: "release",
    },
    asarUnpack: [
        "dist/bin/**/*", // wavesrv and wsh binaries
        "dist/schema/**/*", // schema files for Monaco editor
    ],
    win: {
        icon: "build/icon.ico",
        // Pinned rather than derived, so the name is correct whether the build
        // runs on Windows or cross-builds from Linux. Matches the download
        // filenames documented in README.md.
        artifactName: "${productName}-win32-${arch}-${version}.${ext}",
        target: ["nsis", "zip"],
        signtoolOptions: windowsShouldSign && {
            signingHashAlgorithms: ["sha256"],
            publisherName: "Salyvn",
            certificateSubjectName: "Salyvn",
            certificateSha1: process.env.SM_CODE_SIGNING_CERT_SHA1_HASH,
        },
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        installerIcon: "build/icon.ico",
        uninstallerIcon: "build/icon.ico",
        installerHeaderIcon: "build/icon.ico",
        shortcutName: "SLTerm",
        menuCategory: false,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
    },
    mac: {
        icon: "build/icon.icns",
        artifactName: "${productName}-darwin-${arch}-${version}.${ext}",
        category: "public.app-category.developer-tools",
        // zip only, deliberately. `dmg` pulls in dmg-license →
        // iconv-corefoundation → node-addon-api, a chain npm keeps failing to
        // install on the runner, and an unsigned .dmg buys nothing over a
        // zipped .app: either way the user has to clear Gatekeeper by hand.
        // Revisit once there is a signing certificate, which is when a dmg
        // starts being worth its build cost.
        target: ["zip"],
        // Separate per-arch artifacts rather than a universal binary: wavesrv is
        // a CGO build per architecture, so a universal app would have to lipo
        // two Go binaries together for no benefit over two downloads.
        minimumSystemVersion: "11.0",
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: "build/entitlements.mac.plist",
        entitlementsInherit: "build/entitlements.mac.plist",
        // Unsigned builds are usable via right-click → Open. Signing turns on
        // automatically when CSC_LINK / CSC_KEY_PASSWORD are present.
        identity: process.env.CSC_LINK ? undefined : null,
    },
    linux: {
        icon: "build/icons",
        artifactName: "${productName}-linux-${arch}-${version}.${ext}",
        category: "Development;TerminalEmulator",
        synopsis: pkg.description,
        desktop: {
            entry: {
                Name: pkg.productName,
                Comment: pkg.description,
                Categories: "Development;TerminalEmulator",
                Terminal: "false",
            },
        },
        target: ["AppImage", "deb"],
    },
    deb: {
        afterInstall: "build/deb-postinstall.tpl",
    },
    publish: {
        provider: "generic",
        url: "https://github.com/SalyyS1/SLTerm/releases",
    },
};

module.exports = config;
