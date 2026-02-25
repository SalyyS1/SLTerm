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
                "!tsunamiscaffold/**/*",
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
    extraResources: [
        {
            from: "dist/tsunamiscaffold",
            to: "tsunamiscaffold",
        },
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
    publish: {
        provider: "generic",
        url: "https://github.com/SalyyS1/SLTerm/releases",
    },
};

module.exports = config;
