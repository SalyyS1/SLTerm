import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pins = JSON.parse(await readFile(new URL("./protocol-pins.json", import.meta.url), "utf8"));
const project = fileURLToPath(new URL("../../", import.meta.url));
const results = join(project, "proof-results", "provider-proof");
await mkdir(results, { recursive: true });
const scratch = await mkdtemp(join(results, "codex-schema-check-"));
const env = {};
for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
    if (process.env[key]) env[key] = process.env[key];
}
// Fresh file-backed home; never inherit auth variables or the normal Codex profile.
Object.assign(env, { CODEX_HOME: join(scratch, "home"), HOME: scratch, USERPROFILE: scratch,
    APPDATA: scratch, LOCALAPPDATA: scratch, TEMP: scratch, TMP: scratch });
await mkdir(env.CODEX_HOME);
const executable = process.argv[2] ?? "codex";
const invoke = (args) => execFileSync(executable, args, { cwd: scratch, env, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true }).trim();
const version = invoke(["--version"]);
if (version !== pins.codex.version) throw new Error("UNSUPPORTED_CODEX_VERSION");
const generated = join(scratch, "schema");
invoke(["app-server", "generate-json-schema", "--out", generated]);
for (const schema of Object.values(pins.codex.schemas)) {
    const actual = createHash("sha256").update(await readFile(join(generated, schema.source))).digest("hex");
    if (actual !== schema.sha256) throw new Error(`SCHEMA_HASH_MISMATCH: ${schema.source}`);
}
console.log(JSON.stringify({ category: "local-cli-schema", version, matchedSchemas: Object.keys(pins.codex.schemas).length,
    appServerStarted: false, providerRequests: 0, accountAccess: false, scratch }, null, 2));
