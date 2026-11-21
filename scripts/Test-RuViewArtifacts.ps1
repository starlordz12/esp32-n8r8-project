[CmdletBinding()]
param(
    [Parameter()]
    [string]$ArtifactDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lock = Get-Content -Raw (Join-Path $repoRoot 'ruview.lock.json') | ConvertFrom-Json
if (-not $ArtifactDirectory) {
    $ArtifactDirectory = Join-Path $repoRoot "artifacts/ruview-$($lock.commit.Substring(0, 12))"
}
$artifactRoot = (Resolve-Path $ArtifactDirectory).Path
$manifestPath = Join-Path $artifactRoot 'flash-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Missing flash manifest: $manifestPath"
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) {
    throw "Unsupported flash manifest schema: $($manifest.schemaVersion)"
}
if ($manifest.firmwareCommit -ne $lock.commit) {
    throw 'Artifact firmware commit does not match ruview.lock.json.'
}
if ($manifest.chip -ne 'esp32s3') {
    throw "Unexpected flash target: $($manifest.chip)"
}
if ($manifest.flashSettings.mode -ne 'dio' -or
    $manifest.flashSettings.frequency -ne '80m' -or
    $manifest.flashSettings.size -ne '8MB') {
    throw 'Flash settings do not match the reviewed DIO/80 MHz/8 MB configuration.'
}

$expectedOffsets = @('0x000000', '0x008000', '0x00f000', '0x020000')
$actualOffsets = @($manifest.files | ForEach-Object { $_.offset.ToLowerInvariant() })
if (Compare-Object -ReferenceObject $expectedOffsets -DifferenceObject $actualOffsets) {
    throw 'Flash manifest must contain exactly the four reviewed ESP32-S3 offsets.'
}

$seenNames = @{}
foreach ($file in $manifest.files) {
    if ([string]::IsNullOrWhiteSpace($file.name) -or $file.name -ne [IO.Path]::GetFileName($file.name)) {
        throw "Flash manifest contains an unsafe file name: $($file.name)"
    }
    if ($seenNames.ContainsKey($file.name)) {
        throw "Flash manifest repeats file name: $($file.name)"
    }
    $seenNames[$file.name] = $true
    if ($file.sha256 -notmatch '^[a-fA-F0-9]{64}$') {
        throw "Flash manifest contains an invalid SHA-256 for $($file.name)."
    }

    $path = Join-Path $artifactRoot $file.name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing flash artifact: $path"
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    if ($actualHash -ne $file.sha256.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $($file.name)."
    }
}

$filesByOffset = @{}
foreach ($file in $manifest.files) { $filesByOffset[$file.offset.ToLowerInvariant()] = $file.name }
if ($filesByOffset['0x000000'] -ne 'bootloader.bin' -or
    $filesByOffset['0x008000'] -ne 'partition-table.bin' -or
    $filesByOffset['0x00f000'] -ne 'ota_data_initial.bin' -or
    $filesByOffset['0x020000'] -notmatch '\.bin$') {
    throw 'Flash manifest file roles do not match the reviewed partition layout.'
}

$checksumPath = Join-Path $artifactRoot 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
    throw "Missing checksum file: $checksumPath"
}
$checksumLines = @(Get-Content -LiteralPath $checksumPath | Where-Object { $_.Trim() })
if ($checksumLines.Count -ne $manifest.files.Count) {
    throw 'SHA256SUMS.txt does not contain exactly one entry per flash binary.'
}
foreach ($file in $manifest.files) {
    $expectedLine = "$($file.sha256.ToLowerInvariant())  $($file.name)"
    if ($checksumLines -notcontains $expectedLine) {
        throw "SHA256SUMS.txt is missing the reviewed checksum for $($file.name)."
    }
}

Write-Host "Verified $($manifest.files.Count) flash artifacts for RuView $($manifest.firmwareCommit)."
return $manifest
