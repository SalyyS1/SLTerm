[CmdletBinding()]
param([string]$ZigPath, [string]$ZigArchive, [switch]$DownloadDependencies)

$ErrorActionPreference = 'Stop'
if (![OperatingSystem]::IsWindows()) { throw 'This proof currently targets Windows x64 with WinCNG.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$scratch = Join-Path $repo 'proof-results/ssh-proof'
$pin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependency-pins.json') -Raw | ConvertFrom-Json
$zigPin = Get-Content -LiteralPath (Join-Path $repo 'native-core/toolchain.json') -Raw | ConvertFrom-Json
if (!$ZigPath) { $ZigPath = Join-Path (Split-Path $repo -Parent) "toolchains/zig-x86_64-windows-$($zigPin.version)/zig.exe" }
$ZigPath = (Resolve-Path -LiteralPath $ZigPath).Path
if (!$ZigArchive) { $ZigArchive = (Split-Path $ZigPath -Parent) + '.zip' }
if ((Get-FileHash -LiteralPath $ZigArchive -Algorithm SHA256).Hash -ne $zigPin.'windows-x64'.sha256) { throw 'Zig archive checksum mismatch.' }
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZigArchive).Path)
try {
    $entry = $zip.GetEntry("zig-x86_64-windows-$($zigPin.version)/zig.exe")
    if (!$entry) { throw 'Pinned compiler archive has no expected executable.' }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $binaryHash = [Convert]::ToHexString($sha.ComputeHash($stream)) }
    finally { $sha.Dispose(); $stream.Dispose() }
} finally { $zip.Dispose() }
if ((Get-FileHash -LiteralPath $ZigPath -Algorithm SHA256).Hash -ne $binaryHash) { throw 'Compiler differs from verified archive.' }
if ((& $ZigPath version).Trim() -ne $zigPin.version) { throw 'Wrong Zig version.' }
if ((Get-PSDrive -Name ([IO.Path]::GetPathRoot($scratch).TrimEnd(':\'))).Free -lt 200MB) { throw 'SSH proof requires at least 200 MiB free before building.' }
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$archive = Join-Path $scratch $pin.libssh2.archiveName
if (!(Test-Path -LiteralPath $archive)) {
    if (!$DownloadDependencies) { throw 'Pass -DownloadDependencies to fetch the isolated pinned dependency.' }
    Invoke-WebRequest -Uri $pin.libssh2.url -OutFile $archive -TimeoutSec 60
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $pin.libssh2.sha256) { throw 'libssh2 archive checksum mismatch.' }
$source = Join-Path $scratch $pin.libssh2.sourceDirectory
if (!(Test-Path -LiteralPath $source)) { Expand-Archive -LiteralPath $archive -DestinationPath $scratch }
# Verify reused extraction too: a valid archive beside edited source is not a pin.
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($entry in $zip.Entries) {
        if (!$entry.Name) { continue }
        $file = Join-Path $scratch $entry.FullName
        if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Pinned source file missing: $($entry.FullName)" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $expected = [Convert]::ToHexString($sha.ComputeHash($stream)) }
        finally { $sha.Dispose(); $stream.Dispose() }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expected) { throw "Pinned source differs: $($entry.FullName)" }
    }
} finally { $zip.Dispose() }
$compiler = Join-Path $scratch 'zig-cc.cmd'
$archiver = Join-Path $scratch 'zig-ar.cmd'
$ranlib = Join-Path $scratch 'zig-ranlib.cmd'
Set-Content -LiteralPath $compiler -Value "@echo off`r`n`"$ZigPath`" cc -target x86_64-windows-gnu %*" -Encoding ascii
Set-Content -LiteralPath $archiver -Value "@echo off`r`n`"$ZigPath`" ar %*" -Encoding ascii
Set-Content -LiteralPath $ranlib -Value "@echo off`r`n`"$ZigPath`" ranlib %*" -Encoding ascii
$build = Join-Path $scratch 'libssh2-snapshot-build'
& cmake -S $source -B $build -G Ninja '-DCMAKE_SYSTEM_NAME=Windows' "-DCMAKE_C_COMPILER=$compiler" "-DCMAKE_AR=$archiver" "-DCMAKE_RANLIB=$ranlib" '-DCMAKE_BUILD_TYPE=Release' '-DBUILD_STATIC_LIBS=ON' '-DBUILD_SHARED_LIBS=OFF' '-DBUILD_EXAMPLES=OFF' '-DBUILD_TESTING=OFF' '-DENABLE_ZLIB_COMPRESSION=OFF' '-DCRYPTO_BACKEND=WinCNG'
if ($LASTEXITCODE -ne 0) { throw 'libssh2 configuration failed.' }
& cmake --build $build -j 2
if ($LASTEXITCODE -ne 0) { throw 'libssh2 compilation failed.' }
$library = Join-Path $build 'src/libssh2.a'
if (!(Test-Path -LiteralPath $library)) { throw "Expected static archive missing: $library" }
Push-Location (Join-Path $repo 'native-core/ssh-proof')
try {
    & $ZigPath build "-Dlibssh2-source=$source" "-Dlibssh2-library=$library" --cache-dir (Join-Path $repo 'native-core/.zig-cache/ssh-proof') --prefix (Join-Path $scratch 'zig-out') -j2 --summary all
    if ($LASTEXITCODE -ne 0) { throw 'Zig C ABI proof build failed.' }
} finally { Pop-Location }
$evidence = [ordered]@{
    zigVersion = $zigPin.version
    zigArchiveSha256 = $zigPin.'windows-x64'.sha256
    libssh2Version = $pin.libssh2.version
    libssh2Commit = $pin.libssh2.commit
    libssh2ArchiveSha256 = $pin.libssh2.sha256
    cryptoBackend = 'WinCNG'
    staticLibrarySha256 = (Get-FileHash -LiteralPath $library -Algorithm SHA256).Hash.ToLowerInvariant()
    executableSha256 = (Get-FileHash -LiteralPath (Join-Path $scratch 'zig-out/bin/slterm-ssh-proof.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
}
$evidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $scratch 'build-evidence.json') -Encoding utf8
