import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pins = JSON.parse(await readFile(new URL("./protocol-pins.json", import.meta.url), "utf8"));
const project = fileURLToPath(new URL("../../", import.meta.url));
const results = join(project, "proof-results", "provider-proof");
await mkdir(results, { recursive: true });
const scratch = await mkdtemp(join(results, "sdk-typecheck-"));
let archive;
if (process.argv[2]) {
    archive = await readFile(process.argv[2]);
} else {
    // Public pinned package, no auth headers, SDK installation, imports, or execution.
    const response = await fetch(pins.claude.tarball, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error("SDK_PACKAGE_FETCH_FAILED");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) throw new Error("SDK_ARCHIVE_TOO_LARGE");
        chunks.push(chunk);
    }
    archive = Buffer.concat(chunks);
}
if (archive.length > 8 * 1024 * 1024) throw new Error("SDK_ARCHIVE_TOO_LARGE");
const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
if (integrity !== pins.claude.integrity) throw new Error("SDK_PACKAGE_INTEGRITY_MISMATCH");
const archivePath = join(scratch, "package.tgz");
await writeFile(archivePath, archive);
execFileSync("tar", ["-xzf", archivePath, "-C", scratch, "package/sdk.d.ts", "package/package.json"],
    { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
const sdkPackage = JSON.parse(await readFile(join(scratch, "package", "package.json"), "utf8"));
if (sdkPackage.version !== pins.claude.sdkVersion) throw new Error("UNSUPPORTED_CLAUDE_SDK_VERSION");
const configPath = join(scratch, "tsconfig.json");
const normalized = (path) => path.replaceAll("\\", "/");
await writeFile(configPath, JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true,
    allowImportingTsExtensions: true, skipLibCheck: true, types: ["node"],
    typeRoots: [normalized(join(project, "node_modules", "@types"))],
    paths: { "@anthropic-ai/claude-agent-sdk": [normalized(join(scratch, "package", "sdk.d.ts"))] },
}, include: [normalized(join(project, "scripts", "provider-proof", "*.ts"))] }, null, 2));
const compiler = require.resolve("typescript/bin/tsc");
let output;
try {
    output = execFileSync(process.execPath, [compiler, "--project", configPath],
        { timeout: 30_000, maxBuffer: 64 * 1024, encoding: "utf8", windowsHide: true });
} catch (error) {
    process.stderr.write(error.stdout || "SDK_TYPECHECK_FAILED\n");
    process.exit(1);
}
if (output.trim()) console.log(output.trim());
console.log(JSON.stringify({ category: "published-sdk-declaration-typecheck", sdkVersion: sdkPackage.version,
    bundledClaudeCodeVersion: sdkPackage.claudeCodeVersion, integrity, skipLibCheck: true,
    peerDependencyValidation: false, sdkRuntimeExecuted: false, accountAccess: false, scratch }, null, 2));
