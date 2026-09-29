param([ValidateSet('Enable', 'Disable', 'Status')][string]$Mode)
$ErrorActionPreference = 'Stop'
$name = 'Remote Smart Trackpad'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$executable = Join-Path (Split-Path -Parent $PSScriptRoot) '.data\RemoteSmartTrackpad.exe'
$current = Get-ItemPropertyValue -LiteralPath $key -Name $name -ErrorAction SilentlyContinue
Write-Host "Start with Windows: $(if ($current) { 'Enabled' } else { 'Disabled' })"
if ($Mode -eq 'Status') { exit 0 }
if (-not $Mode) {
    Write-Host '1. Enable  2. Disable  3. Exit'
    $Mode = switch (Read-Host 'Choose') { '1' { 'Enable' }; '2' { 'Disable' }; default { 'Status' } }
}
if ($Mode -eq 'Enable') {
    if (-not (Test-Path -LiteralPath $executable)) { throw 'Run Start Remote Smart Trackpad.cmd first.' }
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -LiteralPath $key -Name $name -Value ('"{0}"' -f $executable)
} elseif ($Mode -eq 'Disable') { Remove-ItemProperty -LiteralPath $key -Name $name -ErrorAction SilentlyContinue }
