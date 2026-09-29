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
$env:REMOTE_SMART_TRACKPAD_DATA_DIRECTORY = Join-Path $projectRoot ('.data\tray-check-' + [guid]::NewGuid().ToString('N'))
$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'Remote Smart Trackpad'
$previousStartup = Get-ItemPropertyValue -LiteralPath $registryPath -Name $startupName -ErrorAction SilentlyContinue
$context = $null
function Assert($condition, $message) { if (-not $condition) { throw $message } }
try {
    Assert (Test-Path -LiteralPath (Join-Path $projectRoot '.data\tray-initialized')) 'Run the normal tray once before this integration check'
    $context = $type.GetConstructor([type[]]@([string])).Invoke([object[]]@([string]$projectRoot))
    $tray = $type.GetField('tray', $flags).GetValue($context)
    $console = $type.GetField('console', $flags).GetValue($context)
    $server = $type.GetField('server', $flags).GetValue($context)
    Assert ($tray.Visible -and -not $console.Visible) 'Tray should start with its console hidden'
    Assert ($server.StartInfo.CreateNoWindow -and -not $server.StartInfo.UseShellExecute) 'Server must be launched without a console window'
    $ready = $false
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        [Windows.Forms.Application]::DoEvents()
        try { $state = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 1; $ready = $state.app -eq 'remote-smart-trackpad'; if ($ready) { break } } catch { }
        Start-Sleep -Milliseconds 100
    }
    Assert $ready 'Tray-owned server did not start'
    $tray.ContextMenuStrip.Items[0].PerformClick()
    [Windows.Forms.Application]::DoEvents()
    Assert $console.Visible 'Show console menu item did not show the console'
    $console.Close()
    Assert (-not $console.Visible -and -not $server.HasExited) 'Closing the console should keep the server running'
    $startup = $tray.ContextMenuStrip.Items[2]
    $before = $startup.Checked
    $startup.PerformClick()
    Assert ($startup.Checked -ne $before) 'Startup checkbox did not toggle'
    $startup.PerformClick()
    Assert ($startup.Checked -eq $before) 'Startup checkbox did not restore its state'
    $tray.ContextMenuStrip.Items[4].PerformClick()
    $context = $null
    $responding = $false
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 1 | Out-Null; $responding = $true } catch { }
    Assert (-not $responding) 'Stop server menu left a listener running'
    $report = @{ hiddenLaunch=$true; serverReady=$true; showConsole=$true; hideConsole=$true; startupToggle=$true; stopServer=$true }
    $report | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $projectRoot '.data\tray-report.json')
    $report | ConvertTo-Json -Compress
} finally {
    if ($null -ne $context) { $context.ExitThread(); $context.Dispose() }
    if ($null -ne $previousStartup) { Set-ItemProperty -LiteralPath $registryPath -Name $startupName -Value $previousStartup }
    else { Remove-ItemProperty -LiteralPath $registryPath -Name $startupName -ErrorAction SilentlyContinue }
}
