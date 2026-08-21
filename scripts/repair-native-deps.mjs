// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reinstalls platform-specific native binaries that `npm ci` skipped.
 *
 * npm intermittently omits a platform's optional dependencies even when they are
 * present in the lockfile (npm/cli#4828). The build then dies at config load time
 * with "Cannot find module" or "Failed to load native binding". It has bitten
 * this repo on Linux locally and on the macOS release runner.
 *
 * The package list is derived from the lockfile rather than hardcoded, so it
 * stays correct as dependencies change and works on every platform without a
 * per-host table to maintain. Versions also come from the lockfile, so this can
 * never install something `npm ci` would not have.
 *
 * Safe to run unconditionally: it exits quietly when everything is present.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const host = { os: process.platform, cpu: process.arch };

// Distinguish glibc from musl so we don't try to install a musl binary on a
// glibc host (or vice versa) when a package publishes both.
const isMusl = (() => {
    try {
        return !process.report.getReport().header.glibcVersionRuntime;
    } catch {
        return false;
    }
})();

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

/** @type {{name: string, version: string, path: string}[]} */
const candidates = [];
for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry.optional || !entry.version) continue;
    if (!Array.isArray(entry.os) || !entry.os.includes(host.os)) continue;
    if (!Array.isArray(entry.cpu) || !entry.cpu.includes(host.cpu)) continue;

    // On Linux the same dependency often ships both a gnu and a musl build; the
    // lockfile's os/cpu fields cannot tell them apart, so filter by name.
    if (host.os === "linux") {
        const musl = lockPath.includes("musl");
        if (musl !== isMusl) continue;
    }

    const name = lockPath.replace(/^node_modules\//, "").replace(/.*\/node_modules\//, "");
    candidates.push({ name, version: entry.version, path: lockPath });
}

if (candidates.length === 0) {
    console.log(`repair-native-deps: lockfile lists no optional natives for ${host.os}-${host.cpu}`);
    process.exit(0);
}

const rootCandidates = candidates.filter((c) => !c.path.includes("/node_modules/"));
const nested = candidates.filter(
    (c) => c.path.includes("/node_modules/") && !existsSync(c.path) && !existsSync(`node_modules/${c.name}`)
);

if (nested.length > 0) {
    // A nested entry (a/node_modules/b) cannot be repaired by a root install —
    // npm would place it at the top level, where the dependent will not find it.
    // Report it instead of silently installing something that does not help.
    console.log(`repair-native-deps: skipping ${nested.length} nested entr(ies), not root-installable:`);
    for (const c of nested) console.log(`  ${c.path}`);
}

const missing = rootCandidates.filter((c) => !existsSync(c.path));

if (missing.length === 0) {
    console.log(
        `repair-native-deps: all ${rootCandidates.length} optional native package(s) present for ${host.os}-${host.cpu}`
    );
    process.exit(0);
}

console.log(`repair-native-deps: npm skipped ${missing.length} package(s) on ${host.os}-${host.cpu}:`);
for (const c of missing) console.log(`  ${c.name}@${c.version}`);

// Install the COMPLETE set, not just the missing ones. `npm install --no-save`
// treats previously --no-save-installed optional packages as extraneous and
// prunes them, so repairing in batches never converges — each batch removes the
// last one's work. Naming them all in one invocation gives npm no reason to drop
// any of them.
const spec = rootCandidates.map((c) => `${c.name}@${c.version}`).join(" ");
console.log(`repair-native-deps: installing all ${rootCandidates.length} together so none get pruned`);
execSync(`npm install --no-save --no-audit --no-fund ${spec}`, { stdio: "inherit" });

const stillMissing = rootCandidates.filter((c) => !existsSync(c.path));
if (stillMissing.length > 0) {
    console.error("repair-native-deps: still missing after install:");
    for (const c of stillMissing) console.error(`  ${c.name}@${c.version}`);
    process.exit(1);
}
console.log(`repair-native-deps: all ${rootCandidates.length} required native package(s) present`);

