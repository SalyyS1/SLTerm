[CmdletBinding()]
param([string]$ZigPath, [string]$ZigArchive)

$ErrorActionPreference = 'Stop'
if (![OperatingSystem]::IsWindows()) { throw 'Transcript archive tests require Windows System32 SQLite.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$pin = Get-Content -LiteralPath (Join-Path $repoRoot 'native-core/toolchain.json') -Raw | ConvertFrom-Json
if (!$ZigPath) { $ZigPath = Join-Path (Split-Path -Parent $repoRoot) "toolchains/zig-x86_64-windows-$($pin.version)/zig.exe" }
$ZigPath = (Resolve-Path -LiteralPath $ZigPath).Path
if (!$ZigArchive) { $ZigArchive = (Split-Path -Parent $ZigPath) + '.zip' }
if ((Get-FileHash -LiteralPath $ZigArchive -Algorithm SHA256).Hash -ne $pin.'windows-x64'.sha256) { throw 'Pinned Zig archive checksum mismatch.' }
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZigArchive).Path)
try {
    $entry = $zip.GetEntry("zig-x86_64-windows-$($pin.version)/zig.exe")
    if (!$entry) { throw 'Verified archive has no expected compiler.' }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $expected = [Convert]::ToHexString($sha.ComputeHash($stream)) }
    finally { $sha.Dispose(); $stream.Dispose() }
} finally { $zip.Dispose() }
if ((Get-FileHash -LiteralPath $ZigPath -Algorithm SHA256).Hash -ne $expected) { throw 'Compiler differs from checksum verified archive.' }
if ((& $ZigPath version).Trim() -ne $pin.version -or $LASTEXITCODE -ne 0) { throw 'Pinned Zig version mismatch.' }
Push-Location (Join-Path $repoRoot 'native-core')
try {
    & $ZigPath test src/transcript-tests.zig -lkernel32 -O ReleaseSafe
    if ($LASTEXITCODE -ne 0) { throw "Transcript tests failed ($LASTEXITCODE)." }
} finally { Pop-Location }
