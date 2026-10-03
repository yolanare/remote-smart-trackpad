# The mirror's rules (docs/adr/0002): pure decisions on facts read from the PC, no UI Automation, no input. The
# mirror (text-mirror.psm1) gathers the facts and acts on the answers; tests/host-rules.test.mjs feeds them recorded
# facts.
$ErrorActionPreference = 'Stop'

function Normalize-LineEndings([string]$text) { return $text.Replace("`r`n", "`n").Replace("`r", "`n") }

# The text as the phone gets it: one kind of line break, and plain spaces. Rich-text fields keep a space typed at the
# end of a line as a no-break space until more text follows; the user typed a space, and an edit checked against
# its own text must find one there.
function Normalize-MirrorText([string]$text) { return (Normalize-LineEndings $text).Replace([string][char]0xA0, ' ') }

# Zero-width anchors editors keep in empty lines, and the embedded-object marker, show nothing.
$invisible = '\uFEFF\u200B-\u200D\u2060\uFFFC'
function Test-VisibleCharacter([string]$text) { return $text -match "[^\s$invisible]" }
function Test-OnlyAnchors([string]$text) { return $text -notmatch "[^$invisible]" }

# The index of the text element (grapheme) starting at $position; the end of the text counts as one past the last.
function Get-ElementIndex([int[]]$starts, [int]$position, [int]$textLength) {
    if ($position -eq $textLength) { return $starts.Length }
    $index = [Array]::BinarySearch($starts, $position)
    if ($index -lt 0) { throw 'Text operation splits a character' }
    return $index
}

<#
What a focused field's text really is (CONTEXT.md: Readable, Placeholder). Facts: framework, name (accessible name),
text, caret (selection start in that text), boxWidth, boxHeight, win32SingleLine (a classic edit box without the
multi-line style), content (what IAccessible2 tells, null without it: dom, native, valueLength, editableText,
editableObject, leafless, singleLine). Answers unreadable (the content lives elsewhere: type blind), empty (only a
placeholder, or nothing), native (an <input>/<textarea>) and singleLine.
#>
function Get-FieldVerdict($facts) {
    $content = $facts.content
    if ($null -eq $content) {
        # Without IAccessible2, an input that hides its content exposes its accessible name as text instead. A
        # classic Windows edit box tells single-line from multi-line by its window style.
        return @{ unreadable=($facts.text.Length -and $facts.text -ceq $facts.name); empty=$false; singleLine=($facts.win32SingleLine -eq $true) }
    }
    # Chrome's own text fields (its address bar): their text is the user's, except that empty they read as their name.
    if (-not $content.dom -and $facts.framework -eq 'Chrome') {
        return @{ unreadable=$false; empty=($facts.text -ceq $facts.name); singleLine=($content.singleLine -eq $true) }
    }
    if ($content.native) {
        # A field too small to show any text is the hidden input of an editor drawn elsewhere (VS Code's editor and
        # terminal): unreadable, the phone types blind. Whatever it holds: such an editor leaves each typed character
        # in it for a moment, and mirroring that would echo the character back on the phone, typed a second time.
        if ($facts.boxWidth -lt 20 -or $facts.boxHeight -lt 8) { return @{ unreadable=$true; empty=$true; native=$true } }
        # <input>/<textarea>: the value is the content. Empty, UI Automation reads the placeholder as an embedded
        # object (U+FFFC) or the accessible name instead.
        return @{ unreadable=$false; empty=(-not $content.valueLength); native=$true; singleLine=($content.singleLine -eq $true) }
    }
    # Rich text (contenteditable): without editable content, any visible text is drawn by the page (a placeholder:
    # CSS generated content, contenteditable=false), and zero-width anchors alone show nothing. Line breaks typed
    # into an empty field are content and stay.
    # Rich text always takes new lines (Enter would send a chat message), even where it calls itself single-line:
    # Firefox does so for a role=textbox without aria-multiline.
    if ($content.editableText -or $content.editableObject) { return @{ unreadable=$false; empty=$false } }
    # Firefox hides the text nodes of role=textbox fields, so nothing tells their text from a generated placeholder;
    # its caret follows the document though, and generated text is out of its reach: a caret past the start can
    # only stand after real text.
    if ($facts.framework -eq 'Gecko' -and $content.leafless -and $facts.caret -gt 0) { return @{ unreadable=$false; empty=$false } }
    return @{ unreadable=$false; empty=((Test-VisibleCharacter $facts.text) -or (Test-OnlyAnchors $facts.text)) }
}

<#
The text and caret a readable field holds once the parts it reports but nobody typed are taken away. Facts:
framework, className, native (from the verdict), text, start, end, phantomBreak (Chromium reports a final line break
the caret can never reach; the mirror asks only when the text ends with one).
#>
function Repair-MirrorText($facts) {
    $text = [string]$facts.text; $start = [int]$facts.start; $end = [int]$facts.end
    $rich = $facts.framework -in @('Chrome', 'Gecko') -and -not $facts.native
    # An emptied rich-text field keeps one <br>, displayed as a single empty line.
    if ($rich -and $text -ceq "`n") { return @{ text=''; start=0; end=0 } }
    $trimmed = $false
    if ($rich -and $facts.framework -eq 'Chrome' -and $text.EndsWith("`n") -and $facts.phantomBreak) { $trimmed = $true }
    # A Windows rich edit box (RichEdit, WinForms' RichTextBox) ends with a paragraph mark the caret never passes.
    if ($facts.framework -in @('Win32', 'WinForm') -and $facts.className -like '*RichEdit*' -and $text.EndsWith("`n")) { $trimmed = $true }
    if ($trimmed) {
        $text = $text.Substring(0, $text.Length - 1)
        $start = [Math]::Min($start, $text.Length); $end = [Math]::Min($end, $text.Length)
    }
    return @{ text=$text; start=$start; end=$end }
}

# Inline completion (an address bar, a search box): the field shows what was typed followed by a suggestion it
# selected, so typing on replaces it. That is the typing applied, not a different text.
function Test-InlineCompletion($updated, [string]$next, [int]$landed) {
    $added = $updated.text.Length - $next.Length
    return $updated.readable -and $added -gt 0 -and $updated.selectionStart -eq $landed -and
        $updated.selectionEnd -eq $landed + $added -and $updated.text.StartsWith($next.Substring(0, $landed), [StringComparison]::Ordinal) -and
        $updated.text.EndsWith($next.Substring($landed), [StringComparison]::Ordinal)
}

<#
Where an edit the PC typed stands, from one read of the field. Facts: old and next (the text before, and the text
the edit makes), landed (the caret right after the typing), session (the field typed into), read (the mirror read
now), stableMs (how long its text has stayed the same). Answers:
- moved: the focus left the field;
- applied: the field holds the expected text;
- completed: it holds it with a suggestion it selected after the caret (inline completion);
- reshaped: it made something else of it (an input mask, a case change, a length limit) and stays so;
- pending: not there yet (UI Automation publishes late, a paste lands later still).
#>
function Get-EditOutcome($facts) {
    $read = $facts.read
    if ($read.session -cne $facts.session) { return 'moved' }
    if ($read.text -ceq $facts.next) { return 'applied' }
    if (Test-InlineCompletion $read $facts.next $facts.landed) { return 'completed' }
    if ($read.text -cne $facts.old -and $facts.stableMs -ge 120) { return 'reshaped' }
    return 'pending'
}

Export-ModuleMember -Function Normalize-LineEndings, Normalize-MirrorText, Get-ElementIndex, Get-FieldVerdict, Repair-MirrorText, Test-InlineCompletion, Get-EditOutcome
