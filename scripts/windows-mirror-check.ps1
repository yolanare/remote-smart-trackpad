$ErrorActionPreference = 'Stop'
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'host\input.psm1') -DisableNameChecking
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'host\text-mirror.psm1') -DisableNameChecking
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
public static class MirrorFixture {
    public static Form Window;
    public static TextBox First, Second;
    public static ManualResetEvent Ready = new ManualResetEvent(false);
    public static void Start() {
        var thread = new Thread(delegate() {
            Window = new Form { Text = "Trackpad mirror verification", Size = new Size(450, 220), TopMost = true };
            First = new TextBox { Multiline = true, Text = "Existing full field", Location = new Point(10, 10), Size = new Size(400, 60) };
            Second = new TextBox { Multiline = true, Text = "Second field", Location = new Point(10, 90), Size = new Size(400, 60) };
            Window.Controls.Add(First); Window.Controls.Add(Second);
            Window.Shown += delegate { First.Focus(); First.Select(3, 0); Ready.Set(); };
            Application.Run(Window);
        });
        thread.SetApartmentState(ApartmentState.STA); thread.IsBackground = true; thread.Start(); Ready.WaitOne();
    }
    public static void FocusSecond() { Window.Invoke((Action)delegate { Second.Focus(); Second.Select(2, 0); }); }
    public static void ChangeSecond() { Window.Invoke((Action)delegate { Second.Text = "PC replacement"; Second.Select(0, 2); }); }
    public static void Stop() { if (Window != null) Window.Invoke((Action)delegate { Window.Close(); }); }
}
'@
function Assert($condition, $message) { if (-not $condition) { throw $message } }
try {
    [MirrorFixture]::Start()
    Start-Sleep -Milliseconds 200
    $first = Read-Mirror
    Assert ($first.readable -and $first.text -eq 'Existing full field') 'Opening must read the complete field, not only the selection'
    Assert ($first.selectionStart -eq 3 -and $first.selectionEnd -eq 3) 'PC caret must be mirrored'
    $edit = Edit-Mirror @{ session=$first.session; revision=$first.revision; operationId='first'; start=0; end=8; text='Updated'; selectionStart=7; selectionEnd=7 }
    Assert ($edit.accepted -and $edit.snapshot.text -eq 'Updated full field') 'Mobile replacement was not applied and confirmed'
    [MirrorFixture]::FocusSecond()
    $stale = Edit-Mirror @{ session=$edit.snapshot.session; revision=$edit.snapshot.revision; operationId='stale'; start=0; end=0; text='WRONG'; selectionStart=5; selectionEnd=5 }
    Assert (-not $stale.accepted -and $stale.snapshot.text -eq 'Second field') 'A stale edit must not reach a different field'
    [MirrorFixture]::ChangeSecond()
    $changed = Read-Mirror
    Assert ($changed.text -eq 'PC replacement' -and $changed.selectionEnd -eq 2) 'PC edits and selection must be mirrored'
    $result = @{ fullField=$true; mobileEdit=$true; staleFocusRejected=$true; pcEdit=$true; selection=$true }
    $reportPath = Join-Path ([IO.Path]::GetTempPath()) 'remote-smart-trackpad-windows-mirror-report.json'
    $result | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $reportPath
    Write-Output "Report: $reportPath"
    $result | ConvertTo-Json -Compress
} finally { Release-All; [MirrorFixture]::Stop() }
