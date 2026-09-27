$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeInput {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
    [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int Dx, Dy; public uint MouseData, Flags, Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KeyboardInput { public ushort VirtualKey, ScanCode; public uint Flags, Time; public IntPtr ExtraInfo; }
    [DllImport("user32.dll")] public static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    public static bool Key(int code, bool down) {
        Input input = new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = (ushort)code, Flags = down ? 0u : 2u } } };
        return SendInput(1, new [] { input }, Marshal.SizeOf(typeof(Input))) == 1;
    }
    public static bool Text(string text) {
        foreach (char character in text) {
            Input down = new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { ScanCode = character, Flags = 4 } } };
            Input up = down; up.Data.Keyboard.Flags = 6;
            if (SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(Input))) != 2) return false;
        }
        return true;
    }
    public static bool Mouse(uint flags, uint data = 0) {
        Input input = new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = flags, MouseData = data } } };
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
    VolumeUp=0xAF; VolumeDown=0xAE; VolumeMute=0xAD; PlayPause=0xB3
    B=0x42; D=0x44; E=0x45; F=0x46; G=0x47; H=0x48; I=0x49; J=0x4A
    K=0x4B; L=0x4C; M=0x4D; N=0x4E; O=0x4F; P=0x50; Q=0x51; S=0x53
    T=0x54; U=0x55; W=0x57; Y=0x59; Z=0x5A
}
$buttons = @{ left=@(0x0002,0x0004); right=@(0x0008,0x0010); middle=@(0x0020,0x0040) }
$held = New-Object 'System.Collections.Generic.HashSet[string]'
$session = $null

function Text-Elements([string]$text) { return [System.Globalization.StringInfo]::ParseCombiningCharacters($text) }

function Send-Key($name, [bool]$down) {
    if (-not $keyCodes.ContainsKey($name)) { throw "Unsupported key: $name" }
    if (-not [NativeInput]::Key($keyCodes[$name], $down)) { throw 'Windows rejected keyboard input' }
}
function Tap-Key($name) { Send-Key $name $true; Send-Key $name $false }
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
    if ($null -eq $session.caret -or -not $current.range.CompareEndpoints([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, $session.caret, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start).Equals(0)) {
        throw 'The PC cursor moved. Mobile text is preserved.'
    }
}
function Set-Caret {
    $current = Current-Selection
    if ($null -eq $current) { throw 'PC cursor is unavailable' }
    $session.caret = $current.range.Clone()
}
function Move-Caret([int]$count) {
    $name = if ($count -lt 0) { 'Left' } else { 'Right' }
    for ($index = 0; $index -lt [Math]::Abs($count); $index++) { Tap-Key $name }
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
                if ([int]$data.dy -ne 0 -and -not [NativeInput]::Mouse(0x0800, [uint32][int](-[int]$data.dy))) { throw 'Windows rejected scroll input' }
                if ([int]$data.dx -ne 0 -and -not [NativeInput]::Mouse(0x1000, [uint32][int]$data.dx)) { throw 'Windows rejected horizontal scroll' }
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
                    if ($selected.Length -gt 4096) { $selected = $selection.range.GetText(16385) }
                    if ($selected.Length -gt 16384) { throw 'Selection exceeds 16384 characters. Reduce it before opening the editor.' }
                    $session = @{ element=$selection.element; caret=$selection.range.Clone(); text=$selected; position=$selected.Length; initialSelection=($selected.Length -gt 0) }
                    $result = @{ text=$selected; mode=if ($selected.Length) { 'selection' } else { 'insertion' } }
                }
            }
            'edit' {
                Check-Context
                $next = [string]$data.text
                $position = [int]$data.position
                if ($next.Length -gt 16384 -or $position -lt 0 -or $position -gt $next.Length) { throw 'Mobile buffer limit exceeded' }
                $old = [string]$session.text
                $oldElements = @(Text-Elements $old)
                $nextElements = @(Text-Elements $next)
                $targetPosition = @(Text-Elements $next.Substring(0, $position)).Count
                if ($session.initialSelection) {
                    if ($next.Length) { if (-not [NativeInput]::Text($next)) { throw 'Windows rejected text input' } }
                    else { Tap-Key 'Delete' }
                    Move-Caret ($targetPosition - $nextElements.Count)
                    $session.initialSelection = $false
                } else {
                    $prefix = 0
                    while ($prefix -lt [Math]::Min($oldElements.Count, $nextElements.Count)) {
                        $oldStart = $oldElements[$prefix]
                        $nextStart = $nextElements[$prefix]
                        $oldEnd = if ($prefix + 1 -lt $oldElements.Count) { $oldElements[$prefix + 1] } else { $old.Length }
                        $nextEnd = if ($prefix + 1 -lt $nextElements.Count) { $nextElements[$prefix + 1] } else { $next.Length }
                        if ($old.Substring($oldStart, $oldEnd - $oldStart) -cne $next.Substring($nextStart, $nextEnd - $nextStart)) { break }
                        $prefix++
                    }
                    $suffix = 0
                    while ($suffix -lt [Math]::Min($oldElements.Count, $nextElements.Count) - $prefix) {
                        $oldIndex = $oldElements.Count - 1 - $suffix
                        $nextIndex = $nextElements.Count - 1 - $suffix
                        $oldEnd = if ($oldIndex + 1 -lt $oldElements.Count) { $oldElements[$oldIndex + 1] } else { $old.Length }
                        $nextEnd = if ($nextIndex + 1 -lt $nextElements.Count) { $nextElements[$nextIndex + 1] } else { $next.Length }
                        if ($old.Substring($oldElements[$oldIndex], $oldEnd - $oldElements[$oldIndex]) -cne $next.Substring($nextElements[$nextIndex], $nextEnd - $nextElements[$nextIndex])) { break }
                        $suffix++
                    }
                    $remove = $oldElements.Count - $prefix - $suffix
                    $insertStart = if ($prefix -lt $nextElements.Count) { $nextElements[$prefix] } else { $next.Length }
                    $insertEnd = if ($suffix) { $nextElements[$nextElements.Count - $suffix] } else { $next.Length }
                    $insert = $next.Substring($insertStart, $insertEnd - $insertStart)
                    $oldCaret = @(Text-Elements $old.Substring(0, [int]$session.position)).Count
                    Move-Caret ($prefix - $oldCaret)
                    for ($index = 0; $index -lt $remove; $index++) { Tap-Key 'Delete' }
                    if ($insert.Length -and -not [NativeInput]::Text($insert)) { throw 'Windows rejected text input' }
                    $insertElements = @(Text-Elements $insert).Count
                    Move-Caret ($targetPosition - $prefix - $insertElements)
                }
                $session.text = $next
                $session.position = $position
                Set-Caret
                $result = @{ text=$next; position=$position }
            }
            'close' { $session = $null; Release-All }
            'release' { $session = $null; Release-All }
            default { throw 'Unknown command' }
        }
        @{ id=$request.id; ok=$true; result=$result } | ConvertTo-Json -Compress -Depth 5
    } catch {
        @{ id=$request.id; ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress -Depth 5
    }
}
Release-All
