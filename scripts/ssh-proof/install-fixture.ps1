[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$scratch = Join-Path $repo 'proof-results/ssh-proof'
$server = Join-Path $scratch 'server'
$pin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependency-pins.json') -Raw | ConvertFrom-Json
$lock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixture-package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
$locked = $lock.packages.'node_modules/ssh2'
if ($locked.version -ne $pin.fixture.version -or $locked.integrity -ne $pin.fixture.integrity) { throw 'Fixture lock differs from dependency pin.' }
New-Item -ItemType Directory -Path $server -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixture-package.json') -Destination (Join-Path $server 'package.json')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixture-package-lock.json') -Destination (Join-Path $server 'package-lock.json')
& npm ci --prefix $server --cache (Join-Path $scratch 'npm-cache') --ignore-scripts --omit=optional --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Pinned fixture dependency installation failed.' }
