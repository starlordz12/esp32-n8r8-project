Set-StrictMode -Version Latest

function Resolve-RuViewPython {
    foreach ($candidate in @('py', 'python3', 'python')) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            $prefixArguments = if ($candidate -eq 'py') { @('-3') } else { @() }
            try {
                $versionOutput = (& $command.Source @prefixArguments --version 2>&1 | Out-String).Trim()
                if ($LASTEXITCODE -eq 0 -and $versionOutput -match '^Python (\d+)\.(\d+)') {
                    $major = [int]$Matches[1]
                    $minor = [int]$Matches[2]
                    if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 10)) {
                        return [pscustomobject]@{
                            Path = $command.Source
                            PrefixArguments = $prefixArguments
                        }
                    }
                }
            }
            catch {
                continue
            }
        }
    }
    throw 'Python 3.10 or later is required and was not found on PATH.'
}

function Invoke-RuViewPython {
    param(
        [Parameter(Mandatory)]
        $Python,
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $prefixArguments = @($Python.PrefixArguments)
    & $Python.Path @prefixArguments @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed with exit code $LASTEXITCODE."
    }
}
