// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Stages the built frontend for the Tauri bundler.
 *
 * electron-builder had a `files` filter that dropped source maps, TypeScript
 * declarations and test files from the package. Tauri's bundler has no
 * equivalent — it copies `frontendDist` verbatim — so without this step the
 * bundle carries 65 MB of .map files that only exist for debugging, which
 * defeats the point of moving off Electron for size.
 *
 * Copies dist/frontend to dist/frontend-tauri minus the excluded patterns.
 */

import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const SRC = "dist/frontend";
const DEST = "dist/frontend-tauri";

/** Patterns that add bytes without adding behavior at runtime. */
const EXCLUDE = [/\.map$/, /\.d\.ts$/, /\.test\./, /\.spec\./];

if (!existsSync(SRC)) {
    console.error(`stage-tauri-frontend: ${SRC} does not exist — run "npm run build:prod" first`);
    process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
cpSync(SRC, DEST, {
    recursive: true,
    filter: (src) => {
        // Directories always pass; the filter re-runs for their contents.
        try {
            if (statSync(src).isDirectory()) return true;
        } catch {
            return false;
        }
        return !EXCLUDE.some((re) => re.test(src));
    },
});

async function dirSize(dir) {
    let total = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        total += entry.isDirectory() ? await dirSize(p) : statSync(p).size;
    }
    return total;
}

const [before, after] = [await dirSize(SRC), await dirSize(DEST)];
const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
console.log(`stage-tauri-frontend: ${mb(before)} -> ${mb(after)} (dropped ${mb(before - after)})`);
