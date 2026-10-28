[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$RootProcessId,
    [ValidateRange(2, 600)][int]$Samples = 10,
    [ValidateRange(100, 60000)][int]$IntervalMilliseconds = 1000,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$target = Get-Process -Id $RootProcessId
$rootEntry = Get-CimInstance Win32_Process -Filter "ProcessId = $RootProcessId" -Property ProcessId, CreationDate
if (!$rootEntry) { throw 'Root exited before collection began.' }
$rootStarted = $rootEntry.CreationDate.ToUniversalTime()
if ([Math]::Abs(($target.StartTime.ToUniversalTime() - $rootStarted).TotalMilliseconds) -ge 1) {
    throw 'Root identity changed before collection began.'
}
$logicalCpus = [Environment]::ProcessorCount
$known = @{}
$known[$RootProcessId] = $rootStarted
$previous = @{}
$records = [System.Collections.Generic.List[object]]::new()
$clock = [Diagnostics.Stopwatch]::StartNew()
$lastElapsed = 0.0

function Get-Category([int]$ProcessId, [string]$ProcessName) {
    if ($ProcessId -eq $RootProcessId) { return 'application' }
    if ($ProcessName -match '^(msedgewebview2|electron)$') { return 'webview-or-electron-child' }
    if ($ProcessName -match '^(slterm-core-proof|wavesrv.*)$') { return 'backend' }
    if ($ProcessName -match '^wsh') { return 'shell-integration-helper' }
    if ($ProcessName -match '^(conhost|OpenConsole)$') { return 'console-host' }
    if ($ProcessName -match '^(powershell|pwsh|cmd|bash|zsh)$') { return 'shell' }
    if ($ProcessName -match '^(codex|claude)$') { return 'provider' }
    return 'other-descendant'
}

for ($sample = 0; $sample -lt $Samples; $sample++) {
    if ($sample -gt 0) { Start-Sleep -Milliseconds $IntervalMilliseconds }
    $inventory = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name)
    $byId = @{}
    foreach ($entry in $inventory) { $byId[[int]$entry.ProcessId] = $entry }
    $currentRoot = $byId[$RootProcessId]
    if (!$currentRoot -or $currentRoot.CreationDate.ToUniversalTime() -ne $rootStarted) {
        throw 'Measured root exited or PID was reused; refusing a misleading complete sample.'
    }
    do {
        $added = $false
        foreach ($entry in $inventory) {
            $entryId = [int]$entry.ProcessId
            $parentId = [int]$entry.ParentProcessId
            $parentEntry = $byId[$parentId]
            if (!$known.ContainsKey($entryId) -and $known.ContainsKey($parentId) -and $parentEntry -and
                $parentEntry.CreationDate.ToUniversalTime() -eq $known[$parentId]) {
                $birth = $entry.CreationDate.ToUniversalTime()
                if ($birth -ge $known[$parentId]) {
                    $known[$entryId] = $birth
                    $added = $true
                }
            }
        }
    } while ($added)
    $privateWorkingSets = @{}
    foreach ($counter in Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess, WorkingSetPrivate) {
        $privateWorkingSets[[int]$counter.IDProcess] = [long]$counter.WorkingSetPrivate
    }
    $elapsed = $clock.Elapsed.TotalMilliseconds
    $duration = $elapsed - $lastElapsed
    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($entryId in @($known.Keys)) {
        $entry = $byId[$entryId]
        if (!$entry -or $entry.CreationDate.ToUniversalTime() -ne $known[$entryId]) { continue }
        $item = Get-Process -Id $entryId -ErrorAction SilentlyContinue
        if (!$item) { continue }
        # The second identity check prevents attributing a freshly reused PID.
        if ([Math]::Abs(($item.StartTime.ToUniversalTime() - $known[$entryId]).TotalMilliseconds) -ge 1) { continue }
        $cpu = $item.TotalProcessorTime.TotalMilliseconds
        $delta = if ($previous.ContainsKey($entryId)) { [Math]::Max(0, $cpu - $previous[$entryId]) } else { 0 }
        $rows.Add([pscustomobject][ordered]@{
            pid = $entryId; parentPid = [int]$entry.ParentProcessId; name = $item.ProcessName
            startedUtc = $known[$entryId].ToString('o'); category = Get-Category $entryId $item.ProcessName
            workingSetBytes = $item.WorkingSet64; privateCommitBytes = $item.PrivateMemorySize64
            privateWorkingSetBytes = $privateWorkingSets[$entryId]; cpuDeltaMs = $delta
        })
        $previous[$entryId] = $cpu
    }
    $cpuDelta = ($rows | Measure-Object -Property cpuDeltaMs -Sum).Sum
    $missingCounters = @($rows | Where-Object { $null -eq $_.privateWorkingSetBytes } | ForEach-Object { $_.pid })
    $records.Add([ordered]@{
        sample = $sample; elapsedMs = $elapsed; intervalMs = $duration; processes = @($rows.ToArray())
        missingPrivateWorkingSetPids = $missingCounters
        totals = [ordered]@{
            workingSetSumBytes = ($rows | Measure-Object -Property workingSetBytes -Sum).Sum
            privateCommitBytes = ($rows | Measure-Object -Property privateCommitBytes -Sum).Sum
            privateWorkingSetBytes = if ($missingCounters.Count) { $null } else { ($rows | Measure-Object -Property privateWorkingSetBytes -Sum).Sum }
            cpuSingleCorePercent = if ($sample) { 100 * $cpuDelta / $duration } else { $null }
            cpuMachinePercent = if ($sample) { 100 * $cpuDelta / $duration / $logicalCpus } else { $null }
        }
    })
    $lastElapsed = $elapsed
}

$sharedWsl = @(Get-Process -Name vmmemWSL -ErrorAction SilentlyContinue | Select-Object Id, WorkingSet64, PrivateMemorySize64)
$report = [ordered]@{
    schemaVersion = 1; label = $Label; capturedUtc = [DateTime]::UtcNow.ToString('o')
    rootPid = $RootProcessId; rootStartedUtc = $rootStarted.ToString('o'); logicalCpus = $logicalCpus
    os = [Environment]::OSVersion.VersionString; requestedIntervalMs = $IntervalMilliseconds
    notes = @(
        'Read-only process-tree sample; caller must establish workload and exclude competing builds/tests.',
        'Working-set sum counts shared pages more than once; private working set and private commit are separate counters.',
        'CPU excludes first observation and processes born/exited between samples; it is a sampled lower bound.',
        'CIM collection overhead is in the actual interval; first sample is not a startup latency measurement.',
        'Shared WSL VM is reported separately and cannot be attributed to this application from ancestry.',
        'External providers/MCP daemons not descended from this root require separate measurement.'
    )
    sharedExternalWsl = $sharedWsl; samples = @($records.ToArray())
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$parent = Split-Path -Parent $resolvedOutput
if (!(Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Output $resolvedOutput
