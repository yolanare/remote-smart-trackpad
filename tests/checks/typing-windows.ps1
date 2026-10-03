# Windows side of tests/checks/typing-check.mjs: brings a test window to the foreground, and hosts the native fixtures
# (a WinForms and a WPF window with the edit boxes, masks and completion lists Windows apps use). It never sends
# input itself; the host's bridge types, guarded by the marker every test window carries in its title.
# One JSON command per line on stdin, one JSON answer per line on stdout.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, PresentationFramework, PresentationCore, WindowsBase, System.Xaml, UIAutomationClient, UIAutomationTypes
$loaded = [System.AppDomain]::CurrentDomain.GetAssemblies()
$references = foreach ($name in 'System.Windows.Forms', 'System.Drawing', 'PresentationFramework', 'PresentationCore', 'WindowsBase', 'System.Xaml') {
    ($loaded | Where-Object { $_.GetName().Name -eq $name } | Select-Object -First 1).Location
}
Add-Type -ReferencedAssemblies $references -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Forms = System.Windows.Forms;
using Wpf = System.Windows;
using WpfControls = System.Windows.Controls;
using WpfDocuments = System.Windows.Documents;

public static class TestWindows {
    delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint to, bool enable);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    static string Title(IntPtr window) {
        var text = new StringBuilder(512);
        GetWindowText(window, text, text.Capacity);
        return text.ToString();
    }
    public static string ForegroundTitle() { return Title(GetForegroundWindow()); }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    /// <summary>The whole text of another app's edit box (WM_GETTEXT).</summary>
    public static string EditText(IntPtr window) {
        int length = (int)SendMessage(window, 0x000E, IntPtr.Zero, IntPtr.Zero);
        var text = new StringBuilder(length + 1);
        SendMessage(window, 0x000D, (IntPtr)(length + 1), text);
        return text.ToString();
    }
    /// <summary>Brings the top-level window whose title contains `part` to the foreground (restore: the last resort).</summary>
    public static bool Bring(string part, bool restore) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, parameter) => {
            if (Title(window).Contains(part)) { found = window; return false; }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        // Started hidden (no console window), the process's first window takes that hidden state: show it.
        if (!IsWindowVisible(found)) ShowWindow(found, 5);
        if (Title(GetForegroundWindow()).Contains(part)) return true;
        if (IsIconic(found)) ShowWindow(found, 9);
        // Windows only lets the foreground thread hand the foreground over; attaching to its input queue for the call
        // does that without sending any key.
        uint current = GetCurrentThreadId(), foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        AttachThreadInput(current, foreground, true);
        try { BringWindowToTop(found); SetForegroundWindow(found); }
        finally { AttachThreadInput(current, foreground, false); }
        // With no foreground window at all there is no thread to attach to: restoring a minimized window activates it.
        if (restore && !Title(GetForegroundWindow()).Contains(part)) { ShowWindow(found, 6); ShowWindow(found, 9); }
        return Title(GetForegroundWindow()).Contains(part);
    }
}

/// <summary>A window on its own UI thread, whose fields the check focuses and reads.</summary>
public abstract class Fixture {
    protected string Marker;
    protected Thread Thread;
    readonly ManualResetEvent ready = new ManualResetEvent(false);
    protected void Start() {
        Thread = new Thread(() => { Build(); ready.Set(); Run(); });
        Thread.SetApartmentState(ApartmentState.STA);
        Thread.IsBackground = true;
        Thread.Start();
        ready.WaitOne();
    }
    protected abstract void Build();
    protected abstract void Run();
    public abstract void Focus(string id);
    public abstract string Value(string id);
    public abstract void Close();
}

public sealed class FormsFixture : Fixture {
    Forms.Form form;
    readonly Dictionary<string, Forms.Control> fields = new Dictionary<string, Forms.Control>();
    public FormsFixture(string marker) { Marker = marker; Start(); }
    protected override void Build() {
        form = new Forms.Form { Text = "Typing winforms " + Marker, Width = 520, Height = 420, StartPosition = Forms.FormStartPosition.CenterScreen };
        var layout = new Forms.TableLayoutPanel { Dock = Forms.DockStyle.Fill, ColumnCount = 2, Padding = new Forms.Padding(8), AutoScroll = true };
        layout.ColumnStyles.Add(new Forms.ColumnStyle(Forms.SizeType.Absolute, 160));
        layout.ColumnStyles.Add(new Forms.ColumnStyle(Forms.SizeType.Percent, 100));
        form.Controls.Add(layout);
        Add(layout, "textbox", new Forms.TextBox());
        Add(layout, "multiline", new Forms.TextBox { Multiline = true, Height = 44 });
        Add(layout, "upper", new Forms.TextBox { CharacterCasing = Forms.CharacterCasing.Upper });
        Add(layout, "maxlength", new Forms.TextBox { MaxLength = 5 });
        Add(layout, "masked", new Forms.MaskedTextBox("00/00/0000"));
        Add(layout, "rich", new Forms.RichTextBox { Height = 44 });
        var combo = new Forms.ComboBox { AutoCompleteMode = Forms.AutoCompleteMode.Append, AutoCompleteSource = Forms.AutoCompleteSource.ListItems };
        combo.Items.AddRange(new object[] { "apple", "apricot", "banana" });
        Add(layout, "combo", combo);
    }
    void Add(Forms.TableLayoutPanel layout, string id, Forms.Control field) {
        field.Dock = Forms.DockStyle.Fill;
        field.Name = id;
        layout.Controls.Add(new Forms.Label { Text = id, AutoSize = true, Anchor = Forms.AnchorStyles.Left });
        layout.Controls.Add(field);
        fields[id] = field;
    }
    protected override void Run() { Forms.Application.Run(form); }
    public override void Focus(string id) {
        form.Invoke((Action)(() => {
            var field = fields[id];
            field.Text = "";
            form.Text = "Typing winforms " + Marker + " " + id;
            // Activation gives the focus back to the form's active control: make it this field first.
            form.ActiveControl = field;
            form.Activate();
            field.Focus();
        }));
    }
    public override string Value(string id) {
        return (string)form.Invoke((Func<string>)(() => {
            var masked = fields[id] as Forms.MaskedTextBox;
            if (masked != null) { masked.TextMaskFormat = Forms.MaskFormat.IncludeLiterals; return masked.Text; }
            return fields[id].Text.Replace("\r\n", "\n");
        }));
    }
    public override void Close() { form.Invoke((Action)(() => form.Close())); }
}

public sealed class WpfFixture : Fixture {
    Wpf.Window window;
    readonly Dictionary<string, WpfControls.Control> fields = new Dictionary<string, WpfControls.Control>();
    public WpfFixture(string marker) { Marker = marker; Start(); }
    protected override void Build() {
        window = new Wpf.Window { Title = "Typing wpf " + Marker, Width = 520, Height = 360, WindowStartupLocation = Wpf.WindowStartupLocation.CenterScreen };
        var panel = new WpfControls.StackPanel { Margin = new Wpf.Thickness(8) };
        window.Content = panel;
        Add(panel, "textbox", new WpfControls.TextBox());
        Add(panel, "multiline", new WpfControls.TextBox { AcceptsReturn = true, Height = 44 });
        Add(panel, "upper", new WpfControls.TextBox { CharacterCasing = WpfControls.CharacterCasing.Upper });
        Add(panel, "maxlength", new WpfControls.TextBox { MaxLength = 5 });
        Add(panel, "rich", new WpfControls.RichTextBox { Height = 44 });
        var combo = new WpfControls.ComboBox { IsEditable = true, IsTextSearchEnabled = true };
        foreach (var item in new[] { "apple", "apricot", "banana" }) combo.Items.Add(item);
        Add(panel, "combo", combo);
        window.Show();
    }
    void Add(WpfControls.Panel panel, string id, WpfControls.Control field) {
        panel.Children.Add(new WpfControls.Label { Content = id, Padding = new Wpf.Thickness(0, 4, 0, 0) });
        panel.Children.Add(field);
        fields[id] = field;
    }
    protected override void Run() { System.Windows.Threading.Dispatcher.Run(); }
    public override void Focus(string id) {
        window.Dispatcher.Invoke((Action)(() => {
            var field = fields[id];
            var rich = field as WpfControls.RichTextBox;
            if (rich != null) rich.Document = new WpfDocuments.FlowDocument(new WpfDocuments.Paragraph());
            else if (field is WpfControls.ComboBox) ((WpfControls.ComboBox)field).Text = "";
            else ((WpfControls.TextBox)field).Text = "";
            window.Title = "Typing wpf " + Marker + " " + id;
            window.Activate();
            field.Focus();
            Wpf.Input.Keyboard.Focus(field);
        }));
    }
    public override string Value(string id) {
        return (string)window.Dispatcher.Invoke((Func<string>)(() => {
            var field = fields[id];
            var rich = field as WpfControls.RichTextBox;
            if (rich != null) {
                string text = new WpfDocuments.TextRange(rich.Document.ContentStart, rich.Document.ContentEnd).Text.Replace("\r\n", "\n");
                return text.EndsWith("\n") ? text.Substring(0, text.Length - 1) : text;
            }
            if (field is WpfControls.ComboBox) return ((WpfControls.ComboBox)field).Text;
            return ((WpfControls.TextBox)field).Text.Replace("\r\n", "\n");
        }));
    }
    public override void Close() {
        window.Dispatcher.Invoke((Action)(() => { window.Close(); window.Dispatcher.InvokeShutdown(); }));
    }
}
'@

$fixtures = @{}
while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $request = ConvertFrom-Json -InputObject $line
        $result = $null
        switch ($request.do) {
            'bring' {
                $result = $false
                for ($attempt = 0; $attempt -lt 40 -and -not $result; $attempt++) {
                    $result = [TestWindows]::Bring([string]$request.title, $attempt -eq 4)
                    if (-not $result) { Start-Sleep -Milliseconds 50 }
                }
                if (-not $result) { throw "'$([string]$request.title)' not in the foreground, '$([TestWindows]::ForegroundTitle())' is" }
            }
            'open' {
                $fixtures[$request.window] = if ($request.window -eq 'wpf') { New-Object WpfFixture ([string]$request.marker) } else { New-Object FormsFixture ([string]$request.marker) }
            }
            'focus' { $fixtures[$request.window].Focus([string]$request.id) }
            'value' { $result = $fixtures[$request.window].Value([string]$request.id) }
            # The address bar of the browser window whose title contains `title`: focused (and emptied) through UI
            # Automation, like a click on it, or read.
            'address' {
                $window = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
                    Where-Object { $_.Current.Name.Contains([string]$request.title) } | Select-Object -First 1
                if ($null -eq $window) { throw "No window titled '$($request.title)'" }
                $bar = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.OrCondition(
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'urlbar-input')))))
                if ($null -eq $bar) { throw 'No address bar in that window' }
                $value = $bar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($request.action -eq 'focus') {
                    $bar.SetFocus()
                    $value.SetValue('')
                } else { $result = $value.Current.Value }
            }
            # The text of the edit box in the window whose title contains `title` (a Notepad started on a test file).
            'window-text' {
                $window = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
                    Where-Object { $_.Current.Name.Contains([string]$request.title) } | Select-Object -First 1
                if ($null -eq $window) { throw "No window titled '$($request.title)'" }
                $box = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit')))
                if ($null -eq $box) { throw 'No edit box in that window' }
                $result = [TestWindows]::EditText([IntPtr]$box.Current.NativeWindowHandle).Replace("`r`n", "`n")
            }
            'close' { foreach ($fixture in $fixtures.Values) { $fixture.Close() }; $fixtures.Clear() }
            default { throw "Unknown command $($request.do)" }
        }
        @{ ok=$true; result=$result } | ConvertTo-Json -Compress
    } catch {
        @{ ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
    }
}
foreach ($fixture in $fixtures.Values) { try { $fixture.Close() } catch {} }
