import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiCommand, type AiProvider } from "./ai-cli";

const powershell = join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const hostilePrompt = '--dangerously-skip-permissions "quoted"; & echo SHOULD_NOT_RUN\n$(Write-Output injected) `backtick` %PATH% !PATH!\r\nTiếng Việt 😀 \\\"end\\\\';
const scriptOf = (command: ReturnType<typeof aiCommand>) => Buffer.from(command.args.at(-1)!, "base64").toString("utf16le");
const requestOf = (command: ReturnType<typeof aiCommand>) => {
    const encoded = scriptOf(command).match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)![1];
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
};

describe("AI CLI launch contract", () => {
    it("keeps provider metadata and manual interactive invocation without a prompt", () => {
        for (const provider of ["claude", "codex"] as const) {
            const command = aiCommand(provider, powershell);
            expect(command).toMatchObject({ provider, label: provider === "claude" ? "Claude CLI" : "Codex CLI", executable: powershell });
            expect(command.args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-EncodedCommand"]);
            expect(requestOf(command)).toEqual({ provider });
            expect(command.args).not.toContain("-NoExit");
        }
    });

    it("carries hostile syntax, Unicode and newlines only as JSON data", () => {
        const command = aiCommand("claude", powershell, hostilePrompt);
        expect(requestOf(command)).toEqual({ provider: "claude", prompt: hostilePrompt });
        expect(scriptOf(command)).not.toContain(hostilePrompt);
        expect(scriptOf(command)).not.toMatch(/Invoke-Expression|cmd\.exe|\.cmd['" ]/);
        expect(scriptOf(command)).toContain("@('--', [string]$request.prompt)");
        expect(scriptOf(command)).toContain("$start.UseShellExecute = $false");
    });

    it("rejects invalid provider names, NULs and oversized launch frames before spawn", () => {
        expect(() => aiCommand("codex;echo injected" as AiProvider, powershell, "hello")).toThrow("Unsupported AI provider");
        expect(() => aiCommand("codex", powershell, "a\0b")).toThrow("NUL");
        expect(() => aiCommand("codex", powershell, "x".repeat(8193))).toThrow("launch limit");
        expect(() => aiCommand("codex", powershell, "😀".repeat(4096))).toThrow("launch limit");
        const command = aiCommand("codex", powershell, "x".repeat(2000));
        expect(powershell.length + command.args.join(" ").length + 4).toBeLessThan(32767);
        expect(Buffer.byteLength(JSON.stringify({ version: 1, id: 1, method: "spawn", session_id: 1, ...command }))).toBeLessThan(65536);
    });
});

describe.skipIf(process.platform !== "win32")("Windows provider launcher with native argument recorder", () => {
    let scratch: string;
    let native: string;
    let npm: string;
    let absent: string;
    const environment = (path: string) => ({
        SystemRoot: process.env.SystemRoot,
        PATH: path,
        PATHEXT: ".EXE;.CMD",
        HOME: scratch, USERPROFILE: scratch, APPDATA: scratch, LOCALAPPDATA: scratch, TEMP: scratch, TMP: scratch,
    });
    const run = (provider: AiProvider, path: string, prompt?: string) => {
        const command = aiCommand(provider, powershell, prompt);
        return spawnSync(command.executable, command.args, { cwd: scratch, env: environment(path), encoding: "utf8", windowsHide: true, timeout: 15_000 });
    };
    const argumentsOf = (result: ReturnType<typeof run>) => {
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim().split(/\r?\n/).filter(Boolean).map((value) => Buffer.from(value, "base64").toString("utf8"));
    };

    beforeAll(() => {
        scratch = mkdtempSync(join(tmpdir(), "slterm-provider-args-"));
        native = join(scratch, "native's bin"); npm = join(scratch, "npm's bin"); absent = join(scratch, "absent");
        for (const directory of [native, npm, absent]) mkdirSync(directory);
        const recorder = join(native, "codex.exe");
        const source = 'using System; using System.Text; public class ArgumentRecorder { public static int Main(string[] args) { foreach (string arg in args) Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg))); return 0; } }';
        const compile = `Add-Type -TypeDefinition '${source}' -OutputAssembly '${recorder.replaceAll("'", "''")}' -OutputType ConsoleApplication;`;
        const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", Buffer.from(compile, "utf16le").toString("base64")], {
            cwd: scratch, env: environment(native), encoding: "utf8", windowsHide: true, timeout: 15_000,
        });
        expect(result.status, result.stderr).toBe(0);
        copyFileSync(recorder, join(native, "claude.exe"));
        copyFileSync(recorder, join(npm, "node.exe"));
        for (const provider of ["claude", "codex"] as const) {
            const entry = join(npm, provider === "claude" ? "node_modules/@anthropic-ai/claude-code/cli.js" : "node_modules/@openai/codex/bin/codex.js");
            mkdirSync(join(entry, ".."), { recursive: true });
            writeFileSync(entry, "// Argument recorder fixture; no provider code.");
            writeFileSync(join(absent, `${provider}.cmd`), "@echo SHIM_INVOKED\r\n");
        }
    }, 20_000);
    afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

    it("delivers a hostile prompt as exactly one native argument after the option terminator", () => {
        for (const provider of ["claude", "codex"] as const)
            expect(argumentsOf(run(provider, native, hostilePrompt))).toEqual(["--", hostilePrompt]);
    }, 35_000);

    it("starts a manual provider with no initial arguments", () => {
        const result = run("codex", native);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
    }, 20_000);

    it("launches supported npm JS entries directly through node.exe", () => {
        for (const provider of ["claude", "codex"] as const) {
            const expectedEntry = join(npm, provider === "claude" ? "node_modules/@anthropic-ai/claude-code/cli.js" : "node_modules/@openai/codex/bin/codex.js");
            expect(argumentsOf(run(provider, npm, hostilePrompt))).toEqual([expectedEntry.replaceAll("/", "\\"), "--", hostilePrompt]);
        }
    }, 35_000);

    it("fails explicitly when only a command shim exists and never executes prompt syntax", () => {
        const result = run("codex", absent, hostilePrompt);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("codex CLI was not found");
        expect(result.stdout).not.toContain("SHIM_INVOKED");
        expect(result.stdout).not.toContain("SHOULD_NOT_RUN");
    }, 20_000);
});
