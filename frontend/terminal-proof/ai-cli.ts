import type { SpawnCommand } from "./terminal-session";

export type AiProvider = "claude" | "codex";
export type AiCommand = SpawnCommand & { provider: AiProvider; label: string };

function base64(bytes: Uint8Array): string {
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function encodedCommand(script: string): string {
    const bytes = new Uint8Array(script.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < script.length; index++) view.setUint16(index * 2, script.charCodeAt(index), true);
    return base64(bytes);
}

/** Only base64 JSON data varies; no prompt text becomes PowerShell syntax. */
function launcher(payload: string): string {
    return String.raw`$ErrorActionPreference = 'Stop';
try {
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false);
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);
    $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json;
    if ($request.provider -notin @('claude', 'codex')) { throw 'Unsupported provider.'; }
    $native = Get-Command ($request.provider + '.exe') -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1;
    $program = $null;
    $arguments = @();
    if ($native) { $program = $native.Source; }
    else {
        $entry = if ($request.provider -eq 'claude') { 'node_modules/@anthropic-ai/claude-code/cli.js' } else { 'node_modules/@openai/codex/bin/codex.js' };
        foreach ($root in ($env:PATH -split ';')) {
            if (-not $root -or -not [IO.Path]::IsPathRooted($root)) { continue; }
            $candidate = Join-Path $root $entry;
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1;
                if (-not $node) { throw 'The provider npm installation requires node.exe on PATH.'; }
                $program = $node.Source;
                $arguments = @($candidate);
                break;
            }
        }
    }
    if (-not $program) { throw ($request.provider + ' CLI was not found. Install its official native executable or supported npm package.'); }
    if ($null -ne $request.prompt) { $arguments += @('--', [string]$request.prompt); }
    function Quote-NativeArgument([string] $value) {
        $escaped = [regex]::Replace($value, '(\\*)"', '$1$1\"');
        $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1');
        return '"' + $escaped + '"';
    }
    $start = [Diagnostics.ProcessStartInfo]::new();
    $start.FileName = $program;
    $start.UseShellExecute = $false;
    $start.WorkingDirectory = (Get-Location).ProviderPath;
    $start.Arguments = (($arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ');
    $process = [Diagnostics.Process]::Start($start);
    $process.WaitForExit();
    exit $process.ExitCode;
} catch { [Console]::Error.WriteLine('SLTerm provider launch failed: ' + $_.Exception.Message); exit 1; }`;
}

/** Starts the official interactive CLI; authentication and permissions stay with it. */
export function aiCommand(provider: AiProvider, powershell: string, initialPrompt?: string): AiCommand {
    if (provider !== "claude" && provider !== "codex") throw new Error("Unsupported AI provider.");
    if (initialPrompt?.includes("\0")) throw new Error("Prompt contains a NUL character; it was not launched.");
    // Reject before encoding to keep allocation bounded. The exact Windows command
    // length below also covers the encoded script and the local executable path.
    if (initialPrompt && initialPrompt.length > 8192) throw new Error("Prompt exceeds the CLI launch limit; it was not launched.");
    const payload = base64(new TextEncoder().encode(JSON.stringify({ provider, prompt: initialPrompt })));
    const args = ["-NoLogo", "-NoProfile", "-EncodedCommand", encodedCommand(launcher(payload))];
    if (powershell.length + args.join(" ").length + 4 >= 32767)
        throw new Error("Prompt exceeds the Windows CLI launch limit; it was not launched.");
    return { provider, label: provider === "claude" ? "Claude CLI" : "Codex CLI", executable: powershell, args };
}
