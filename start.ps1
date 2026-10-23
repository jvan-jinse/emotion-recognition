$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeCandidates = @(
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'),
    (Join-Path $env:USERPROFILE 'anaconda3\python.exe')
)
$pythonRuntime = $runtimeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pythonRuntime) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) { $pythonRuntime = $pythonCommand.Source }
}
if (-not $pythonRuntime) {
    Write-Host 'Python 3.10+ is required. Install Python and run start.cmd again.'
    Read-Host 'Press Enter to exit'
    exit 1
}
& $pythonRuntime (Join-Path $PSScriptRoot 'server.py') --open
if ($LASTEXITCODE -ne 0) { Read-Host 'Press Enter to exit' }
