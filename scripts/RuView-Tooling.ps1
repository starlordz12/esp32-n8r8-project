Set-StrictMode -Version Latest

function Resolve-RuViewPython {
    foreach ($candidate in @('py', 'python3', 'python')) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            $prefixArguments = if ($candidate -eq 'py') { @('-3') } else { @() }
            return [pscustomobject]@{
                Path = $command.Source
                PrefixArguments = $prefixArguments
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
