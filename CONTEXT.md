# Remote smart trackpad

A phone becomes the trackpad, keyboard and keys of a Windows PC on the same network. This glossary names what the
phone and the PC exchange when the user types.

## Typing

**PC field**:
The element that has the PC's keyboard focus, readable or not.
_Avoid_: zone, element, target

**Mirror**:
The phone's copy of a readable PC field's text and caret, edited on either side and kept in step.
_Avoid_: sync

**Blind typing**:
Typing into a PC field the phone cannot read: every change goes to the PC as typed text and keys.
_Avoid_: passthrough

**Echo**:
The text typed blind, left on the phone while it still borders the PC's caret.
_Avoid_: kept text

**Typing session**:
Everything that decides, for one opening of the phone's text editor, whether the user is mirroring or typing blind,
what goes to the PC and what the phone shows.

**Readable**:
Said of a PC field whose real text the phone can read, and so mirror.
_Avoid_: available

**Placeholder**:
Text a PC field shows that the user did not type (a hint, a label drawn by the page).
_Avoid_: hint text

## Phone

**Option**:
A choice the user makes in the phone's options menu, remembered on the phone.
_Avoid_: setting, preference
