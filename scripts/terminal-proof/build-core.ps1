[CmdletBinding()]
param([string]$ZigPath, [string]$ZigArchive, [switch]$DebugBuild)

$ErrorActionPreference = 'Stop'
if (![OperatingSystem]::IsWindows()) { throw 'This ConPTY proof requires Windows.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$coreRoot = Join-Path $repoRoot 'native-core'
$pin = Get-Content -LiteralPath (Join-Path $coreRoot 'toolchain.json') -Raw | ConvertFrom-Json
if (!$ZigPath) {
    $local = Join-Path (Split-Path -Parent $repoRoot) "toolchains/zig-x86_64-windows-$($pin.version)/zig.exe"
    if (Test-Path -LiteralPath $local) { $ZigPath = $local }
    else { $ZigPath = (Get-Command zig -ErrorAction Stop).Source }
}
$ZigPath = (Resolve-Path -LiteralPath $ZigPath).Path
if (!$ZigArchive) { $ZigArchive = (Split-Path -Parent $ZigPath) + '.zip' }
if (!(Test-Path -LiteralPath $ZigArchive)) {
    throw 'Pass -ZigArchive for the official distribution pinned in native-core/toolchain.json. No compiler is downloaded automatically.'
}
$archiveHash = (Get-FileHash -LiteralPath $ZigArchive -Algorithm SHA256).Hash
if ($archiveHash -ne $pin.'windows-x64'.sha256) { throw 'Pinned Zig archive checksum mismatch.' }
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZigArchive).Path)
try {
    $entry = $archive.GetEntry("zig-x86_64-windows-$($pin.version)/zig.exe")
    if (!$entry) { throw 'Verified archive has no expected compiler entry.' }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $expectedBinaryHash = [Convert]::ToHexString($sha.ComputeHash($stream)) }
    finally { $sha.Dispose(); $stream.Dispose() }
} finally { $archive.Dispose() }
if ((Get-FileHash -LiteralPath $ZigPath -Algorithm SHA256).Hash -ne $expectedBinaryHash) {
    throw 'Compiler executable differs from the checksum-verified archive.'
}
$actual = (& $ZigPath version).Trim()
if ($LASTEXITCODE -ne 0 -or $actual -ne $pin.version) {
    throw "Expected Zig $($pin.version), found '$actual'. Use the distribution/checksum in native-core/toolchain.json."
}
$optimize = if ($DebugBuild) { 'Debug' } else { 'ReleaseSafe' }
Push-Location $coreRoot
try {
    & $ZigPath build test install "-Doptimize=$optimize" -j2 --summary all
    if ($LASTEXITCODE -ne 0) { throw "Native proof build/tests failed ($LASTEXITCODE)." }
} finally { Pop-Location }
