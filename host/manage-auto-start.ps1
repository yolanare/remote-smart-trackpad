param([ValidateSet('Enable', 'Disable', 'Status')][string]$Mode)
$ErrorActionPreference = 'Stop'
$taskName = 'Remote Smart Trackpad'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workerPath = Join-Path $PSScriptRoot 'run-at-logon.ps1'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($existing -and -not $existing.Actions[0].Arguments.Contains('run-at-logon.ps1')) {
    throw "A different scheduled task already uses the name '$taskName'."
}
Write-Host "Remote Smart Trackpad - automatic start at Windows sign-in"
Write-Host "Account: $identity"
Write-Host "Current status: $(if ($existing) { 'Enabled' } else { 'Disabled' })"
Write-Host ''
$choice = if ($Mode) { @{ Enable='1'; Disable='2'; Status='3' }[$Mode] } else {
    Write-Host '1. Enable automatic start'
    Write-Host '2. Disable automatic start'
    Write-Host '3. Exit'
    Read-Host 'Choose 1, 2 or 3'
}

try {
    switch ($choice) {
        '1' {
            $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
            $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NodePath "{1}"' -f $workerPath, $nodePath
            $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments -WorkingDirectory $projectRoot
            $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
            $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
            $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
            Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start Remote Smart Trackpad in the current user desktop session.' -Force | Out-Null
            Write-Host 'Automatic start enabled. Starting the host now...'
            Start-ScheduledTask -TaskName $taskName -TaskPath '\'
        }
        '2' {
            if ($existing) {
                Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false
                Write-Host 'Automatic start disabled. Stop an already running host separately if desired.'
            } else { Write-Host 'Automatic start is already disabled.' }
        }
        '3' { exit 0 }
        default { throw 'Choose 1, 2 or 3.' }
    }
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
