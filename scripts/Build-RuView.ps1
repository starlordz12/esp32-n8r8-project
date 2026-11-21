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

$flasherArgsPath = Join-Path $buildRoot 'flasher_args.json'
if (-not (Test-Path -LiteralPath $flasherArgsPath -PathType Leaf)) {
    throw "Expected build output is missing: $flasherArgsPath"
}
$flasherArgs = Get-Content -Raw -LiteralPath $flasherArgsPath | ConvertFrom-Json
$reviewedLayout = [ordered]@{
    '0x000000' = [ordered]@{ name = 'bootloader.bin'; source = Join-Path $buildRoot 'bootloader/bootloader.bin' }
    '0x008000' = [ordered]@{ name = 'partition-table.bin'; source = Join-Path $buildRoot 'partition_table/partition-table.bin' }
    '0x00f000' = [ordered]@{ name = 'ota_data_initial.bin'; source = Join-Path $buildRoot 'ota_data_initial.bin' }
    '0x020000' = [ordered]@{ name = $applicationImages[0].Name; source = $applicationImages[0].FullName }
}

$generatedLayout = @{}
foreach ($property in $flasherArgs.flash_files.PSObject.Properties) {
    $normalizedOffset = '0x{0:x6}' -f [Convert]::ToInt32($property.Name, 16)
    $generatedLayout[$normalizedOffset] = [IO.Path]::GetFullPath((Join-Path $buildRoot $property.Value))
}
if (Compare-Object -ReferenceObject @($reviewedLayout.Keys) -DifferenceObject @($generatedLayout.Keys)) {
    throw 'ESP-IDF generated flash offsets that differ from the reviewed four-part layout.'
}

$outputs = [ordered]@{}
foreach ($offset in $reviewedLayout.Keys) {
    $expectedSource = [IO.Path]::GetFullPath($reviewedLayout[$offset].source)
    if ($generatedLayout[$offset] -ne $expectedSource) {
        throw "Unexpected ESP-IDF flash input at ${offset}: $($generatedLayout[$offset])"
    }
    $outputs[$reviewedLayout[$offset].name] = $expectedSource
}

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

$flashFiles = @(
    $reviewedLayout.Keys | ForEach-Object {
        [ordered]@{ offset = $_; name = $reviewedLayout[$_].name }
    }
)

foreach ($file in $flashFiles) {
    $file.sha256 = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $artifactRoot $file.name)).Hash.ToLowerInvariant()
}

$manifest = [ordered]@{
    schemaVersion = 1
    firmwareCommit = $lock.commit
    chip = 'esp32s3'
    flashSettings = [ordered]@{
        mode = 'dio'
        frequency = '80m'
        size = '8MB'
    }
    files = $flashFiles
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $artifactRoot 'flash-manifest.json')

$hashLines = $flashFiles |
    Sort-Object name |
    ForEach-Object { "$($_.sha256)  $($_.name)" }
$hashLines | Set-Content -Encoding ascii (Join-Path $artifactRoot 'SHA256SUMS.txt')

& (Join-Path $PSScriptRoot 'Test-RuViewArtifacts.ps1') -ArtifactDirectory $artifactRoot
Write-Host "Build artifacts and checksums are available at $artifactRoot."
