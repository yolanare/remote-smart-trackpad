# A test window whose UI thread stops answering for a while, as a busy app does (a browser streaming a long answer).
# Its text box has the focus; its title carries the marker, so a bridge with the input guard takes commands only while
# it is in the foreground. Writes "frozen" on stdout when the freeze starts. Arguments: marker, delay before the freeze
# and freeze length (ms).
param([string]$marker, [int]$delay = 2500, [int]$freeze = 15000)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = "$marker frozen window"
$form.Width = 420; $form.Height = 160
$box = New-Object System.Windows.Forms.TextBox
$box.Text = 'hello'; $box.Width = 360; $box.Left = 20; $box.Top = 20
$form.Controls.Add($box)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $delay
$timer.Add_Tick({
    $timer.Stop()
    [Console]::Out.WriteLine('frozen'); [Console]::Out.Flush()
    [System.Threading.Thread]::Sleep($freeze)
})
$form.Add_Shown({ $form.Activate(); [void]$box.Focus(); $timer.Start() })
$closer = New-Object System.Windows.Forms.Timer
$closer.Interval = $delay + $freeze + 3000
$closer.Add_Tick({ $form.Close() })
$closer.Start()
[System.Windows.Forms.Application]::Run($form)
