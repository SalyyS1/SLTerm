[CmdletBinding()]
param(
    [ValidateSet('Zig', 'Gcc')][string]$Compiler = 'Zig',
    [switch]$SkipFrontend,
    [switch]$AllowModuleDownloads,
    [string]$BuildTime = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmm')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$evidenceDir = Join-Path $repoRoot 'proof-results\baseline-build'
$savedEnvironment = @{}
$environmentNames = @('CGO_ENABLED', 'GOOS', 'GOARCH', 'CC', 'GOMAXPROCS', 'GOTOOLCHAIN', 'GOPROXY', 'GOSUMDB', 'GOPRIVATE', 'GONOSUMDB', 'GONOPROXY', 'ZIG_GLOBAL_CACHE_DIR', 'ZIG_LOCAL_CACHE_DIR')
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location $repoRoot
try {
    # Only build the existing entrypoints; no tidy, generators, installers or publishing.
    $sourcePaths = @('emain', 'pkg', 'cmd', 'frontend', 'go.mod', 'go.sum', 'electron.vite.config.ts', 'index.html')
    & git diff --exit-code HEAD -- @sourcePaths
    if ($LASTEXITCODE -ne 0) { throw 'Tracked production source differs from HEAD; baseline provenance requires review.' }
    $revision = (& git rev-parse HEAD).Trim()
    $version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
    New-Item -ItemType Directory -Force -Path $evidenceDir, (Join-Path $repoRoot 'dist\bin') | Out-Null
    $env:GOTOOLCHAIN = 'local'
    $env:GOMAXPROCS = '2'
    $env:GOPROXY = 'off'
    $env:GOSUMDB = 'sum.golang.org'
    $env:GOPRIVATE = ''
    $env:GONOSUMDB = ''
    $env:GONOPROXY = ''
    if ($AllowModuleDownloads) { $env:GOPROXY = 'https://proxy.golang.org' }
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '1'
    if ($Compiler -eq 'Zig') {
        $compilerPath = (Resolve-Path (Join-Path $repoRoot '..\toolchains\zig-x86_64-windows-0.17.0\zig.exe')).Path
        $compilerVersion = (& $compilerPath version).Trim()
        if ($compilerVersion -ne '0.17.0') { throw "Unexpected Zig version: $compilerVersion" }
        $env:CC = '"' + $compilerPath + '" cc -target x86_64-windows-gnu'
        $env:ZIG_GLOBAL_CACHE_DIR = Join-Path $evidenceDir 'zig-global-cache'
        $env:ZIG_LOCAL_CACHE_DIR = Join-Path $evidenceDir 'zig-local-cache'
    } else {
        $compilerPath = (Get-Command gcc.exe -ErrorAction Stop).Source
        $compilerVersion = (& $compilerPath --version | Select-Object -First 1)
        $env:CC = $compilerPath
    }
    $goVersion = (& go version).Trim()
    $ldflags = "-s -w -X main.BuildTime=$BuildTime -X main.WaveVersion=$version"
    Write-Output "Building unchanged Windows backend with $compilerVersion ($goVersion)"
    & go build -p 2 -mod=readonly -tags 'osusergo,sqlite_omit_load_extension' -ldflags $ldflags -o dist/bin/wavesrv.x64.exe cmd/server/main-server.go
    if ($LASTEXITCODE -ne 0) { throw "wavesrv build failed: $LASTEXITCODE" }
    $env:CGO_ENABLED = '0'
    $wshRelativePath = "dist/bin/wsh-$version-windows.x64.exe"
    & go build -p 2 -mod=readonly -ldflags $ldflags -o $wshRelativePath cmd/wsh/main-wsh.go
    if ($LASTEXITCODE -ne 0) { throw "wsh build failed: $LASTEXITCODE" }
    if (-not $SkipFrontend) {
        # Use the installed CLI directly, matching build:prod without npm lifecycle hooks.
        & node node_modules/electron-vite/bin/electron-vite.js build --mode production
        if ($LASTEXITCODE -ne 0) { throw "Electron frontend/main build failed: $LASTEXITCODE" }
    }
    & git diff --exit-code HEAD -- @sourcePaths
    if ($LASTEXITCODE -ne 0) { throw 'Production source changed during build; do not use these artifacts as baseline.' }
    $artifactPaths = @('dist/bin/wavesrv.x64.exe', $wshRelativePath, 'dist/main/index.js', 'dist/preload/index.cjs', 'dist/frontend/index.html')
    $artifacts = foreach ($relativePath in $artifactPaths) {
        $artifactPath = Join-Path $repoRoot $relativePath
        if (Test-Path -LiteralPath $artifactPath) {
            @{ path = $relativePath; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash; bytes = (Get-Item -LiteralPath $artifactPath).Length }
        }
    }
    $receipt = @{
        revision = $revision; version = $version; buildTime = $BuildTime
        compiler = $compilerPath; compilerVersion = $compilerVersion; goVersion = $goVersion
        productionSourceUnchanged = $true; frontendRebuilt = (-not $SkipFrontend)
        moduleDownloadsAllowed = $AllowModuleDownloads.IsPresent; modulePolicy = 'readonly; proxy.golang.org; sum.golang.org'
        artifacts = @($artifacts)
    }
    $receipt | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $evidenceDir 'build-receipt.json')
    Write-Output ($receipt | ConvertTo-Json -Depth 5)
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    Pop-Location
}
