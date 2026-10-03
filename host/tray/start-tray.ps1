$ErrorActionPreference = 'Stop'
$legacy = Get-ScheduledTask -TaskName 'Remote Smart Trackpad' -TaskPath '\' -ErrorAction SilentlyContinue
if ($legacy) {
    $legacyWorker = Join-Path $PSScriptRoot 'run-at-logon.ps1'
    if ($legacy.Description -ne 'Start Remote Smart Trackpad in the current user desktop session.' -or
        @($legacy.Actions).Count -ne 1 -or $legacy.Actions[0].Arguments.IndexOf($legacyWorker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'An unrelated scheduled task uses the same name. It has not been changed.'
    }
    Stop-ScheduledTask -TaskName $legacy.TaskName -TaskPath '\'
    Unregister-ScheduledTask -TaskName $legacy.TaskName -TaskPath '\' -Confirm:$false
    Start-Sleep -Milliseconds 500
}
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# Launching again restarts: stop this checkout's tray and server first (the tray exe is locked while it runs).
function Get-HostProcesses {
    $tray = Join-Path $projectRoot '.data\RemoteSmartTrackpad.exe'
    $server = Join-Path $projectRoot 'host\server.js'
    $bridge = Join-Path $projectRoot 'host\windows\windows-bridge.ps1'
    Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath -ieq $tray) -or
        ($_.CommandLine -and ($_.CommandLine.IndexOf($server, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $_.CommandLine.IndexOf($bridge, [StringComparison]::OrdinalIgnoreCase) -ge 0))
    }
}
$running = @(Get-HostProcesses)
if ($running.Count) {
    Write-Host 'Restarting Remote Smart Trackpad...'
    $tray = Join-Path $projectRoot '.data\RemoteSmartTrackpad.exe'
    # Graceful: the tray tells the server to release held input and exit.
    if (Test-Path -LiteralPath $tray) { Start-Process -FilePath $tray -ArgumentList '--stop' -Wait }
    for ($attempt = 0; $attempt -lt 30 -and @(Get-HostProcesses).Count; $attempt++) { Start-Sleep -Milliseconds 250 }
    # Older trays without --stop, or a foreground `npm start` server, are ended directly.
    Get-HostProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
}
$executable = & (Join-Path $PSScriptRoot 'build-tray.ps1')
Start-Process -FilePath $executable -WindowStyle Hidden
