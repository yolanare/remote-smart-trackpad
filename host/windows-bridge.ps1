$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Path (Join-Path $PSScriptRoot 'SessionEvents.cs') -ReferencedAssemblies @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.AutomationEvent].Assembly.Location)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeInput {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
    [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int Dx, Dy; public uint MouseData, Flags, Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KeyboardInput { public ushort VirtualKey, ScanCode; public uint Flags, Time; public IntPtr ExtraInfo; }
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    public static int InputSize { get { return Marshal.SizeOf(typeof(Input)); } }
    public static int LastError { get { return Marshal.GetLastWin32Error(); } }
    public static bool Key(int code, bool down) {
        bool extended = (code >= 0x21 && code <= 0x28) || code == 0x2C || code == 0x2D || code == 0x2E ||
            code == 0x5B || code == 0x5C || code == 0x5D || code == 0xA3 || code == 0xA5;
        uint flags = (down ? 0u : 2u) | (extended ? 1u : 0u);
        Input input = new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = (ushort)code, Flags = flags } } };
        return SendInput(1, new [] { input }, Marshal.SizeOf(typeof(Input))) == 1;
    }
    public static bool Text(string text) {
        foreach (char character in text) {
            if (character == '\n' || character == '\t') {
                int key = character == '\n' ? 0x0D : 0x09;
                if (!Key(key, true) || !Key(key, false)) return false;
                continue;
            }
            Input down = new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { ScanCode = character, Flags = 4 } } };
            Input up = down; up.Data.Keyboard.Flags = 6;
            if (SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(Input))) != 2) return false;
        }
        return true;
    }
    public static bool Mouse(uint flags, int data = 0) {
        Input input = new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = flags, MouseData = unchecked((uint)data) } } };
        return SendInput(1, new [] { input }, Marshal.SizeOf(typeof(Input))) == 1;
    }
}
'@

$keyCodes = @{
    Escape=0x1B; Tab=0x09; Control=0x11; Shift=0x10; Alt=0x12; AltGr=0xA5; Win=0x5B
    Left=0x25; Up=0x26; Right=0x27; Down=0x28; Delete=0x2E; Backspace=0x08
    Home=0x24; End=0x23; PageUp=0x21; PageDown=0x22; Insert=0x2D; Enter=0x0D
    Space=0x20; C=0x43; V=0x56; X=0x58; A=0x41; R=0x52
    F1=0x70; F2=0x71; F3=0x72; F4=0x73; F5=0x74; F6=0x75
    F7=0x76; F8=0x77; F9=0x78; F10=0x79; F11=0x7A; F12=0x7B
    F13=0x7C; F14=0x7D; F15=0x7E; F16=0x7F; F17=0x80; F18=0x81
    F19=0x82; F20=0x83; F21=0x84; F22=0x85; F23=0x86; F24=0x87
    PrintScreen=0x2C; ScrollLock=0x91; Pause=0x13; ContextMenu=0x5D
    VolumeUp=0xAF; VolumeDown=0xAE; VolumeMute=0xAD; PlayPause=0xB3
    B=0x42; D=0x44; E=0x45; F=0x46; G=0x47; H=0x48; I=0x49; J=0x4A
    K=0x4B; L=0x4C; M=0x4D; N=0x4E; O=0x4F; P=0x50; Q=0x51; S=0x53
    T=0x54; U=0x55; W=0x57; Y=0x59; Z=0x5A
}
$buttons = @{ left=@(0x0002,0x0004); right=@(0x0008,0x0010); middle=@(0x0020,0x0040) }
$held = New-Object 'System.Collections.Generic.HashSet[string]'
$session = $null

function Element-Index([int[]]$starts, [int]$position, [int]$textLength) {
    if ($position -eq $textLength) { return $starts.Length }
    $index = [Array]::BinarySearch($starts, $position)
    if ($index -lt 0) { throw 'Text operation splits a character' }
    return $index
}
function Normalize-LineEndings([string]$text) { return $text.Replace([Environment]::NewLine, [string][char]10).Replace([string][char]13, [string][char]10) }

function Send-Key($name, [bool]$down) {
    if (-not $keyCodes.ContainsKey($name)) { throw "Unsupported key: $name" }
    if (-not [NativeInput]::Key($keyCodes[$name], $down)) { throw 'Windows rejected keyboard input' }
}
function Tap-Key($name) {
    [void]$held.Add($name)
    try { Send-Key $name $true }
    finally {
        Send-Key $name $false
        [void]$held.Remove($name)
    }
}
function Release-All {
    foreach ($name in @($held)) {
        if ($buttons.ContainsKey($name)) { [void][NativeInput]::Mouse($buttons[$name][1]) }
        elseif ($keyCodes.ContainsKey($name)) { [void][NativeInput]::Key($keyCodes[$name], $false) }
        [void]$held.Remove($name)
    }
}
function Current-Selection {
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $element) { return $null }
    $pattern = $null
    if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { return $null }
    $ranges = $pattern.GetSelection()
    if ($null -eq $ranges -or $ranges.Count -ne 1) { return $null }
    return @{ element=$element; range=$ranges[0] }
}
function Check-Context {
    if ($null -eq $session) { throw 'No editing session' }
    $current = Current-Selection
    if ($null -eq $current -or -not $current.element.Equals($session.element)) { throw 'The PC text field changed. Mobile text is preserved.' }
    if ($null -eq $session.caret -or
        $current.range.CompareEndpoints([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, $session.caret, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start) -ne 0 -or
        $current.range.CompareEndpoints([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $session.caret, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::End) -ne 0) {
        throw 'The PC cursor moved. Mobile text is preserved.'
    }
    Verify-Buffer $current.range
}
function Verify-Buffer($selectionRange) {
    $expected = [string]$session.text
    if ($session.initialSelection) {
        $actual = $selectionRange.GetText(2 * $expected.Length + 1)
    } else {
        $range = $selectionRange.Clone()
        $before = Element-Index $session.elements ([int]$session.position) $expected.Length
        $after = $session.elements.Length - $before
        $startMoved = $range.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, -$before)
        $endMoved = $range.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, $after)
        if ($startMoved -ne -$before -or $endMoved -ne $after) { throw 'The PC text around the cursor changed. Mobile text is preserved.' }
        $actual = $range.GetText(2 * $expected.Length + 1)
    }
    $actual = Normalize-LineEndings $actual
    if ($actual -cne $expected) { throw 'The PC text differs from the mobile buffer. Mobile text is preserved.' }
}
function Set-Caret {
    $current = Current-Selection
    if ($null -eq $current) { throw 'PC cursor is unavailable' }
    $session.caret = $current.range.Clone()
}
function Move-Caret([int]$count) {
    if ($count -eq 0) { return }
    if ([Math]::Abs($count) -gt 32) {
        $current = Current-Selection
        if ($null -eq $current) { throw 'PC cursor is unavailable' }
        $target = $current.range.Clone()
        $target.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $target, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
        $moved = $target.Move([System.Windows.Automation.Text.TextUnit]::Character, $count)
        if ($moved -ne $count) { throw 'PC cursor could not reach the requested position' }
        $target.Select()
        return
    }
    $name = if ($count -lt 0) { 'Left' } else { 'Right' }
    for ($index = 0; $index -lt [Math]::Abs($count); $index++) { Tap-Key $name }
}
function Remove-Characters([int]$count) {
    if ($count -le 32) {
        for ($index = 0; $index -lt $count; $index++) { Tap-Key 'Delete' }
        return
    }
    $current = Current-Selection
    if ($null -eq $current) { throw 'PC cursor is unavailable' }
    $target = $current.range.Clone()
    $moved = $target.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, $count)
    if ($moved -ne $count) { throw 'PC text range could not be selected for deletion' }
    $target.Select()
    Tap-Key 'Delete'
}

while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $request = ConvertFrom-Json -InputObject $line
        $data = $request.data
        $result = $null
        switch ($request.action) {
            'move' {
                $point = New-Object NativeInput+Point
                [void][NativeInput]::GetCursorPos([ref]$point)
                if (-not [NativeInput]::SetCursorPos($point.X + [int]$data.dx, $point.Y + [int]$data.dy)) { throw 'Windows rejected pointer movement' }
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
                if ($null -ne $session -and $name -in @('Left','Right','Up','Down','Home','End','Backspace','Delete')) { throw 'Close the editor before moving the PC cursor or deleting outside the mobile buffer' }
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
                if ($null -ne $session -and $name -in @('Left','Right','Up','Down','Home','End','Backspace','Delete')) { throw 'Close the editor before moving the PC cursor or deleting outside the mobile buffer' }
                $down = [bool]$data.down
                if ($data.PSObject.Properties.Name -contains 'down') {
                    if ($down -and -not $held.Contains($name)) { Send-Key $name $true; [void]$held.Add($name) }
                    if (-not $down -and $held.Contains($name)) { Send-Key $name $false; [void]$held.Remove($name) }
                } else { Tap-Key $name }
            }
            'open' {
                $selection = Current-Selection
                if ($null -eq $selection) { throw 'The active PC field does not expose a text selection' }
                $selected = $selection.range.GetText(4097)
                if ($selected.Length -gt 4096 -and -not [bool]$data.allowLarge) {
                    $result = @{ requiresConfirmation=$true }
                } else {
                    if ($selected.Length -gt 4096) {
                        $selected = $selection.range.GetText(2097153)
                        if ($selected.Length -ge 2097153) { throw 'Selection exceeds 1 MiB. Reduce it before opening the editor.' }
                    }
                    $selected = Normalize-LineEndings $selected
                    if ([System.Text.Encoding]::UTF8.GetByteCount($selected) -gt 1048576) { throw 'Selection exceeds 1 MiB. Reduce it before opening the editor.' }
                    $events = New-Object SessionEvents($selection.element)
                    if ($null -ne $session) { $session.events.Dispose() }
                    $session = @{ id=[guid]::NewGuid().ToString('N'); element=$selection.element; caret=$selection.range.Clone(); text=$selected; elements=[System.Globalization.StringInfo]::ParseCombiningCharacters($selected); position=$selected.Length; initialSelection=($selected.Length -gt 0); lastOperation=$null; uncertain=$false; events=$events; verifiedRevision=-1 }
                    $result = @{ session=$session.id; text=$selected; mode=if ($selected.Length) { 'selection' } else { 'insertion' }; eventSubscriptions=@{ text=$events.TextSubscribed; selection=$events.SelectionSubscribed; focus=$events.FocusSubscribed } }
                }
            }
            'inspect' {
                if ($null -eq $session -or [string]$data.session -cne $session.id) { throw 'The editing session is no longer available. Mobile text is preserved.' }
                $operationId = [string]$data.operationId
                $state = if ($session.uncertain) { 'uncertain' } elseif ($session.lastOperation -ceq $operationId) { 'applied' } else { 'not-applied' }
                if ($state -ne 'uncertain') {
                    try { Check-Context } catch { $state = 'context-changed' }
                }
                $result = @{ state=$state; session=$session.id; position=$session.position }
                if ([bool]$data.includeText) { $result.text = $session.text }
            }
            'observe' {
                if ($null -eq $session -or [string]$data.session -cne $session.id) { throw 'The editing session is no longer available. Mobile text is preserved.' }
                $eventRevision = $session.events.Revision
                $current = Current-Selection
                if ($null -eq $current -or -not $current.element.Equals($session.element)) {
                    $result = @{ state='field-changed' }
                } else {
                    $startChanged = $current.range.CompareEndpoints([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, $session.caret, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start) -ne 0
                    $endChanged = $current.range.CompareEndpoints([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $session.caret, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::End) -ne 0
                    if (-not $startChanged -and -not $endChanged) {
                        try {
                            if ([bool]$data.verify -or $eventRevision -ne $session.verifiedRevision) {
                                Verify-Buffer $current.range
                                $session.verifiedRevision = $eventRevision
                            }
                            $result = @{ state='same' }
                        }
                        catch { $result = @{ state='diverged' } }
                    }
                    else {
                        $selected = $current.range.GetText(4097)
                        if ($selected.Length -gt 4096) { $result = @{ state='selection-too-large' } }
                        elseif ($selected.Length) { $result = @{ state='selection-changed'; text=$selected } }
                        else { $result = @{ state='cursor-changed' } }
                    }
                }
            }
            'edit' {
                if ($null -eq $session -or [string]$data.session -cne $session.id) { throw 'The editing session is no longer available. Mobile text is preserved.' }
                $operationId = [string]$data.operationId
                if ([string]::IsNullOrWhiteSpace($operationId)) { throw 'Missing text operation identifier' }
                if ($session.lastOperation -ceq $operationId) { $result = @{ position=$session.position; duplicate=$true }; break }
                if ($session.uncertain) { throw 'A previous text operation has an uncertain result. Mobile text is preserved.' }
                Check-Context
                $old = [string]$session.text
                $start = [int]$data.start
                $end = [int]$data.end
                $insert = [string]$data.text
                $position = [int]$data.position
                if ($start -lt 0 -or $end -lt $start -or $end -gt $old.Length -or $insert.Length -gt 16384) { throw 'Invalid text operation' }
                $next = $old.Substring(0, $start) + $insert + $old.Substring($end)
                if ([System.Text.Encoding]::UTF8.GetByteCount($next) -gt 1048576 -or $position -lt 0 -or $position -gt $next.Length) { throw 'Mobile buffer limit exceeded (1 MiB)' }
                $startElements = Element-Index $session.elements $start $old.Length
                $endElements = Element-Index $session.elements $end $old.Length
                $remove = $endElements - $startElements
                $nextElements = [System.Globalization.StringInfo]::ParseCombiningCharacters($next)
                $targetPosition = Element-Index $nextElements $position $next.Length
                $insertElements = [System.Globalization.StringInfo]::ParseCombiningCharacters($insert).Length
                $session.uncertain = $true
                if ($session.initialSelection) {
                    if ($start -eq 0 -and $end -eq $old.Length) {
                        if ($insert.Length) { if (-not [NativeInput]::Text($insert)) { throw 'Windows rejected text input' } }
                        else { Tap-Key 'Delete' }
                        Move-Caret ($targetPosition - $insertElements)
                    } else {
                        Tap-Key 'Left'
                        Move-Caret $startElements
                        Remove-Characters $remove
                        if ($insert.Length -and -not [NativeInput]::Text($insert)) { throw 'Windows rejected text input' }
                        Move-Caret ($targetPosition - $startElements - $insertElements)
                    }
                    $session.initialSelection = $false
                } else {
                    $oldCaret = Element-Index $session.elements ([int]$session.position) $old.Length
                    Move-Caret ($startElements - $oldCaret)
                    Remove-Characters $remove
                    if ($insert.Length -and -not [NativeInput]::Text($insert)) { throw 'Windows rejected text input' }
                    Move-Caret ($targetPosition - $startElements - $insertElements)
                }
                $session.text = $next
                $session.elements = $nextElements
                $session.position = $position
                Set-Caret
                Verify-Buffer $session.caret
                $session.lastOperation = $operationId
                $session.uncertain = $false
                $result = @{ position=$position }
            }
            'close' { if ($null -ne $session) { $session.events.Dispose() }; $session = $null; Release-All }
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
if ($null -ne $session) { $session.events.Dispose() }
