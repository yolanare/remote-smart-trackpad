# Zero-width anchors in the phone's text field

Mobile keyboards give a web page no Backspace key event when the field is empty, and their cursor (Gboard's space
bar drag) can only move through text the field holds. The phone's text field therefore holds zero-width spaces that
are not text: one before the mirrored text, so Backspace at its start still deletes something, and a run of them on
each side of the echo when typing blind, so the keyboard's cursor can move past what the phone knows. Deleting or
crossing an anchor becomes a key press on the PC. They are stripped from every text read and never sent.

## Considered Options

- Listening for key events only: mobile keyboards send none for most typing (they commit text through the IME).
- A hidden contenteditable: same keyboard behaviour, harder caret control.
