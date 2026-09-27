param([Parameter(Mandatory = $true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $PSScriptRoot 'server.js'
$dataDirectory = Join-Path $projectRoot '.data'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$logPath = Join-Path $dataDirectory 'auto-start.log'

try {
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js executable not found: $NodePath" }
    Set-Location -LiteralPath $projectRoot
    $port = if ($env:REMOTE_SMART_TRACKPAD_PORT) { $env:REMOTE_SMART_TRACKPAD_PORT } else { '8765' }
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 2
        if ($status.app -eq 'remote-smart-trackpad') { exit 0 }
    } catch { }
    & $NodePath $serverPath *>> $logPath
    exit $LASTEXITCODE
} catch {
    "$(Get-Date -Format o) $($_.Exception.Message)" | Add-Content -LiteralPath $logPath
    exit 1
}
