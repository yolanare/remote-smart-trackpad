# Restarts the server the tray runs, with the code as it is now (host and bridge changes apply); phones reconnect on
# their own. Waits until the new server answers. Used by `npm restart`; the tray menu's Restart server does the same.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tray = Join-Path $projectRoot '.data\RemoteSmartTrackpad.exe'
$port = if ($env:REMOTE_SMART_TRACKPAD_PORT) { $env:REMOTE_SMART_TRACKPAD_PORT } else { '8765' }
$server = Join-Path $projectRoot 'host\server.js'
function Get-ServerIds {
    @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($server, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | ForEach-Object { $_.ProcessId })
}
if (-not (Test-Path -LiteralPath $tray)) { throw 'No tray built yet: start it with host/tray/start-tray.ps1.' }
$before = Get-ServerIds
$signal = Start-Process -FilePath $tray -ArgumentList '--restart' -Wait -PassThru
if ($signal.ExitCode -ne 0) { throw 'The tray is not running: start it with host/tray/start-tray.ps1.' }
# The old server leaves first (up to 5 s for a graceful stop), then the new one listens.
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 250
    $now = Get-ServerIds
    if (@($now | Where-Object { $_ -notin $before }).Count -eq 0) { continue }
    try {
        $state = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 1
        if ($state.app -eq 'remote-smart-trackpad') { Write-Output "Server restarted (port $port)."; exit 0 }
    } catch { }
}
throw "The server did not answer after the restart: see Show console in the tray menu."
