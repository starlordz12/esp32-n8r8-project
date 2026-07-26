[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param(
        [Parameter(Mandatory)]
        [string[]] $Arguments
    )

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lockPath = Join-Path $repoRoot 'ruview.lock.json'
$lock = Get-Content -Raw $lockPath | ConvertFrom-Json

if ($lock.schemaVersion -ne 1) {
    throw "Unsupported RuView lock schema version: $($lock.schemaVersion)"
}
if ($lock.repository -notmatch '^https://github\.com/[^/]+/[^/]+(?:\.git)?$') {
    throw 'The RuView repository must be a GitHub HTTPS URL.'
}
if ($lock.commit -notmatch '^[0-9a-f]{40}$') {
    throw 'The RuView lock must contain a full 40-character lowercase commit SHA.'
}
if ([string]::IsNullOrWhiteSpace($lock.firmwarePath)) {
    throw 'The RuView firmware path is missing from the lock.'
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required to synchronize the pinned RuView source.'
}

$dependencyRoot = Join-Path $repoRoot '.deps'
$sourceRoot = Join-Path $dependencyRoot 'RuView'
$gitDirectory = Join-Path $sourceRoot '.git'

New-Item -ItemType Directory -Force -Path $dependencyRoot | Out-Null

if (-not (Test-Path $gitDirectory)) {
    if (Test-Path $sourceRoot) {
        throw "The dependency path exists but is not a Git repository: $sourceRoot"
    }

    New-Item -ItemType Directory -Path $sourceRoot | Out-Null
    Invoke-Git -Arguments @('-C', $sourceRoot, 'init')
    Invoke-Git -Arguments @('-C', $sourceRoot, 'remote', 'add', 'origin', $lock.repository)
    Invoke-Git -Arguments @('-C', $sourceRoot, 'sparse-checkout', 'init', '--cone')
    Invoke-Git -Arguments @('-C', $sourceRoot, 'sparse-checkout', 'set', $lock.firmwarePath)
}
else {
    $status = & git -C $sourceRoot status --porcelain
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect the existing RuView dependency checkout.'
    }
    if ($status) {
        throw "The RuView dependency checkout has local changes. Clean $sourceRoot before synchronizing."
    }

    $remote = (& git -C $sourceRoot remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or $remote -ne $lock.repository) {
        throw "The existing RuView checkout does not use the locked origin: $($lock.repository)"
    }
}

Write-Host "Fetching pinned RuView commit $($lock.commit)..."
Invoke-Git -Arguments @(
    '-C', $sourceRoot,
    'fetch', '--depth', '1', '--filter=blob:none',
    'origin', $lock.commit
)
Invoke-Git -Arguments @('-C', $sourceRoot, 'checkout', '--detach', '--force', 'FETCH_HEAD')

$resolvedCommit = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $resolvedCommit -ne $lock.commit) {
    throw "Resolved RuView commit $resolvedCommit does not match the lock."
}

$firmwareRoot = Join-Path $sourceRoot ($lock.firmwarePath -replace '/', [IO.Path]::DirectorySeparatorChar)
$requiredFiles = @(
    'CMakeLists.txt',
    'sdkconfig.defaults',
    'sdkconfig.defaults.devkitc'
)
foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path (Join-Path $firmwareRoot $requiredFile))) {
        throw "Pinned RuView source is missing required file: $requiredFile"
    }
}

Write-Host "RuView firmware is synchronized at $resolvedCommit."
Write-Output $firmwareRoot
