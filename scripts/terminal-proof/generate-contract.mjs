import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contract = JSON.parse(await readFile(resolve(root, "schema/ade-ipc.json"), "utf8"));
const fields = contract.$defs.request.properties;
const banner = "// Generated from schema/ade-ipc.json; edit the schema and run generate-contract.mjs.\n";
const defaultZig = (value) => value === null ? "null" : Array.isArray(value) ? "&.{}" : JSON.stringify(value);
const zig = banner + "pub const Request = struct {\n" + Object.entries(fields).map(([key, value]) =>
    `    ${key}: ${value.zig}${"default" in value ? ` = ${defaultZig(value.default)}` : ""},\n`).join("") + "};\n";
const tsType = (type) => Array.isArray(type) ? type.map(tsType).join(" | ") : ({string:"string",integer:"number",array:"string[]",null:"null"})[type];
const ts = banner + `export const PROTOCOL_VERSION = ${contract.protocolVersion} as const;\nexport const CORE_METHODS = ${JSON.stringify(contract.methods)} as const;\nexport type CoreMethod = typeof CORE_METHODS[number];\nexport type CoreRequest = {\n` +
    Object.entries(fields).map(([key, value]) => `    ${key}${contract.$defs.request.required.includes(key) ? "" : "?"}: ${key === "method" ? "CoreMethod" : key === "version" ? "typeof PROTOCOL_VERSION" : tsType(value.type)};\n`).join("") + "};\n";
const publicMethods = contract.methods.filter((method) => !contract.hostReservedMethods.includes(method));
const rust = banner + `pub const METHODS: &[&str] = &[\n${publicMethods.map((method) => `    ${JSON.stringify(method)},\n`).join("")}];\n`;
for (const [path, content] of [["native-core/src/core-contract.zig", zig], ["frontend/terminal-proof/core-contract.ts", ts], ["src-tauri/src/terminal_proof_contract.rs", rust]]) {
    if (process.argv.includes("--check")) {
        if (await readFile(resolve(root, path), "utf8") !== content) throw new Error(`Stale generated contract: ${path}`);
    } else await writeFile(resolve(root, path), content);
}
