$script:mirror = $null
. (Join-Path $PSScriptRoot 'field-content.ps1')

# The text as the phone gets it: one kind of line break, and plain spaces. Rich-text fields keep a space typed at the
# end of a line as a no-break space until more text follows; the user typed a space, and an edit checked against
# its own text must find one there.
function Normalize-MirrorText([string]$text) { return (Normalize-LineEndings $text).Replace([string][char]0xA0, ' ') }

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

# Decides what UI Automation's text of the focused field really is. Returns empty when the field only shows a
# placeholder (or nothing), unreadable when its content lives elsewhere, and neither when the text is the content.
# $caret is the selection start in that text. The verdict only changes with the field, its text or the caret, and
# asking IAccessible2 costs tens of milliseconds, so it is kept until one of them changes (polls keep reading the
# same field while nothing happens).
$script:resolvedField = $null
$script:readOnlyField = $null
function Resolve-FieldText($element, [string]$text, [int]$caret) {
    $cached = $script:resolvedField
    if ($null -ne $cached -and $cached.caret -eq $caret -and $cached.text -ceq $text -and $element.Equals($cached.element)) {
        return $cached.verdict
    }
    $verdict = Find-FieldVerdict $element $text $caret
    $script:resolvedField = @{ element=$element; text=$text; caret=$caret; verdict=$verdict }
    return $verdict
}
function Find-FieldVerdict($element, [string]$text, [int]$caret) {
    $current = $element.Current
    $content = $null
    if ($current.FrameworkId -in @('Chrome', 'Gecko')) {
        # Right after a focus change IAccessible2 can lag behind UI Automation for a moment (Firefox then reports no
        # tag yet; all its fields have one, its own interface included).
        for ($attempt = 0; $attempt -lt 3 -and ($null -eq $content -or ($current.FrameworkId -eq 'Gecko' -and -not $content.Dom)); $attempt++) {
            if ($attempt) { Start-Sleep -Milliseconds 30 }
            $content = [FieldContent]::Focused($current.Name)
        }
    }
    if ($null -eq $content) {
        # Without IAccessible2, an input that hides its content exposes its accessible name as text instead. A
        # classic Windows edit box tells single-line from multi-line by its window style.
        $singleLine = [FieldContent]::Win32SingleLine([IntPtr]$current.NativeWindowHandle, $current.ClassName)
        return @{ unreadable=($text.Length -and $text -ceq $current.Name); empty=$false; singleLine=$singleLine }
    }
    # Chrome's own text fields (its address bar): their text is the user's, except that empty they read as their name.
    if (-not $content.Dom -and $current.FrameworkId -eq 'Chrome') { return @{ unreadable=$false; empty=($text -ceq $current.Name); singleLine=$content.SingleLine } }
    if ($content.Native) {
        # A field too small to show any text is the hidden input of an editor drawn elsewhere (VS Code's editor and
        # terminal): unreadable, the phone types blind. Whatever it holds: such an editor leaves each typed character
        # in it for a moment, and mirroring that would echo the character back on the phone, typed a second time.
        $box = $current.BoundingRectangle
        if ($box.Width -lt 20 -or $box.Height -lt 8) { return @{ unreadable=$true; empty=$true; native=$true } }
        # <input>/<textarea>: the value is the content. Empty, UI Automation reads the placeholder as an embedded
        # object (U+FFFC) or the accessible name instead.
        return @{ unreadable=$false; empty=(-not $content.Value.Length); native=$true; singleLine=$content.SingleLine }
    }
    # Rich text (contenteditable): without editable content, any visible text is drawn by the page (a placeholder:
    # CSS generated content, contenteditable=false), and zero-width anchors alone show nothing. Line breaks typed
    # into an empty field are content and stay.
    # Rich text always takes new lines (Enter would send a chat message), even where it calls itself single-line:
    # Firefox does so for a role=textbox without aria-multiline.
    if ($content.EditableText -or $content.EditableObject) { return @{ unreadable=$false; empty=$false } }
    # Firefox hides the text nodes of role=textbox fields, so nothing tells their text from a generated placeholder;
    # its caret follows the document though, and generated text is out of its reach: a caret past the start can
    # only stand after real text.
    if ($current.FrameworkId -eq 'Gecko' -and $content.Leafless -and $caret -gt 0) { return @{ unreadable=$false; empty=$false } }
    return @{ unreadable=$false; empty=([FieldContent]::HasVisibleCharacter($text) -or [FieldContent]::HasOnlyAnchors($text)) }
}

# UI Automation calls fail for a moment while an app rebuilds the field it reads (Chromium after a Backspace: the
# element or its text range is gone). Reading again a little later finds the new one; a lasting failure still throws.
function Read-Mirror {
    for ($attempt = 1; ; $attempt++) {
        try { return Read-MirrorOnce }
        catch {
            if ($attempt -ge 3) { throw }
            Start-Sleep -Milliseconds 25
        }
    }
}

function Read-MirrorOnce {
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    # Which UI element has the focus, readable or not: the phone keeps what it typed blind while this stays the same.
    $field = if ($null -ne $element) { ($element.GetRuntimeId() -join '.') } else { '' }
    $pattern = $null
    $valuePattern = $null
    if ($null -eq $element -or $element.Current.IsPassword -or
        -not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
        $script:mirror = $null
        return @{ field=$field; available=$false; text=''; selectionStart=0; selectionEnd=0 }
    }
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and $valuePattern.Current.IsReadOnly) {
        $script:mirror = $null
        return @{ field=$field; available=$false; text=''; selectionStart=0; selectionEnd=0 }
    }
    # Some providers refuse to report it at times (WPF's RichTextBox): the field cannot be followed, type blind.
    $ranges = try { $pattern.GetSelection() } catch { $null }
    if ($null -eq $ranges -or $ranges.Count -ne 1) { $script:mirror = $null; return @{ field=$field; available=$false; text='' } }
    $document = $pattern.DocumentRange
    # Read-only text (a web page rather than a field). The selection is the cheap hint; a caret next to a
    # non-editable part (a placeholder, a mention) reads read-only too, so the whole document confirms it. That scan
    # takes up to seconds in a long text area, so its answer is kept for the field.
    if ($ranges[0].GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute) -eq $true) {
        $known = $script:readOnlyField
        if ($null -eq $known -or -not $element.Equals($known.element)) {
            $known = @{ element=$element; readOnly=($document.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute) -eq $true) }
            $script:readOnlyField = $known
        }
        if ($known.readOnly) {
            $script:mirror = $null
            return @{ field=$field; available=$false; text='' }
        }
    }
    $raw = $document.GetText(262145)
    if ($raw.Length -gt 262144) { $script:mirror = $null; return @{ field=$field; available=$false; text=''; reason='This field exceeds the 256 Ki character mirror limit.' } }
    $text = Normalize-MirrorText $raw
    $prefix = $document.Clone()
    $prefix.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $ranges[0], [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
    $start = (Normalize-MirrorText ($prefix.GetText(262145))).Length
    # The end follows from the selected text itself, without reading the text before it a second time.
    $end = $start + (Normalize-MirrorText ($ranges[0].GetText(262145))).Length
    $resolved = Resolve-FieldText $element $text $start
    if ($resolved.unreadable) {
        $script:mirror = $null
        return @{ field=$field; available=$false; text=''; selectionStart=0; selectionEnd=0; reason='Text not readable here' }
    }
    if ($resolved.empty) { $text = ''; $start = 0; $end = 0 }
    $framework = $element.Current.FrameworkId
    # Rich text only: in an <input>/<textarea> every line break is the user's.
    $rich = $framework -in @('Chrome', 'Gecko') -and -not $resolved.native
    # An emptied rich-text field keeps one <br>, displayed as a single empty line.
    if ($rich -and $text -ceq "`n") { $text = ''; $start = 0; $end = 0 }
    if ($rich -and $framework -eq 'Chrome') {
        if ($text.EndsWith("`n") -and (Test-PhantomBreak $element)) {
            $text = $text.Substring(0, $text.Length - 1)
            $start = [Math]::Min($start, $text.Length); $end = [Math]::Min($end, $text.Length)
        }
    }
    # A Windows rich edit box (RichEdit, WinForms' RichTextBox) ends with a paragraph mark the caret never passes.
    if ($framework -in @('Win32', 'WinForm') -and $element.Current.ClassName -like '*RichEdit*' -and $text.EndsWith("`n")) {
        $text = $text.Substring(0, $text.Length - 1)
        $start = [Math]::Min($start, $text.Length); $end = [Math]::Min($end, $text.Length)
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
    # singleLine: the field cannot hold a line break (an <input>, a one-line edit box): the phone's Enter key sends
    # Enter there instead of a new line.
    return @{ field=$field; available=$true; session=$script:mirror.id; revision=$script:mirror.revision; text=$text; selectionStart=$start; selectionEnd=$end; singleLine=($resolved.singleLine -eq $true) }
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
    if ((Normalize-MirrorText ($range.GetText(262145))) -cne $text.Substring($start, $end - $start)) { throw 'PC text range differs' }
    # A caret at the start of a line is ambiguous in Chromium: it can resolve to the end of the previous line. Place
    # it instead right after the last real character before the line breaks, then step over them with Right.
    if ($start -eq $end -and $start -gt 0 -and $text[$start - 1] -eq "`n" -and
            -not ($held.Contains('Shift') -or $held.Contains('Control') -or $held.Contains('Alt'))) {
        $anchor = $start
        while ($anchor -gt 0 -and $text[$anchor - 1] -eq "`n") { $anchor-- }
        Select-MirrorRange $anchor $anchor $text
        for ($step = $anchor; $step -lt $start; $step++) { Tap-Key 'Right' }
        return
    }
    $range.Select()
}

# Inline completion (an address bar, a search box): the field shows what was typed followed by a suggestion it
# selected, so typing on replaces it. That is the typing applied, not a different text.
function Test-InlineCompletion($updated, [string]$next, [int]$landed) {
    $added = $updated.text.Length - $next.Length
    return $updated.available -and $added -gt 0 -and $updated.selectionStart -eq $landed -and
        $updated.selectionEnd -eq $landed + $added -and $updated.text.StartsWith($next.Substring(0, $landed), [StringComparison]::Ordinal) -and
        $updated.text.EndsWith($next.Substring($landed), [StringComparison]::Ordinal)
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
            # UI Automation providers can publish text after SendInput returns; a paste lands later still. A field that
            # reshapes what it is typed (an input mask, a case change, a length limit) never shows the expected text:
            # once its text has changed and stays so for a moment, that is its answer.
            $clock = [System.Diagnostics.Stopwatch]::StartNew()
            $seen = $null; $seenAt = 0
            for ($attempt=0; $attempt -lt 60; $attempt++) {
                $updated = Read-Mirror
                if ($updated.session -cne $snapshot.session -or $updated.text -ceq $next -or (Test-InlineCompletion $updated $next $landed)) { break }
                if ($updated.text -cne $seen) { $seen = $updated.text; $seenAt = $clock.ElapsedMilliseconds }
                elseif ($seen -cne $old -and $clock.ElapsedMilliseconds - $seenAt -ge 120) { break }
                Start-Sleep -Milliseconds 10
            }
        } finally { [ClipboardText]::Restore() }
        $completed = Test-InlineCompletion $updated $next $landed
        # Typed, but the field holds something else: the phone takes the PC's text, never sends the same typing again.
        if ($updated.session -cne $snapshot.session -or ($updated.text -cne $next -and -not $completed)) { return @{ accepted=$false; typed=$true; snapshot=$updated } }
        # The field completed the typing itself and selected the suggestion: the PC's caret and selection stay.
        if ($completed) {
            $script:mirror.lastOperation=[string]$data.operationId
            $script:mirror.believed = $null
            return @{ accepted=$true; snapshot=(Read-Mirror) }
        }
    }
    $script:mirror.lastOperation=[string]$data.operationId
    $natural = $changed -and $selectionStart -eq $landed -and $selectionEnd -eq $landed
    # After typing the caret already sits after the edit; otherwise it is placed where the phone's caret is.
    if (-not $natural) { Select-MirrorRange $selectionStart $selectionEnd $next }
    # Chromium can report the caret at the start of a new empty paragraph one line up after typing; remember where
    # typing put it. A placed caret is reported as is, so a failed placement stays visible on the phone.
    $script:mirror.believed = $null
    $final = Read-Mirror
    if ($natural -and $final.session -ceq $snapshot.session -and $final.text -ceq $next -and
            ($final.selectionStart -ne $selectionStart -or $final.selectionEnd -ne $selectionEnd)) {
        $script:mirror.believed = @{ text=$next; reportedStart=$final.selectionStart; reportedEnd=$final.selectionEnd; start=$selectionStart; end=$selectionEnd }
        $final = Read-Mirror
    }
    return @{ accepted=$true; snapshot=$final }
}
