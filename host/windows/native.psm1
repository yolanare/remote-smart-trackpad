# The Windows APIs the bridge calls, as C# types loaded once for the whole process: input (SendInput), the pointer
# glide, the clipboard, the speaker's mute state, and what a focused web field holds (field-content.ps1). Types only:
# nothing to export.
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

// Windows keeps the input of an app with the user's rights (the remote) off the windows of an app run as administrator
// (UIPI): while one is in front (a tray icon's menu, PowerToys), every injected move, click and key fails. Giving the
// focus to the taskbar is allowed, and closes such a menu as a click outside it would.
public static class Foreground {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr window, bool altTab);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int id);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, int access, out IntPtr token);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int written);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    /// <summary>The name of the app in front when it runs as administrator, else null.</summary>
    public static string Elevated() {
        int id;
        GetWindowThreadProcessId(GetForegroundWindow(), out id);
        if (id == 0) return null;
        const int QueryLimited = 0x1000, Query = 0x8, TokenElevation = 20;
        IntPtr process = OpenProcess(QueryLimited, false, id);
        if (process == IntPtr.Zero) return null;
        try {
            IntPtr token;
            if (!OpenProcessToken(process, Query, out token)) return null;
            try {
                int elevated, written;
                if (!GetTokenInformation(token, TokenElevation, out elevated, 4, out written) || elevated == 0) return null;
            } finally { CloseHandle(token); }
        } finally { CloseHandle(process); }
        try { return System.Diagnostics.Process.GetProcessById(id).ProcessName; } catch { return "An app"; }
    }
    /// <summary>Gives the focus to the taskbar when an app run as administrator is in front; true when it moved.</summary>
    public static bool LeaveElevated() {
        if (Elevated() == null) return false;
        IntPtr taskbar = FindWindow("Shell_TrayWnd", null);
        if (taskbar == IntPtr.Zero) return false;
        if (!SetForegroundWindow(taskbar)) SwitchToThisWindow(taskbar, true);
        System.Threading.Thread.Sleep(50);
        return Elevated() == null;
    }
}

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

. (Join-Path $PSScriptRoot 'field-content.ps1')
Export-ModuleMember -Function @()
