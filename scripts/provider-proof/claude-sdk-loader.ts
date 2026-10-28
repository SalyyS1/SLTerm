import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { check } from "./proof-errors.ts";

export type ClaudeSdk = Pick<typeof import("@anthropic-ai/claude-agent-sdk"), "query">;
export const claudeSdkVersion = "0.3.312";

/** Called only when an explicitly configured run is first consumed. */
export async function loadPinnedClaudeSdk(): Promise<ClaudeSdk> {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@anthropic-ai/claude-agent-sdk");
    const manifest = JSON.parse(await readFile(join(dirname(entry), "package.json"), "utf8"));
    check(manifest.version === claudeSdkVersion, "UNSUPPORTED_CLAUDE_SDK_VERSION");
    return import("@anthropic-ai/claude-agent-sdk");
}
