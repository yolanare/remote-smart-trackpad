$ErrorActionPreference = 'Stop'
$executable = & (Join-Path $PSScriptRoot 'build-tray.ps1')
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
$port = if ($env:REMOTE_SMART_TRACKPAD_PORT) { $env:REMOTE_SMART_TRACKPAD_PORT } else { '8765' }
try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 1
    if ($status.app -eq 'remote-smart-trackpad') {
        Write-Host 'The server is already running. Stop the previous console host before starting the tray host.'
        exit 0
    }
} catch { }
Start-Process -FilePath $executable -WindowStyle Hidden
