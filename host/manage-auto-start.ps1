param([ValidateSet('Enable', 'Disable', 'Status')][string]$Mode)
$ErrorActionPreference = 'Stop'
$taskName = 'Remote Smart Trackpad'
$taskDescription = 'Start Remote Smart Trackpad in the current user desktop session.'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workerPath = Join-Path $PSScriptRoot 'run-at-logon.ps1'
$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($existing) {
    $action = @($existing.Actions)[0]
    $workerArgument = '-File "{0}"' -f $workerPath
    if ($existing.Description -ne $taskDescription -or
        @($existing.Actions).Count -ne 1 -or
        $action.Execute -ne $powerShellPath -or
        $action.WorkingDirectory -ne $projectRoot -or
        $action.Arguments.IndexOf($workerArgument, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $existing.Principal.UserId -notin @($identity, $userSid) -or
        $existing.Principal.LogonType -ne 'Interactive') {
        throw "A different scheduled task already uses the name '$taskName'."
    }
}
Write-Host "Remote Smart Trackpad - automatic start at Windows sign-in"
Write-Host "Account: $identity"
Write-Host "Current status: $(if (-not $existing) { 'Disabled' } elseif ($existing.State -eq 'Disabled') { 'Disabled in Task Scheduler' } else { 'Enabled' })"
Write-Host ''
if ($Mode -eq 'Status') { exit 0 }
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
            if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\multicast-dns\package.json') -PathType Leaf)) {
                $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
                Push-Location -LiteralPath $projectRoot
                try {
                    & $npmPath ci --omit=dev
                    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
                } finally { Pop-Location }
            }
            $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NodePath "{1}"' -f $workerPath, $nodePath
            $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $projectRoot
            $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
            $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
            $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
            Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $taskDescription -Force | Out-Null
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
