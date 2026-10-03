$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$data = Join-Path $projectRoot '.data'
New-Item -ItemType Directory -Path $data -Force | Out-Null
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
[IO.File]::WriteAllText((Join-Path $data 'node-path.txt'), $nodePath)
$source = Join-Path $PSScriptRoot 'TrayHost.cs'
$output = Join-Path $data 'RemoteSmartTrackpad.exe'
$iconPath = Join-Path $projectRoot 'web\assets\icons\icon.ico'
if (-not (Test-Path -LiteralPath $output) -or
    (Get-Item -LiteralPath $source).LastWriteTimeUtc -gt (Get-Item -LiteralPath $output).LastWriteTimeUtc -or
    (Get-Item -LiteralPath $iconPath).LastWriteTimeUtc -gt (Get-Item -LiteralPath $output).LastWriteTimeUtc) {
    $compiler = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
    & $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/win32icon:$iconPath" "/out:$output" $source
    if ($LASTEXITCODE -ne 0) { throw 'Tray compilation failed. Stop an existing tray instance before rebuilding.' }
}
Write-Output $output
