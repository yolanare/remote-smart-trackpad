[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'windows-input.ps1')
while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $request = ConvertFrom-Json -InputObject $line
        $data = $request.data
        $result = $null
        switch ($request.action) {
            'move' {
                if (-not [NativeInput]::MoveBy([int]$data.dx, [int]$data.dy)) { throw 'Windows rejected pointer movement' }
            }
            'click' {
                $name = [string]$data.button
                if (-not $buttons.ContainsKey($name)) { throw 'Unsupported mouse button' }
                $times = if ($data.double) { 2 } else { 1 }
                for ($index = 0; $index -lt $times; $index++) {
                    if (-not [NativeInput]::Mouse($buttons[$name][0]) -or -not [NativeInput]::Mouse($buttons[$name][1])) { throw 'Windows rejected mouse input' }
                }
            }
            'button' {
                $name = [string]$data.button
                if (-not $buttons.ContainsKey($name)) { throw 'Unsupported mouse button' }
                $down = [bool]$data.down
                if ($down -and $held.Contains($name)) { break }
                if (-not $down -and -not $held.Contains($name)) { break }
                if (-not [NativeInput]::Mouse($buttons[$name][[int](-not $down)])) { throw 'Windows rejected mouse button' }
                if ($down) { [void]$held.Add($name) } else { [void]$held.Remove($name) }
            }
            'scroll' {
                if ([int]$data.dy -ne 0 -and -not [NativeInput]::Mouse(0x0800, -[int]$data.dy)) { throw 'Windows rejected scroll input' }
                if ([int]$data.dx -ne 0 -and -not [NativeInput]::Mouse(0x1000, [int]$data.dx)) { throw 'Windows rejected horizontal scroll' }
            }
            'shortcut' {
                $name = [string]$data.key
                if (-not $keyCodes.ContainsKey($name)) { throw "Unsupported key: $name" }
                $modifiers = @($data.modifiers)
                if ($modifiers.Count -gt 5) { throw 'Too many shortcut modifiers' }
                foreach ($modifier in $modifiers) {
                    if ($modifier -notin @('Control','Shift','Alt','AltGr','Win')) { throw 'Unsupported shortcut modifier' }
                }
                $pressed = New-Object 'System.Collections.Generic.List[string]'
                try {
                    foreach ($modifier in $modifiers) {
                        if ($held.Contains($modifier)) { continue }
                        $pressed.Add($modifier)
                        [void]$held.Add($modifier)
                        Send-Key $modifier $true
                    }
                    Tap-Key $name
                } finally {
                    $releaseFailed = $false
                    for ($index = $pressed.Count - 1; $index -ge 0; $index--) {
                        $modifier = $pressed[$index]
                        if ([NativeInput]::Key($keyCodes[$modifier], $false)) { [void]$held.Remove($modifier) }
                        else { $releaseFailed = $true }
                    }
                    if ($releaseFailed) { throw 'Windows rejected shortcut key release' }
                }
            }
            'key' {
                $name = [string]$data.key
                $down = [bool]$data.down
                if ($data.PSObject.Properties.Name -contains 'down') {
                    if ($down -and -not $held.Contains($name)) { Send-Key $name $true; [void]$held.Add($name) }
                    if (-not $down -and $held.Contains($name)) { Send-Key $name $false; [void]$held.Remove($name) }
                } else { Tap-Key $name }
            }
            'text' {
                # Raw typing for PC focus without a readable text field.
                $backspaces = [int]$data.backspace; $deletes = [int]$data.delete; $value = [string]$data.text
                if ($backspaces -lt 0 -or $deletes -lt 0 -or $backspaces + $deletes -gt 4096 -or $value.Length -gt 16384) { throw 'Invalid text operation' }
                for ($index = 0; $index -lt $backspaces; $index++) { Tap-Key 'Backspace' }
                for ($index = 0; $index -lt $deletes; $index++) { Tap-Key 'Delete' }
                if ($value.Length) {
                    try { Insert-Text $value; Start-Sleep -Milliseconds 150 } finally { [ClipboardText]::Restore() }
                }
            }
            'media-state' { $result = Get-MediaState }
            'mirror-read' {
                $result = Read-Mirror
                if ($result.available -and $result.session -ceq [string]$data.session -and $result.revision -eq $data.revision) { $result = @{ unchanged=$true } }
            }
            'mirror-edit' { $result = Edit-Mirror $data }
            'mirror-close' { $script:mirror = $null }
            'release' { Release-All }
            default { throw 'Unknown command' }
        }
        @{ id=$request.id; ok=$true; result=$result } | ConvertTo-Json -Compress -Depth 5
    } catch {
        $errorCode = if ($_.Exception.Message -like 'The editing session is no longer available*') { 'session_gone' }
                     elseif ($_.Exception.Message -like 'Invalid text operation*' -or $_.Exception.Message -like 'Mobile buffer limit exceeded*') { 'invalid_operation' }
                     else { 'windows_error' }
        @{ id=$request.id; ok=$false; error=$_.Exception.Message; code=$errorCode } | ConvertTo-Json -Compress -Depth 5
    }
}
Release-All
