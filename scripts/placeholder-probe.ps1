# Reads the focused field exactly as the host does (Read-Mirror), for scripts/placeholder-check.mjs.
# Read-only: it never sends input. Each request names the window title the fixture page sets for its current case;
# the probe brings that window forward and reads only once it is the foreground window, so it never reads another app.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot '..\host\windows-input.ps1')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ProbeWindow {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint to, bool enable);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
    public static int ForegroundProcess() {
        int process; GetWindowThreadProcessId(GetForegroundWindow(), out process);
        return process;
    }
    public static string ForegroundTitle() {
        var text = new StringBuilder(512);
        GetWindowText(GetForegroundWindow(), text, text.Capacity);
        return text.ToString();
    }
    // Windows only lets the foreground thread hand the foreground over; attaching to its input queue for the call
    // does that without sending any key.
    public static void Bring(IntPtr window) {
        uint current = GetCurrentThreadId(), foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        AttachThreadInput(current, foreground, true);
        try { BringWindowToTop(window); SetForegroundWindow(window); }
        finally { AttachThreadInput(current, foreground, false); }
    }
}
'@

function Find-Window([string]$title) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $title)
    return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
}

while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $title = [string](ConvertFrom-Json -InputObject $line).title
        $ready = $false
        for ($attempt = 0; $attempt -lt 40 -and -not $ready; $attempt++) {
            # Firefox appends its name to the page title.
            $ready = [ProbeWindow]::ForegroundTitle().StartsWith($title)
            if (-not $ready) {
                $window = Find-Window $title
                if ($null -eq $window) { $window = Find-Window "$title $([char]0x2014) Mozilla Firefox" }
                if ($null -ne $window) { [ProbeWindow]::Bring([IntPtr]$window.Current.NativeWindowHandle) }
                Start-Sleep -Milliseconds 50
            }
        }
        if (-not $ready) { @{ ok=$false; error="Window '$title' is not in the foreground" } | ConvertTo-Json -Compress; continue }
        # Let the browser publish the focus and selection the page just set.
        Start-Sleep -Milliseconds 120
        $element = [System.Windows.Automation.AutomationElement]::FocusedElement
        if ($element.Current.ProcessId -ne [ProbeWindow]::ForegroundProcess()) {
            @{ ok=$false; error='Focus is outside the fixture window' } | ConvertTo-Json -Compress; continue
        }
        $script:mirror = $null
        $read = Read-Mirror
        $current = $element.Current
        $pattern = $null; $raw = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { $raw = $pattern.DocumentRange.GetText(2000) }
        $content = $null
        if ($current.FrameworkId -in @('Chrome', 'Gecko')) { $content = [FieldContent]::Focused($current.Name) }
        # Someone using the PC meanwhile could have moved the focus: such a read says nothing about the fixture.
        if (-not [ProbeWindow]::ForegroundTitle().StartsWith($title) -or
                -not $element.Equals([System.Windows.Automation.AutomationElement]::FocusedElement)) {
            @{ ok=$false; error='Focus moved during the read (is the PC in use?)' } | ConvertTo-Json -Compress; continue
        }
        @{
            ok = $true
            read = @{ available=$read.available; text=$read.text; selectionStart=$read.selectionStart; selectionEnd=$read.selectionEnd; reason=$read.reason }
            field = @{ framework=$current.FrameworkId; type=$current.LocalizedControlType; name=$current.Name; className=$current.ClassName; text=$raw }
            content = if ($content) { @{ native=$content.Native; value=$content.Value; editableText=$content.EditableText; editableObject=$content.EditableObject; otherText=$content.OtherText; leafless=$content.Leafless } } else { $null }
        } | ConvertTo-Json -Compress -Depth 4
    } catch {
        @{ ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
    }
}
