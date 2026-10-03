$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot '.data\RemoteSmartTrackpad.exe'
$assembly = [Reflection.Assembly]::LoadFile($executable)
$type = $assembly.GetType('HostContext')
$flags = [Reflection.BindingFlags]'Instance,NonPublic'
$reservation = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$reservation.Start()
$port = $reservation.LocalEndpoint.Port
$reservation.Stop()
$env:REMOTE_SMART_TRACKPAD_PORT = [string]$port
# Throwaway data and the report go to the system temp folder, which the OS cleans up.
$env:REMOTE_SMART_TRACKPAD_DATA_DIRECTORY = Join-Path ([IO.Path]::GetTempPath()) ('remote-smart-trackpad-tray-check-' + [guid]::NewGuid().ToString('N'))
$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'Remote Smart Trackpad'
$previousStartup = Get-ItemPropertyValue -LiteralPath $registryPath -Name $startupName -ErrorAction SilentlyContinue
$context = $null
function Assert($condition, $message) { if (-not $condition) { throw $message } }
# Menu items by their label: their order changes as the menu grows.
function Find-MenuItem($label) { $tray.ContextMenuStrip.Items | Where-Object { $_.Text -eq $label } | Select-Object -First 1 }
function Wait-Server {
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        [Windows.Forms.Application]::DoEvents()
        try { $state = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 1; if ($state.app -eq 'remote-smart-trackpad') { return $true } } catch { }
        Start-Sleep -Milliseconds 100
    }
    return $false
}
try {
    Assert (Test-Path -LiteralPath (Join-Path $projectRoot '.data\tray-initialized')) 'Run the normal tray once before this integration check'
    $stopSignal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset)
    $restartSignal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset)
    $context = $type.GetConstructor([type[]]@([string], [Threading.WaitHandle], [Threading.WaitHandle])).Invoke([object[]]@([string]$projectRoot, [Threading.WaitHandle]$stopSignal, [Threading.WaitHandle]$restartSignal))
    $tray = $type.GetField('tray', $flags).GetValue($context)
    $console = $type.GetField('console', $flags).GetValue($context)
    $server = $type.GetField('server', $flags).GetValue($context)
    Assert ($tray.Visible -and $null -eq $console) 'Tray should start without a console process'
    Assert ($server.StartInfo.CreateNoWindow -and -not $server.StartInfo.UseShellExecute) 'Server must be launched without a console window'
    Assert (Wait-Server) 'Tray-owned server did not start'
    (Find-MenuItem 'Show console').PerformClick()
    [Windows.Forms.Application]::DoEvents()
    $console = $type.GetField('console', $flags).GetValue($context)
    Assert ($null -ne $console -and -not $console.HasExited -and -not $console.StartInfo.CreateNoWindow) 'Show console should launch a native console'
    (Find-MenuItem 'Show console').PerformClick()
    Assert ($type.GetField('console', $flags).GetValue($context).Id -eq $console.Id) 'Show console should reuse the existing console'
    $console.Kill()
    $console.WaitForExit()
    Assert (-not $server.HasExited) 'Closing the console should keep the server running'
    (Find-MenuItem 'Show console').PerformClick()
    $console = $type.GetField('console', $flags).GetValue($context)
    Assert (-not $console.HasExited) 'Console should reopen after closing'
    $startup = Find-MenuItem 'Start with Windows'
    $before = $startup.Checked
    $startup.PerformClick()
    Assert ($startup.Checked -ne $before) 'Startup checkbox did not toggle'
    $startup.PerformClick()
    Assert ($startup.Checked -eq $before) 'Startup checkbox did not restore its state'
    # Restart: a fresh server process answers in its place.
    $firstServer = $server.Id
    (Find-MenuItem 'Restart server').PerformClick()
    Assert (Wait-Server) 'The restarted server did not answer'
    $server = $type.GetField('server', $flags).GetValue($context)
    Assert ($server.Id -ne $firstServer -and -not $server.HasExited) 'Restart server must run a new server process'
    # The same from outside (npm restart signals the running tray).
    $restartSignal.Set() | Out-Null
    for ($attempt=0; $attempt -lt 80 -and $type.GetField('server', $flags).GetValue($context).Id -eq $server.Id; $attempt++) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    Assert ($type.GetField('server', $flags).GetValue($context).Id -ne $server.Id) 'The restart signal must restart the server'
    Assert (Wait-Server) 'The server restarted by the signal did not answer'
    (Find-MenuItem 'Stop server').PerformClick()
    $context = $null
    $responding = $false
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 1 | Out-Null; $responding = $true } catch { }
    Assert (-not $responding) 'Stop server menu left a listener running'
    $report = @{ hiddenLaunch=$true; serverReady=$true; showConsole=$true; hideConsole=$true; startupToggle=$true; restartServer=$true; restartSignal=$true; stopServer=$true }
    $reportPath = Join-Path ([IO.Path]::GetTempPath()) 'remote-smart-trackpad-tray-report.json'
    $report | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $reportPath
    Write-Output "Report: $reportPath"
    $report | ConvertTo-Json -Compress
} finally {
    if ($null -ne $context) { $context.ExitThread(); $context.Dispose() }
    if ($null -ne $previousStartup) { Set-ItemProperty -LiteralPath $registryPath -Name $startupName -Value $previousStartup }
    else { Remove-ItemProperty -LiteralPath $registryPath -Name $startupName -ErrorAction SilentlyContinue }
}
