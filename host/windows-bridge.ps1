# The host's hands on the PC: one JSON command per line on stdin ({ id, action, data }), one JSON answer per line on
# stdout ({ id, ok, result } or { id, ok: false, error }). Input goes through input.psm1, the mirror through
# text-mirror.psm1.
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Import-Module (Join-Path $PSScriptRoot 'input.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'text-mirror.psm1') -DisableNameChecking
# Tests that type for real (scripts/typing-check.mjs) set this to a marker in their own windows' titles: input then
# only ever reaches a window carrying it, never another app the user has in the foreground.
$inputGuard = $env:REMOTE_SMART_TRACKPAD_INPUT_GUARD
if ($inputGuard) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class InputGuard {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    public static string ForegroundTitle() {
        var text = new StringBuilder(512);
        GetWindowText(GetForegroundWindow(), text, text.Capacity);
        return text.ToString();
    }
}
'@
}
$readActions = @('mirror-read', 'mirror-close', 'media-state', 'release')
while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $request = ConvertFrom-Json -InputObject $line
        $data = $request.data
        $result = $null
        if ($inputGuard -and $request.action -notin $readActions -and -not [InputGuard]::ForegroundTitle().Contains($inputGuard)) {
            throw "Input guard: the foreground window is not a test window"
        }
        switch ($request.action) {
            'move' {
                if (-not [NativeInput]::MoveBy([int]$data.dx, [int]$data.dy)) { throw 'Windows rejected pointer movement' }
            }
            'click' { Invoke-Click ([string]$data.button) ([bool]$data.double) }
            'button' { Set-Button ([string]$data.button) ([bool]$data.down) }
            'scroll' {
                if ([int]$data.dy -ne 0 -and -not [NativeInput]::Mouse(0x0800, -[int]$data.dy)) { throw 'Windows rejected scroll input' }
                if ([int]$data.dx -ne 0 -and -not [NativeInput]::Mouse(0x1000, [int]$data.dx)) { throw 'Windows rejected horizontal scroll' }
            }
            'shortcut' { Invoke-Shortcut ([string]$data.key) $data.modifiers }
            # A key held down or let go (down given), or tapped.
            'key' { Set-Key ([string]$data.key) $(if ($data.PSObject.Properties.Name -contains 'down') { [bool]$data.down } else { $null }) }
            # Typing into a PC field the phone cannot read.
            'text' { Invoke-Typing ([int]$data.backspace) ([int]$data.delete) ([string]$data.text) }
            'media-state' { $result = Get-MediaState }
            'glide' {
                $vx = [double]$data.vx; $vy = [double]$data.vy
                if ([double]::IsNaN($vx) -or [double]::IsNaN($vy) -or [Math]::Abs($vx) -gt 20 -or [Math]::Abs($vy) -gt 20) { throw 'Invalid glide velocity' }
                [Glider]::Set($vx, $vy)
            }
            'mirror-read' { $result = Read-MirrorFor $data.session $data.revision }
            'mirror-edit' { $result = Edit-Mirror $data }
            'mirror-close' { Close-Mirror }
            'release' { Release-All }
            default { throw 'Unknown command' }
        }
        @{ id=$request.id; ok=$true; result=$result } | ConvertTo-Json -Compress -Depth 5
    } catch {
        # The failure itself, not PowerShell's wrapper ('Exception calling "GetText" with "1" argument(s): ...').
        $failure = $_.Exception
        while ($failure -is [System.Management.Automation.MethodInvocationException] -and $null -ne $failure.InnerException) { $failure = $failure.InnerException }
        @{ id=$request.id; ok=$false; error=$failure.Message } | ConvertTo-Json -Compress -Depth 5
    }
}
Release-All
