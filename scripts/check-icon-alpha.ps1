Add-Type -AssemblyName System.Drawing
$path = Join-Path $PSScriptRoot '../web/icon.ico'
foreach ($size in @(16,24,32,48,64,128)) {
    $icon = New-Object Drawing.Icon($path,$size,$size)
    $bitmap = $icon.ToBitmap()
    try {
        foreach ($point in @(@(0,0),@(($size-1),0),@(0,($size-1)),@(($size-1),($size-1)))) {
            if ($bitmap.GetPixel($point[0],$point[1]).A -ne 0) { throw "Opaque corner in ${size}px icon" }
        }
    } finally { $bitmap.Dispose(); $icon.Dispose() }
}
Write-Output 'Windows icon transparency: PASS'
