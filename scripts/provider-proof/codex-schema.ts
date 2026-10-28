import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { check } from "./proof-errors.ts";

// Uses the already installed project dependency; no installation/network on test.
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const pins = JSON.parse(readFileSync(new URL("./protocol-pins.json", import.meta.url), "utf8"));
const validators = new Map<string, (value: unknown) => boolean>();

export const codexVersion: string = pins.codex.version;

export function validateCodex(name: string, value: unknown): void {
    let validate = validators.get(name);
    if (!validate) {
        const filename = pins.codex.schemas[name];
        check(filename, "UNPINNED_SCHEMA");
        const bytes = readFileSync(new URL(`./schema/${name}.json`, import.meta.url));
        check(createHash("sha256").update(bytes).digest("hex") === filename.sha256, "SCHEMA_HASH_MISMATCH");
        const ajv = new Ajv({ unknownFormats: "ignore", logger: false });
        validate = ajv.compile(JSON.parse(bytes.toString("utf8")));
        validators.set(name, validate!);
    }
    check(validate!(value), "PROVIDER_SCHEMA_MISMATCH");
}
