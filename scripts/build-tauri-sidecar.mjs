// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Builds the Go binaries the Tauri shell bundles: the wavesrv sidecar for the host
 * platform, and the wsh CLI for every platform a remote connection can land on.
 *
 * The Electron pipeline does this through the Taskfile. Tauri's bundler copies
 * `dist/bin` into the app's resources as-is, so this reproduces exactly what those
 * tasks produce — the same tags, the same `-s -w` strip, the same file names — in a
 * form that runs on a GitHub runner without installing Task first.
 *
 * The strip matters more here than under Electron: an unstripped wavesrv is 23 MB
 * against 15 MB stripped, and the whole point of this runtime is the bundle size.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VERSION = require("../version.cjs");
const BIN_DIR = "dist/bin";
const SCHEMA_SRC = "schema";
const SCHEMA_DIR = "dist/schema";

/** `YYYYMMDDHHmm`, matching what the Taskfile stamps into BuildTime. */
function buildTime() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Go's name for the host arch, and the name the app uses for its binaries. */
function hostArch() {
    const arch = process.arch === "x64" ? "amd64" : process.arch;
    return { goarch: arch, tag: arch === "amd64" ? "x64" : arch };
}

function goos() {
    return { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform] ?? process.platform;
}

function run(env, args) {
    execFileSync("go", args, { stdio: "inherit", env: { ...process.env, ...env } });
}

/**
 * Builds wavesrv for the host. CGO is on for sqlite, which is why this is a native
 * build per platform rather than a cross-compile — except Windows, which uses zig
 * as the C compiler the way the Electron pipeline already does.
 */
function buildServer(stamp) {
    const os = goos();
    const { goarch, tag } = hostArch();
    const ext = os === "windows" ? ".exe" : "";
    const env = { CGO_ENABLED: "1", GOARCH: goarch };
    if (os === "windows") {
        env.CC = goarch === "amd64" ? "zig cc -target x86_64-windows-gnu" : "zig cc -target aarch64-windows-gnu";
    } else if (os === "darwin") {
        env.CGO_CFLAGS = "-mmacosx-version-min=11.0";
        env.CGO_LDFLAGS = "-mmacosx-version-min=11.0";
    }
    const out = join(BIN_DIR, `wavesrv.${tag}${ext}`);
    console.log(`build-tauri-sidecar: wavesrv -> ${out}`);
    run(env, [
        "build",
        "-tags",
        "osusergo,sqlite_omit_load_extension",
        "-ldflags",
        `-s -w -X main.BuildTime=${stamp} -X main.WaveVersion=${VERSION}`,
        "-o",
        out,
        "cmd/server/main-server.go",
    ]);
}

/**
 * Builds wsh for the host and for the remotes worth carrying a copy for.
 *
 * The backend pushes a matching wsh onto any machine you SSH into, from the copies
 * it finds in bin/. Electron ships one per supported platform — six binaries, 63 MB
 * raw, 18 MB compressed — which is most of what made its installer 97 MB. The
 * machines people actually SSH into are Linux servers, so this ships the host's
 * own wsh plus both Linux architectures and stops there. Connecting to a Windows
 * or macOS *remote* still works; only the automatic wsh install on it does not,
 * and the backend reports that plainly ("cannot open local file …").
 *
 * These are pure Go, so they cross-compile from any host.
 */
function buildWsh(stamp) {
    const host = [goos(), hostArch().goarch];
    const targets = [host, ["linux", "amd64"], ["linux", "arm64"]].filter(
        ([os, arch], i, all) => all.findIndex(([o, a]) => o === os && a === arch) === i
    );
    for (const [os, arch] of targets) {
        const tag = arch === "amd64" ? "x64" : arch;
        const ext = os === "windows" ? ".exe" : "";
        const out = join(BIN_DIR, `wsh-${VERSION}-${os}.${tag}${ext}`);
        console.log(`build-tauri-sidecar: wsh -> ${out}`);
        run({ CGO_ENABLED: "0", GOOS: os, GOARCH: arch }, [
            "build",
            "-ldflags",
            `-s -w -X main.BuildTime=${stamp} -X main.WaveVersion=${VERSION}`,
            "-o",
            out,
            "cmd/wsh/main-wsh.go",
        ]);
    }
}

/**
 * Generates the JSON schemas for the config files and stages them where the
 * bundler's resource glob expects them.
 *
 * The schemas are derived from the Go config structs, so they are build output,
 * not source — `dist/schema` is not in git, and a fresh checkout does not have it.
 * The Taskfile's build:schema does this for Electron; the Tauri bundle declares
 * `../dist/schema/*` as a resource and refuses to build without it.
 */
function buildSchema() {
    console.log(`build-tauri-sidecar: schema -> ${SCHEMA_DIR}`);
    run({}, ["run", "cmd/generateschema/main-generateschema.go"]);
    rmSync(SCHEMA_DIR, { recursive: true, force: true });
    cpSync(SCHEMA_SRC, SCHEMA_DIR, { recursive: true });
}

// A stale binary from a previous version would ship alongside the new one and the
// backend picks by exact version, so clear the directory first.
mkdirSync(BIN_DIR, { recursive: true });
for (const name of readdirSync(BIN_DIR)) {
    if (name.startsWith("wavesrv") || name.startsWith("wsh-")) {
        rmSync(join(BIN_DIR, name), { force: true });
    }
}

const stamp = buildTime();
buildSchema();
buildServer(stamp);
buildWsh(stamp);
console.log(`build-tauri-sidecar: done (version ${VERSION}, build ${stamp})`);
