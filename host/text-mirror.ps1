$script:mirror = $null

# CSS placeholders in Chromium rich-text fields read exactly like typed text, so they are learned from edits that
# reveal them (see Edit-Mirror) and remembered per field kind across restarts.
$dataDirectory = if ($env:REMOTE_SMART_TRACKPAD_DATA_DIRECTORY) { $env:REMOTE_SMART_TRACKPAD_DATA_DIRECTORY } else { Join-Path $PSScriptRoot '..\.data' }
$script:placeholderFile = Join-Path $dataDirectory 'placeholders.json'
$script:placeholders = New-Object 'System.Collections.Generic.HashSet[string]'
try { foreach ($entry in (Get-Content -Raw -Encoding UTF8 $script:placeholderFile | ConvertFrom-Json)) { [void]$script:placeholders.Add([string]$entry) } } catch {}
function Get-PlaceholderKey($element, [string]$text) {
    $current = $element.Current
    return "$($current.FrameworkId)|$($current.ControlType.ProgrammaticName)|$($current.ClassName)|$($current.AutomationId)|$($current.Name)|$text"
}
function Add-Placeholder($element, [string]$text) {
    if (-not $script:placeholders.Add((Get-PlaceholderKey $element $text))) { return }
    try {
        [void](New-Item -ItemType Directory -Force (Split-Path $script:placeholderFile))
        ConvertTo-Json -InputObject @($script:placeholders) | Set-Content -Encoding UTF8 $script:placeholderFile
    } catch {}
}

# Chromium exposes a <br> that ends a line with other content as a final line break the caret can never reach.
# An empty line (<div><br></div>, <p><br></p>) is real: its break is the only content of its block.
function Test-PhantomBreak($element) {
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $node = $walker.GetLastChild($element)
    while ($null -ne $node) {
        $last = $walker.GetLastChild($node)
        if ($null -eq $last) { break }
        $node = $last
    }
    return $null -ne $node -and $node.Current.Name -eq "`n" -and $null -ne $walker.GetPreviousSibling($node)
}

function Read-Mirror {
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    $pattern = $null
    $valuePattern = $null
    if ($null -eq $element -or $element.Current.IsPassword -or
        -not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
        $script:mirror = $null
        return @{ available=$false; text=''; selectionStart=0; selectionEnd=0 }
    }
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and $valuePattern.Current.IsReadOnly) {
        $script:mirror = $null
        return @{ available=$false; text=''; selectionStart=0; selectionEnd=0 }
    }
    $document = $pattern.DocumentRange
    if ($document.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute) -eq $true) {
        $script:mirror = $null
        return @{ available=$false; text='' }
    }
    $raw = $document.GetText(262145)
    if ($raw.Length -gt 262144) { $script:mirror = $null; return @{ available=$false; text=''; reason='This field exceeds the 256 Ki character mirror limit.' } }
    $text = Normalize-LineEndings $raw
    $ranges = $pattern.GetSelection()
    if ($ranges.Count -ne 1) { $script:mirror = $null; return @{ available=$false; text='' } }
    $prefix = $document.Clone()
    $prefix.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $ranges[0], [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
    $start = (Normalize-LineEndings ($prefix.GetText(262145))).Length
    $prefix.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $ranges[0], [System.Windows.Automation.Text.TextPatternRangeEndpoint]::End)
    $end = (Normalize-LineEndings ($prefix.GetText(262145))).Length
    # Inputs that hide their content expose their accessible name as text instead (VS Code's editor and terminal:
    # "The editor is not accessible at this time…"). They are unreadable, so the phone types into them blind.
    if ($text.Length -and $text -ceq $element.Current.Name) {
        $script:mirror = $null
        return @{ available=$false; text=''; selectionStart=0; selectionEnd=0; reason='Text not readable here · typing to PC' }
    }
    if ($element.Current.FrameworkId -eq 'Chrome') {
        if ($text.Length -and $script:placeholders.Contains((Get-PlaceholderKey $element $text))) { $text = ''; $start = 0; $end = 0 }
        # An emptied field keeps one <br>, displayed as a single empty line.
        if ($text -ceq "`n") { $text = ''; $start = 0; $end = 0 }
        elseif ($text.EndsWith("`n") -and (Test-PhantomBreak $element)) {
            $text = $text.Substring(0, $text.Length - 1)
            $start = [Math]::Min($start, $text.Length); $end = [Math]::Min($end, $text.Length)
        }
    }
    # Chromium can misreport the caret on an empty line; after our own edit the caret position is known instead.
    $believed = if ($null -ne $script:mirror -and $element.Equals($script:mirror.element)) { $script:mirror.believed } else { $null }
    if ($null -ne $believed) {
        if ($believed.text -ceq $text -and $believed.reportedStart -eq $start -and $believed.reportedEnd -eq $end) {
            $start = $believed.start; $end = $believed.end
        } else { $script:mirror.believed = $null }
    }
    if ($null -eq $script:mirror -or -not $element.Equals($script:mirror.element)) {
        $script:mirror = @{ id=[guid]::NewGuid().ToString('N'); revision=0; element=$element; text=$text; start=$start; end=$end; lastOperation=$null; believed=$null }
    } elseif ($text -cne $script:mirror.text -or $start -ne $script:mirror.start -or $end -ne $script:mirror.end) {
        $script:mirror.revision++
        $script:mirror.text=$text; $script:mirror.start=$start; $script:mirror.end=$end
    }
    return @{ available=$true; session=$script:mirror.id; revision=$script:mirror.revision; text=$text; selectionStart=$start; selectionEnd=$end }
}

function Select-MirrorRange([int]$start, [int]$end, [string]$text) {
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $element.Equals($script:mirror.element)) { throw 'PC focus changed' }
    $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    $range = $pattern.DocumentRange.Clone()
    $elements = [System.Globalization.StringInfo]::ParseCombiningCharacters($text)
    $from = Element-Index $elements $start $text.Length
    $to = Element-Index $elements $end $text.Length
    $range.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $range, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
    if ($range.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, $to) -ne $to) { throw 'PC text range cannot be selected' }
    if ($range.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, $from) -ne $from) { throw 'PC text range cannot be selected' }
    if ((Normalize-LineEndings ($range.GetText(262145))) -cne $text.Substring($start, $end - $start)) { throw 'PC text range differs' }
    $range.Select()
}

function Edit-Mirror($data) {
    $snapshot = Read-Mirror
    if (-not $snapshot.available -or $snapshot.session -cne [string]$data.session -or $snapshot.revision -ne [int]$data.revision) {
        return @{ accepted=$false; snapshot=$snapshot }
    }
    if ([string]::IsNullOrWhiteSpace([string]$data.operationId)) { throw 'Missing operation identifier' }
    if ($script:mirror.lastOperation -ceq [string]$data.operationId) { return @{ accepted=$true; snapshot=$snapshot } }
    $old = $snapshot.text
    $start=[int]$data.start; $end=[int]$data.end; $insert=[string]$data.text
    if ($start -lt 0 -or $end -lt $start -or $end -gt $old.Length -or $insert.Length -gt 16384) { throw 'Invalid text operation' }
    $next = $old.Substring(0,$start) + $insert + $old.Substring($end)
    if ($next.Length -gt 262144) { throw 'Mirror field limit exceeded' }
    $selectionStart=[int]$data.selectionStart; $selectionEnd=[int]$data.selectionEnd
    if ($selectionStart -lt 0 -or $selectionEnd -lt $selectionStart -or $selectionEnd -gt $next.Length) { throw 'Invalid selection' }
    $changed = $old -cne $next
    $landed = $start + $insert.Length
    if ($changed) {
        # Edits at the caret (typing, Backspace, a new line) never reposition it: UI Automation character offsets
        # are unreliable around empty lines in rich-text fields, so the caret stays where the app put it.
        $atCaret = $snapshot.selectionStart -eq $snapshot.selectionEnd -and $snapshot.selectionEnd -eq $end
        $overSelection = $snapshot.selectionStart -eq $start -and $snapshot.selectionEnd -eq $end -and $start -ne $end
        if (-not $atCaret -and -not $overSelection) { Select-MirrorRange $start $end $old }
        if (-not ([System.Windows.Automation.AutomationElement]::FocusedElement).Equals($script:mirror.element)) { return @{ accepted=$false; snapshot=(Read-Mirror) } }
        try {
            if ($atCaret) {
                $removed = (New-Object System.Globalization.StringInfo $old.Substring($start, $end - $start)).LengthInTextElements
                for ($index = 0; $index -lt $removed; $index++) { Tap-Key 'Backspace' }
                if ($insert.Length) { Insert-Text $insert }
            } elseif ($insert.Length) { Insert-Text $insert }
            elseif ($overSelection) { Tap-Key 'Backspace' }
            else { Tap-Key 'Delete' }
            # UI Automation providers can publish text after SendInput returns; a paste lands later still.
            for ($attempt=0; $attempt -lt 60; $attempt++) {
                $updated = Read-Mirror
                if ($updated.session -cne $snapshot.session -or $updated.text -ceq $next) { break }
                Start-Sleep -Milliseconds 10
            }
        } finally { [ClipboardText]::Restore() }
        if ($updated.session -ceq $snapshot.session -and $updated.text -cne $next -and $atCaret -and $end -eq $old.Length -and
                $old.Length -and -not $old.Contains("`n")) {
            # Typing at the end turned the whole text into just the typed text, or Backspace at the end removed nothing:
            # the old text was a placeholder, not content.
            $revealed = ($start -eq $end -and $updated.text -ceq $insert) -or (-not $insert.Length -and $updated.text -ceq $old)
            if ($revealed -and -not $insert.Length) { Start-Sleep -Milliseconds 300; $revealed = (Read-Mirror).text -ceq $old }
            if ($revealed) {
                Add-Placeholder $script:mirror.element $old
                $updated = Read-Mirror
            }
        }
        if ($updated.session -cne $snapshot.session -or $updated.text -cne $next) { return @{ accepted=$false; snapshot=$updated } }
    }
    $script:mirror.lastOperation=[string]$data.operationId
    if ($changed -and $selectionStart -eq $landed -and $selectionEnd -eq $landed) {
        # The caret already sits after the edit; record that in case the provider reports it elsewhere.
        if ($updated.selectionStart -ne $landed -or $updated.selectionEnd -ne $landed) {
            $script:mirror.believed = @{ text=$next; reportedStart=$updated.selectionStart; reportedEnd=$updated.selectionEnd; start=$landed; end=$landed }
        }
    } else { Select-MirrorRange $selectionStart $selectionEnd $next }
    return @{ accepted=$true; snapshot=(Read-Mirror) }
}
