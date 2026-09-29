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
. (Join-Path $PSScriptRoot 'text-mirror.ps1')

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
