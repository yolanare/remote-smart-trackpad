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
    // Text containing line breaks goes through ClipboardText.Paste instead: Enter can send a message.
    public static bool Text(string text) {
        foreach (char character in text) {
            if (character == '\t') {
                if (!Key(0x09, true) || !Key(0x09, false)) return false;
                continue;
            }
            Input down = new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { ScanCode = character, Flags = 4 } } };
            Input up = down; up.Data.Keyboard.Flags = 6;
            if (SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(Input))) != 2) return false;
        }
        return true;
    }
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    // Real mouse input, unlike SetCursorPos, so apps update the cursor shape (text, link, resize) and hover state.
    // Absolute coordinates keep Windows' pointer acceleration out; SetCursorPos then corrects any rounding pixel.
    public static bool MoveBy(int dx, int dy) {
        Point point;
        if (!GetCursorPos(out point)) return false;
        int left = GetSystemMetrics(76), top = GetSystemMetrics(77), width = GetSystemMetrics(78), height = GetSystemMetrics(79);
        int x = Math.Max(left, Math.Min(left + width - 1, point.X + dx));
        int y = Math.Max(top, Math.Min(top + height - 1, point.Y + dy));
        Input input = new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput {
            Dx = (int)Math.Round((x - left) * 65535.0 / Math.Max(1, width - 1)),
            Dy = (int)Math.Round((y - top) * 65535.0 / Math.Max(1, height - 1)),
            Flags = 0x0001 | 0x4000 | 0x8000 } } };
        if (SendInput(1, new [] { input }, Marshal.SizeOf(typeof(Input))) != 1) return SetCursorPos(x, y);
        Point landed;
        if (GetCursorPos(out landed) && (landed.X != x || landed.Y != y)) return SetCursorPos(x, y);
        return true;
    }
    public static bool Mouse(uint flags, int data = 0) {
        Input input = new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = flags, MouseData = unchecked((uint)data) } } };
        return SendInput(1, new [] { input }, Marshal.SizeOf(typeof(Input))) == 1;
    }
}

// Inserts text by pasting it, so line breaks become real paragraph breaks and never press Enter. The user's
// clipboard is saved first and restored by Restore once the paste has landed.
// Edge motion: the phone sends a velocity and the pointer glides here, on a ~8 ms timer, so the motion is smooth
// whatever the network latency. The phone renews the velocity every 100 ms; without news for 300 ms the glide
// stops on its own, so a dropped connection never leaves the pointer moving.
public static class Glider {
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
    static readonly object gate = new object();
    static System.Threading.Thread worker;
    static readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
    static double velocityX, velocityY, deadline;
    public static long Moved;

    /** Velocity in pixels per millisecond; zero stops. */
    public static void Set(double x, double y) {
        lock (gate) {
            velocityX = x; velocityY = y;
            deadline = clock.Elapsed.TotalMilliseconds + 300;
            if ((x == 0 && y == 0) || worker != null) return;
            worker = new System.Threading.Thread(Run) { IsBackground = true, Priority = System.Threading.ThreadPriority.AboveNormal };
            worker.Start();
        }
    }
    public static void Stop() { lock (gate) { velocityX = velocityY = 0; deadline = 0; } }
    // A steady 8 ms cadence (the finer system timer makes Sleep(1) precise), with sub-pixel remainders carried over.
    static void Run() {
        timeBeginPeriod(1);
        try {
            double carryX = 0, carryY = 0, last = clock.Elapsed.TotalMilliseconds, next = last + 8;
            while (true) {
                double now = clock.Elapsed.TotalMilliseconds;
                if (now < next) { System.Threading.Thread.Sleep(1); continue; }
                next += 8;
                if (next < now) next = now + 8;
                double vx, vy;
                lock (gate) {
                    if (now > deadline || (velocityX == 0 && velocityY == 0)) { worker = null; return; }
                    vx = velocityX; vy = velocityY;
                }
                double elapsed = Math.Min(50, now - last);
                last = now;
                carryX += vx * elapsed; carryY += vy * elapsed;
                int dx = (int)Math.Round(carryX), dy = (int)Math.Round(carryY);
                carryX -= dx; carryY -= dy;
                if ((dx != 0 || dy != 0) && NativeInput.MoveBy(dx, dy)) Moved += Math.Abs(dx) + Math.Abs(dy);
            }
        } finally { timeEndPeriod(1); }
    }
}

public static class ClipboardText {
    [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern bool EmptyClipboard();
    [DllImport("user32.dll")] static extern uint EnumClipboardFormats(uint format);
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint exStyle, string className, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr memory);
    static IntPtr owner;
    static System.Collections.Generic.List<Tuple<uint, byte[]>> saved;

    static bool Open() {
        // SetClipboardData fails without an owner window; a message-only window serves.
        if (owner == IntPtr.Zero) owner = CreateWindowEx(0, "STATIC", "", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        for (int attempt = 0; attempt < 25; attempt++) {
            if (OpenClipboard(owner)) return true;
            System.Threading.Thread.Sleep(10);
        }
        return false;
    }
    static void Put(uint format, byte[] bytes) {
        IntPtr memory = GlobalAlloc(0x0002, (UIntPtr)bytes.Length);
        IntPtr target = GlobalLock(memory);
        Marshal.Copy(bytes, 0, target, bytes.Length);
        GlobalUnlock(memory);
        SetClipboardData(format, memory);
    }
    // Keeps the pasted text out of Windows clipboard history and cloud sync.
    static void PutPrivacyMarkers() {
        Put(RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"), new byte[4]);
        Put(RegisterClipboardFormat("CanIncludeInClipboardHistory"), new byte[4]);
        Put(RegisterClipboardFormat("CanUploadToCloudClipboard"), new byte[4]);
    }
    static bool Copyable(uint format) {
        // GDI handles cannot be copied as memory; bitmaps survive through their CF_DIB form.
        return format != 2 && format != 3 && format != 9 && format != 14 && !(format >= 0x80 && format <= 0x8E) && !(format >= 0x300 && format <= 0x3FF);
    }
    public static bool Set(string text) {
        if (!Open()) return false;
        try {
            if (saved == null) {
                saved = new System.Collections.Generic.List<Tuple<uint, byte[]>>();
                for (uint format = EnumClipboardFormats(0); format != 0; format = EnumClipboardFormats(format)) {
                    if (!Copyable(format)) continue;
                    IntPtr memory = GetClipboardData(format);
                    if (memory == IntPtr.Zero) continue;
                    int size = (int)GlobalSize(memory);
                    IntPtr source = GlobalLock(memory);
                    if (source == IntPtr.Zero) continue;
                    byte[] bytes = new byte[size];
                    Marshal.Copy(source, bytes, 0, size);
                    GlobalUnlock(memory);
                    saved.Add(Tuple.Create(format, bytes));
                }
            }
            EmptyClipboard();
            Put(13, System.Text.Encoding.Unicode.GetBytes(text.Replace("\n", "\r\n") + "\0"));
            PutPrivacyMarkers();
            return true;
        } finally { CloseClipboard(); }
    }
    public static void Restore() {
        if (saved == null || !Open()) return;
        try {
            EmptyClipboard();
            foreach (var entry in saved) Put(entry.Item1, entry.Item2);
            PutPrivacyMarkers();
        } finally {
            saved = null;
            CloseClipboard();
        }
    }
}

// Core Audio: only the vtable slots up to GetMute are declared.
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify); int UnregisterControlChangeNotify(IntPtr notify); int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float level, IntPtr context); int SetMasterVolumeLevelScalar(float level, IntPtr context);
    int GetMasterVolumeLevel(out float level); int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, IntPtr context); int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr context);
    int GetChannelVolumeLevel(uint channel, out float level); int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr context); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice { int Activate(ref Guid id, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int state, out IntPtr devices); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator {}

public static class SpeakerVolume {
    public static bool Muted() {
        IMMDevice device;
        Marshal.ThrowExceptionForHR(((IMMDeviceEnumerator)new MMDeviceEnumerator()).GetDefaultAudioEndpoint(0, 1, out device));
        Guid id = typeof(IAudioEndpointVolume).GUID;
        object volume;
        Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, IntPtr.Zero, out volume));
        bool muted;
        Marshal.ThrowExceptionForHR(((IAudioEndpointVolume)volume).GetMute(out muted));
        return muted;
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
# Down and up flags, and the button for the side ones (X1: back, X2: forward, in browsers, Explorer and most apps).
$buttons = @{ left=@(0x0002,0x0004); right=@(0x0008,0x0010); middle=@(0x0020,0x0040); back=@(0x0080,0x0100,1); forward=@(0x0080,0x0100,2) }
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
# A line break must never press plain Enter, which sends the message in chat inputs. Chromium rich-text fields get
# Shift+Enter: it is their newline and the only break that leaves their caret on the new line. Other fields get a
# pasted line break, a real paragraph break. The caller restores the clipboard with [ClipboardText]::Restore().
function Insert-Text([string]$text) {
    if (-not $text.Contains("`n")) {
        if (-not [NativeInput]::Text($text)) { throw 'Windows rejected text input' }
        return
    }
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    $rich = $null -ne $element -and $element.Current.FrameworkId -eq 'Chrome' -and
        $null -ne [System.Windows.Automation.TreeWalker]::RawViewWalker.GetFirstChild($element)
    if ($rich) {
        $lines = $text.Split("`n")
        for ($index = 0; $index -lt $lines.Count; $index++) {
            if ($index) {
                $shift = -not $held.Contains('Shift')
                if ($shift) { Send-Key 'Shift' $true }
                try { Tap-Key 'Enter' } finally { if ($shift) { Send-Key 'Shift' $false } }
            }
            if ($lines[$index].Length -and -not [NativeInput]::Text($lines[$index])) { throw 'Windows rejected text input' }
        }
        return
    }
    if (-not [ClipboardText]::Set($text)) { throw 'Clipboard unavailable' }
    $control = -not $held.Contains('Control')
    if ($control) { Send-Key 'Control' $true }
    try { Tap-Key 'V' } finally { if ($control) { Send-Key 'Control' $false } }
}
function Release-All {
    [Glider]::Stop()
    foreach ($name in @($held)) {
        if ($buttons.ContainsKey($name)) { [void][NativeInput]::Mouse($buttons[$name][1], [int]$buttons[$name][2]) }
        elseif ($keyCodes.ContainsKey($name)) { [void][NativeInput]::Key($keyCodes[$name], $false) }
        [void]$held.Remove($name)
    }
}

$script:mediaSessions = $null
function Get-MediaState {
    $muted = $null
    try { $muted = [SpeakerVolume]::Muted() } catch {}
    $playing = $null
    try {
        if ($null -eq $script:mediaSessions) {
            Add-Type -AssemblyName System.Runtime.WindowsRuntime
            $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
            $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
                $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
            } | Select-Object -First 1
            $script:mediaSessions = $asTask.MakeGenericMethod($managerType).Invoke($null, @($managerType::RequestAsync())).Result
        }
        $session = $script:mediaSessions.GetCurrentSession()
        $playing = $null -ne $session -and [string]$session.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
    } catch {}
    return @{ muted=$muted; playing=$playing }
}
