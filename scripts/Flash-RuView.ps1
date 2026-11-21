[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Port,

    [Parameter()]
    [string]$ArtifactDirectory,

    [Parameter()]
    [ValidateRange(115200, 2000000)]
    [int]$Baud = 460800,

    [Parameter()]
    [switch]$EraseFirst
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RuView-Tooling.ps1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lock = Get-Content -Raw (Join-Path $repoRoot 'ruview.lock.json') | ConvertFrom-Json
if (-not $ArtifactDirectory) {
    $ArtifactDirectory = Join-Path $repoRoot "artifacts/ruview-$($lock.commit.Substring(0, 12))"
}
$artifactRoot = (Resolve-Path $ArtifactDirectory).Path
$manifest = & (Join-Path $PSScriptRoot 'Test-RuViewArtifacts.ps1') -ArtifactDirectory $artifactRoot
$python = Resolve-RuViewPython

Invoke-RuViewPython -Python $python -Arguments @('-m', 'esptool', 'version')
if (-not $PSCmdlet.ShouldProcess("ESP32-S3 on serial port $Port", 'Probe chip and write verified RuView firmware')) {
    return
}

Invoke-RuViewPython -Python $python -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, 'chip-id'
)
Invoke-RuViewPython -Python $python -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, 'flash-id'
)
if ($EraseFirst) {
    Invoke-RuViewPython -Python $python -Arguments @(
        '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, 'erase-flash'
    )
}

$flashArguments = @(
    '-m', 'esptool',
    '--chip', 'esp32s3',
    '--port', $Port,
    '--baud', $Baud.ToString(),
    '--before', 'default-reset',
    '--after', 'hard-reset',
    'write-flash',
    '--flash-mode', $manifest.flashSettings.mode,
    '--flash-freq', $manifest.flashSettings.frequency,
    '--flash-size', $manifest.flashSettings.size
)
foreach ($file in $manifest.files) {
    $flashArguments += @($file.offset, (Join-Path $artifactRoot $file.name))
}
Invoke-RuViewPython -Python $python -Arguments $flashArguments
Write-Host 'Verified RuView firmware flash completed.'
