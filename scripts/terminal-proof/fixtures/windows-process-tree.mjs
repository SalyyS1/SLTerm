import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const selectIdentity = "Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='parentPid';e={[int]$_.ParentProcessId}},@{n='createdAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}}";

async function runPowerShell(command) {
    // execFile owns the helper handle, applies a hard timeout, and waits for exit.
    // Read only identity/resource counters, never command lines or environment.
    const { stdout } = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${command}`], {
        windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
}

export function isAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

export async function sampleProcessHandleCount(pid, samples = 5) {
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(samples) || samples <= 0) throw new Error("Invalid handle-count sample request");
    return JSON.parse(await runPowerShell(`
        $observedProcess=[Diagnostics.Process]::GetProcessById(${pid});
        try {
            $null=$observedProcess.Handle;
            $createdAt=$observedProcess.StartTime.ToUniversalTime().ToString('o');
            $counts=@(for ($sample=0; $sample -lt ${samples}; $sample++) {
                $observedProcess.Refresh(); [int]$observedProcess.HandleCount;
                if ($sample -lt ${samples - 1}) { Start-Sleep -Milliseconds 25 }
            });
            ConvertTo-Json -Compress -InputObject @{pid=${pid};createdAt=$createdAt;handles=$counts}
        } finally { $observedProcess.Dispose() }
    `));
}

export async function snapshotProcessTree(rootPid) {
    if (!Number.isInteger(rootPid) || rootPid <= 0) throw new Error("Invalid root PID");
    const all = JSON.parse(await runPowerShell(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | Where-Object { $null -ne $_.CreationDate } | ${selectIdentity})`));
    const root = all.find((item) => item.pid === rootPid);
    if (!root) return [];
    const owned = [root];
    for (let index = 0; index < owned.length; index++) {
        for (const item of all) {
            if (item.parentPid === owned[index].pid && item.createdAt >= owned[index].createdAt && !owned.some((known) => known.pid === item.pid)) owned.push(item);
        }
    }
    return owned;
}

export async function liveOwnedProcesses(identities) {
    const candidates = identities.filter((item) => isAlive(item.pid));
    if (!candidates.length) return [];
    const filter = candidates.map((item) => `ProcessId=${item.pid}`).join(" OR ");
    const current = JSON.parse(await runPowerShell(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate -Filter '${filter}' | ${selectIdentity})`));
    return candidates.filter((owned) => current.some((item) => item.pid === owned.pid && item.createdAt === owned.createdAt));
}

export async function waitForOwnedGone(identities, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let remaining;
    do {
        remaining = await liveOwnedProcesses(identities);
        if (!remaining.length) return;
        await delay(25);
    } while (Date.now() < deadline);
    throw new Error(`Owned process identities still alive: ${JSON.stringify(remaining)}`);
}

export async function killOwnedProcesses(identities) {
    const remaining = await liveOwnedProcesses(identities);
    if (!remaining.length) return;
    // Holding the Process.Handle protects the identity check/kill from PID reuse.
    // CIM timestamps retain microseconds, while GetProcessTimes retains 100ns.
    const commands = remaining.map(({ pid, createdAt }) => `
        try {
            $ownedProcess=[Diagnostics.Process]::GetProcessById(${pid});
            $null=$ownedProcess.Handle;
            $expected=[DateTime]::Parse('${createdAt}').ToUniversalTime();
            if ([Math]::Abs(($ownedProcess.StartTime.ToUniversalTime()-$expected).Ticks) -le 10) {
                $ownedProcess.Kill(); $null=$ownedProcess.WaitForExit(2000);
            }
            $ownedProcess.Dispose();
        } catch [ArgumentException] { } catch [InvalidOperationException] { }
    `).join("\n");
    // A handled "already exited" .NET exception can leave PowerShell's final
    // success flag false even though cleanup succeeded; unhandled errors stop
    // before this explicit success exit because ErrorActionPreference is Stop.
    await runPowerShell(`${commands}\nexit 0`);
}
