[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lock = Get-Content -Raw (Join-Path $repoRoot 'ruview.lock.json') | ConvertFrom-Json

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required. Install/start Docker Desktop, then run this script again.'
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker is installed but its engine is not available. Start Docker Desktop and try again.'
}

$firmwareRoot = (& (Join-Path $PSScriptRoot 'Sync-RuView.ps1') | Select-Object -Last 1)
$defaults = ($lock.sdkconfigDefaults -join ';')
$buildCommand = "rm -rf build sdkconfig && idf.py -DSDKCONFIG_DEFAULTS='$defaults' set-target esp32s3 && idf.py -DSDKCONFIG_DEFAULTS='$defaults' build"

Write-Host "Building RuView $($lock.commit) with $($lock.idfImage)..."
& docker run --rm `
    --volume "${firmwareRoot}:/project" `
    --workdir /project `
    $lock.idfImage `
    bash -lc $buildCommand
if ($LASTEXITCODE -ne 0) {
    throw "RuView Docker build failed with exit code $LASTEXITCODE."
}

$buildRoot = Join-Path $firmwareRoot 'build'
$applicationImages = @(
    Get-ChildItem -Path $buildRoot -Filter '*.bin' -File |
        Where-Object Name -ne 'ota_data_initial.bin'
)
if ($applicationImages.Count -ne 1) {
    throw "Expected exactly one application image in $buildRoot; found $($applicationImages.Count)."
}

$outputs = [ordered]@{
    'bootloader.bin'       = Join-Path $buildRoot 'bootloader/bootloader.bin'
    'partition-table.bin'  = Join-Path $buildRoot 'partition_table/partition-table.bin'
    'ota_data_initial.bin' = Join-Path $buildRoot 'ota_data_initial.bin'
    'flash_args'           = Join-Path $buildRoot 'flash_args'
    'flasher_args.json'    = Join-Path $buildRoot 'flasher_args.json'
}
$outputs[$applicationImages[0].Name] = $applicationImages[0].FullName

foreach ($entry in $outputs.GetEnumerator()) {
    if (-not (Test-Path $entry.Value)) {
        throw "Expected build output is missing: $($entry.Value)"
    }
}

$shortCommit = $lock.commit.Substring(0, 12)
$artifactRoot = Join-Path $repoRoot "artifacts/ruview-$shortCommit"
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

foreach ($entry in $outputs.GetEnumerator()) {
    Copy-Item -Force -Path $entry.Value -Destination (Join-Path $artifactRoot $entry.Key)
}

$hashLines = Get-ChildItem -Path $artifactRoot -Filter '*.bin' -File |
    Sort-Object Name |
    ForEach-Object {
        $hash = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLowerInvariant()
        "$hash  $($_.Name)"
    }
$hashLines | Set-Content -Encoding ascii (Join-Path $artifactRoot 'SHA256SUMS.txt')

Write-Host "Build artifacts and checksums are available at $artifactRoot."
