[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$settings=Get-Content -Raw (Join-Path $PSScriptRoot 'console-settings.local.json') | ConvertFrom-Json
function Test-RuViewListener([int]$Port) {
    try {
        $health=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
        return ($health.status -eq 'ok' -and $null -ne $health.processing)
    } catch { return $false }
}
if(-not (Test-RuViewListener 3000)) {
    $sshArgs=@('-N','-o','BatchMode=yes','-o','ConnectTimeout=7','-o','StrictHostKeyChecking=yes',
        '-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',
        '-L','127.0.0.1:3000:127.0.0.1:3000',$settings.sshTarget)
    Start-Process -FilePath ssh.exe -ArgumentList $sshArgs -WindowStyle Hidden | Out-Null
    for($i=0;$i -lt 30;$i++) { if(Test-RuViewListener 3000){break}; Start-Sleep -Milliseconds 300 }
    if(-not (Test-RuViewListener 3000)){throw 'Cannot connect to the Pi. Check SSH access and the local API port.'}
}
if(-not (Test-RuViewListener 8092)) {
    $env:RUVIEW_PI_SSH=$settings.sshTarget
    $env:RUVIEW_PI_ENV=$settings.envPath
    if($settings.PSObject.Properties.Name -contains 'modelPath'){
        $env:RUVIEW_ACTIVITY_MODEL=$settings.modelPath
        $env:RUVIEW_MODEL_NODE_ID=[string]$settings.modelNodeId
    }
    $proxy=Join-Path $PSScriptRoot 'console.mjs'
    Start-Process -FilePath node.exe -ArgumentList ('"{0}"' -f $proxy) -WindowStyle Hidden | Out-Null
    for($i=0;$i -lt 30;$i++) { if(Test-RuViewListener 8092){break}; Start-Sleep -Milliseconds 300 }
    if(-not (Test-RuViewListener 8092)){throw 'Native console could not start. Check the existing Pi API credential and local console port.'}
}
if($settings.PSObject.Properties.Name -contains 'modelPath'){
    $modelStatus=Invoke-RestMethod -Uri 'http://127.0.0.1:8092/local/activity/status' -TimeoutSec 3
    if(-not $modelStatus.model_loaded){throw 'The running console has no local activity model. Close the older console before starting this one.'}
}
$url='http://127.0.0.1:8092/ui/index.html#sensing'
if(-not $NoBrowser){Start-Process $url}
Write-Output $url
