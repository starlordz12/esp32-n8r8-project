[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Port,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Ssid,

    [Parameter(Mandatory)]
    [ValidateScript({
        $parsed = $null
        if (-not [Net.IPAddress]::TryParse($_, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
            throw 'AggregatorAddress must be an IPv4 address.'
        }
        $true
    })]
    [string]$AggregatorAddress,

    [Parameter()]
    [ValidateRange(1, 255)]
    [int]$NodeId = 1,

    [Parameter()]
    [ValidateRange(1, 255)]
    [int]$TdmTotal = 1,

    [Parameter()]
    [ValidateRange(0, 254)]
    [int]$TdmSlot = 0,

    [Parameter()]
    [ValidateRange(115200, 2000000)]
    [int]$Baud = 460800,

    [Parameter()]
    [Security.SecureString]$WifiPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RuView-Tooling.ps1')

if ($TdmSlot -ge $TdmTotal) {
    throw 'TdmSlot must be less than TdmTotal.'
}
if (-not $WifiPassword) {
    $WifiPassword = Read-Host 'Wi-Fi password (not stored)' -AsSecureString
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$firmwareRoot = (& (Join-Path $PSScriptRoot 'Sync-RuView.ps1') | Select-Object -Last 1)
$provisionScript = Join-Path $firmwareRoot 'provision.py'
$launcher = Join-Path $PSScriptRoot 'Invoke-RuViewProvision.py'
$python = Resolve-RuViewPython
$stateDirectory = Join-Path ([IO.Path]::GetTempPath()) ("ruview-provision-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stateDirectory | Out-Null

$plainPassword = $null
try {
    $credential = [PSCredential]::new('wifi', $WifiPassword)
    $plainPassword = $credential.GetNetworkCredential().Password
    if ([string]::IsNullOrEmpty($plainPassword)) {
        throw 'Wi-Fi password cannot be empty.'
    }

    Invoke-RuViewPython -Python $python -Arguments @('-m', 'esptool', 'version')
    if (-not $PSCmdlet.ShouldProcess("ESP32-S3 node $NodeId on serial port $Port", 'Write Wi-Fi and aggregator settings to NVS')) {
        return
    }

    $env:RUVIEW_PROVISION_PASSWORD = $plainPassword
    $env:RUVIEW_PROVISION_SSID = $Ssid
    Invoke-RuViewPython -Python $python -Arguments @(
        $launcher,
        $provisionScript,
        '--port', $Port,
        '--chip', 'esp32s3',
        '--baud', $Baud.ToString(),
        '--target-ip', $AggregatorAddress,
        '--target-port', '5005',
        '--node-id', $NodeId.ToString(),
        '--tdm-slot', $TdmSlot.ToString(),
        '--tdm-total', $TdmTotal.ToString(),
        '--state-dir', $stateDirectory,
        '--reset'
    )
    Write-Host "Provisioned node $NodeId for UDP 5005 without retaining credentials locally."
}
finally {
    Remove-Item Env:RUVIEW_PROVISION_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:RUVIEW_PROVISION_SSID -ErrorAction SilentlyContinue
    $plainPassword = $null
    if (Test-Path -LiteralPath $stateDirectory) {
        Remove-Item -LiteralPath $stateDirectory -Recurse -Force
    }
}
