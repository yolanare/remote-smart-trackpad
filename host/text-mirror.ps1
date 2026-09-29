$script:mirror = $null

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
    if ($null -eq $script:mirror -or -not $element.Equals($script:mirror.element)) {
        $script:mirror = @{ id=[guid]::NewGuid().ToString('N'); revision=0; element=$element; text=$text; start=$start; end=$end; lastOperation=$null }
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
    if ($old -cne $next) {
        Select-MirrorRange $start $end $old
        if (-not ([System.Windows.Automation.AutomationElement]::FocusedElement).Equals($script:mirror.element)) { return @{ accepted=$false; snapshot=(Read-Mirror) } }
        if ($insert.Length) {
            if (-not [NativeInput]::Text($insert)) { throw 'Windows rejected text input' }
        } else { Tap-Key 'Delete' }
        # UI Automation providers can publish text after SendInput returns.
        for ($attempt=0; $attempt -lt 20; $attempt++) {
            $updated = Read-Mirror
            if ($updated.session -cne $snapshot.session -or $updated.text -ceq $next) { break }
            Start-Sleep -Milliseconds 10
        }
        if ($updated.session -cne $snapshot.session -or $updated.text -cne $next) { return @{ accepted=$false; snapshot=$updated } }
    }
    Select-MirrorRange $selectionStart $selectionEnd $next
    $script:mirror.lastOperation=[string]$data.operationId
    return @{ accepted=$true; snapshot=(Read-Mirror) }
}
