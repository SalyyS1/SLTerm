/* Native stdio provider lifecycle proof; the child is PowerShell fixture code, never Codex. */
import assert from "node:assert/strict";
import { CoreClient, repoRoot } from "./core-client.mjs";
import path from "node:path";
import fs from "node:fs";

assert.equal(process.platform, "win32", "Windows-only provider proof");
const out = path.join(repoRoot, "proof-results", `provider-integration-${Date.now()}-${process.pid}`);
fs.mkdirSync(out, { recursive: true });
const core = new CoreClient({ env: { ...process.env, SLTERM_ADE_DATABASE: path.join(out, "ade.db"), GIT_CONFIG_GLOBAL: "NUL", GIT_CONFIG_NOSYSTEM: "1" } });
const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const cwd = out;
const script = "$OutputEncoding=[Console]::OutputEncoding=[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $line=[Console]::In.ReadLine(); [Console]::Out.WriteLine($line); [Console]::Out.Flush();";
let failure;
try {
    await core.waitFor((frame) => frame.event === "ready", "native core ready");
    const started = await core.request("provider.start", {
        provider_id: 41,
        provider: "codex",
        executable: powershell,
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        cwd,
    });
    assert.equal(started.ok, true, started.error_code);
    const request = JSON.stringify({ method: "fixture/echo", params: { text: "Tiếng Việt 😀" } }) + "\n";
    const input = await core.request("provider.input", { provider_id: 41, data: request });
    assert.equal(input.ok, true, input.error_code);
    const output = await core.waitFor((frame) => frame.event === "provider.output" && frame.provider_id === 41, "provider output");
    assert.equal(output.sequence, 1);
    assert.deepEqual(Buffer.from(output.data, "base64").toString("utf8").replace(/\r\n$/, "\n"), request);
    const exited = await core.waitFor((frame) => frame.event === "provider.exit" && frame.provider_id === 41, "provider exit");
    assert.equal(exited.exit_code, 0);
    assert.equal(exited.last_sequence, 1);
    await core.request("shutdown", {});
    await core.waitClosed();
    console.log(JSON.stringify({ ok: true, provider: "codex", fixture: "powershell-stdio", outputSequence: output.sequence, exitCode: exited.exit_code, out }, null, 2));
} catch (error) {
    failure = error;
} finally {
    try { await core.dispose(); } catch (error) { failure ??= error; }
}
if (failure) {
    console.error(failure.stack ?? failure);
    process.exitCode = 1;
}
