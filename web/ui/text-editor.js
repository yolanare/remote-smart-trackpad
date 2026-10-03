import { replacementFor } from '../text-operations.js';

// A zero-width space before the text keeps a character behind the caret, so mobile keyboards report Backspace even
// when the mirrored field is empty. Deleting it is forwarded to the PC as a Backspace key press.
const anchor = String.fromCharCode(0x200b);
// Typing blind, a run of them on each side of the text typed: the keyboard's cursor (Gboard's space bar drag) can
// move past that text, and each step it moves is an arrow key on the PC. Deleting one is Backspace or Delete there.
const margin = 32;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Keys that never change the local text; they are always sent to the PC.
const forwardedKeys = { Escape: 'Escape', Tab: 'Tab' };
// While typing blind (no readable PC field) the local caret has no meaning, so navigation goes to the PC too.
const passthroughKeys = {
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Delete: 'Delete',
};

const sizesItself = CSS.supports('field-sizing', 'content');

const navigationKeys = new Set(['Left', 'Right', 'Up', 'Down', 'Home', 'End', 'PageUp', 'PageDown']);

class TextEditor extends HTMLElement {
    text = '';
    caret = 0;
    passthrough = false;
    connectedCallback() {
        if (this.firstChild) return;
        this.innerHTML =
            '<textarea id="editor-text" rows="1" aria-label="PC text field" spellcheck="true" autocapitalize="sentences"></textarea><span class="editor-hint" aria-hidden="true">Cannot retrieve text here. Start typing to edit</span>';
        const textarea = this.firstElementChild;
        textarea.value = this.written = anchor;
        this.writtenLead = 1;
        this.writtenPads = 1;
        this.composing = false;
        this.invalidated = false;
        const emit = (name, detail) => this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
        // The text and selection without the anchors, read as they were written: one anchor before the PC's text
        // (which may hold zero-width spaces of its own), anchors only around the text typed blind.
        const read = () => {
            const raw = textarea.value;
            if (this.writtenLead > 1) {
                const strip = (part) => part.replaceAll(anchor, '');
                return {
                    at: 0,
                    pads: raw.length - strip(raw).length,
                    lead: raw.length - raw.replace(/^\u200b+/, '').length,
                    text: strip(raw),
                    start: strip(raw.slice(0, textarea.selectionStart)).length,
                    end: strip(raw.slice(0, textarea.selectionEnd)).length,
                };
            }
            const at = raw.indexOf(anchor);
            const shift = (position) => (at >= 0 && position > at ? position - 1 : position);
            return {
                at,
                text: at < 0 ? raw : raw.slice(0, at) + raw.slice(at + 1),
                start: shift(textarea.selectionStart),
                end: shift(textarea.selectionEnd),
            };
        };
        const input = () => {
            const { at, pads, lead, text, start, end } = read();
            // An anchor deleted, the text as it was: the key went past the text the phone has. One at a time (a key
            // press): a keyboard deleting a selection that reaches into them only deletes the text in it.
            const erased = pads === undefined ? Number(at < 0) : this.writtenPads - pads;
            if (!this.composing && textarea.value !== this.layout(text)) this.write(text, start, end);
            else {
                // What the field holds now is the layout the caret is followed in (see followCaret).
                this.written = textarea.value;
                this.writtenPads = textarea.value.length - text.length;
            }
            if (text === this.text && erased > 0) {
                const forward = pads !== undefined && lead === this.writtenLead;
                if (erased === 1) emit('text-key', { key: forward ? 'Delete' : 'Backspace' });
            } else if (this.passthrough) {
                if (!this.composing) this.forward(text, start, emit);
            } else if (!this.invalidated) {
                // previous: the text this typing went over, which the PC's text may have replaced meanwhile (a
                // composition defers writing it, see render).
                const previous = this.text;
                this.text = text;
                emit('text-input', { text, start, end, previous });
            }
            this.resize();
            this.updateHint();
        };
        textarea.addEventListener('beforeinput', (event) => {
            // Phone keyboards often skip the Enter keydown: the line break they insert is the Enter key, too.
            if (!['insertLineBreak', 'insertParagraph'].includes(event.inputType) || !this.submits()) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            emit('text-key', { key: 'Enter' });
            // Typed blind, Enter leaves the line (or sends it): the echoed text no longer borders the PC's caret.
            if (this.passthrough) this.clearEcho();
        });
        textarea.addEventListener('input', input);
        textarea.addEventListener('select', () => {
            // A selection placed by render() is the PC's own caret, not an edit to send back.
            if (textarea.selectionStart === this.writtenStart && textarea.selectionEnd === this.writtenEnd) return;
            input();
        });
        // The keyboard moving its cursor (Gboard: dragging on the space bar) moves the PC's caret too.
        const followCaret = () => {
            if (textarea.value !== this.written) return;
            const { selectionStart: from, selectionEnd: to } = textarea;
            if (this.passthrough) {
                // A selection (the keyboard selecting words to delete) goes once deleted, as the keys erasing it.
                if (from !== to) return;
                const target = from - this.writtenLead,
                    steps = target - this.caret;
                if (!steps) return;
                emit('text-move', { key: steps < 0 ? 'Left' : 'Right', count: Math.abs(steps) });
                // Past the text typed blind, the phone no longer knows what borders the PC's caret: it starts afresh,
                // its cursor back between the anchors to go on moving either way.
                if (target < 0 || target > this.text.length) this.clearEcho();
                else this.caret = target;
                return;
            }
            if (from === this.writtenStart && to === this.writtenEnd) return;
            input();
        };
        textarea.addEventListener('keydown', (event) => {
            if (event.isComposing || event.keyCode === 229) return;
            const { start, end } = read();
            const key =
                forwardedKeys[event.key]
                || (this.passthrough && passthroughKeys[event.key])
                || (event.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0 ?
                    'Backspace'
                :   null)
                || (event.key === 'Delete' && start === end && end === this.text.length ? 'Delete' : null)
                || (event.key === 'Enter' && this.submits() ? 'Enter' : null);
            if (!key) return;
            event.preventDefault();
            emit('text-key', { key });
            // Moving the PC's caret blind leaves the echoed text behind: it no longer matches what follows the caret.
            if (this.passthrough && (navigationKeys.has(key) || key === 'Enter')) this.clearEcho();
        });
        document.addEventListener('selectionchange', () => {
            if (document.activeElement !== textarea || this.composing) return;
            // Keep the caret after the anchor so Backspace always has something to delete.
            if (!this.passthrough && textarea.selectionStart === 0 && textarea.value.startsWith(anchor))
                textarea.setSelectionRange(1, Math.max(1, textarea.selectionEnd));
            else followCaret();
        });
        textarea.addEventListener('compositionstart', () => {
            this.composing = true;
            this.updateHint();
            this.invalidated = false;
            this.composedIn = { field: this.state?.field, session: this.state?.session };
            emit('text-composition', true);
        });
        // The PC's text that arrived during the composition was not written (see render): the typing wins, sent
        // against the PC's latest state, unless the PC's focus moved to another field meanwhile.
        textarea.addEventListener('compositionend', () => {
            this.composing = false;
            if (this.invalidated) {
                this.invalidated = false;
                this.render(this.state);
            } else input();
            emit('text-composition', false);
        });
    }
    /**
     * The keyboard's Enter key presses Enter (search, submit, run) where a new line cannot be mirrored: a PC field
     * that holds one line (a search box, an <input>), or one the phone cannot read (typing blind). Only in a
     * readable multi-line field does it add a line, never sending a message by mistake.
     */
    submits() {
        return this.passthrough || this.singleLine;
    }
    /**
     * Sends the difference from the last forwarded text as key presses and typed text, at the PC's caret (this.caret,
     * in the text typed blind): Backspace erases up to it, Delete after it. A change elsewhere (a word the keyboard
     * selected before the cursor and replaced) first moves the PC's caret to its end.
     */
    forward(text, caret, emit) {
        const previous = this.text;
        const change = replacementFor(previous, text, caret);
        const removed = [...segmenter.segment(previous.slice(change.start, change.end))].length;
        const forwardDelete = !change.text && change.start === this.caret;
        const steps = forwardDelete ? 0 : change.end - this.caret;
        // No change (a selection the keyboard made): the PC's caret has not moved.
        if (!removed && !change.text) return;
        this.text = text;
        this.caret = caret;
        if (steps) emit('text-move', { key: steps < 0 ? 'Left' : 'Right', count: Math.abs(steps) });
        emit('text-passthrough', {
            backspace: forwardDelete ? 0 : removed,
            delete: forwardDelete ? removed : 0,
            text: change.text,
        });
    }
    /** The field's own placeholder cannot show behind the anchor, so blind typing gets an overlay hint. */
    updateHint() {
        const empty = this.firstElementChild.value.replaceAll(anchor, '') === '';
        this.classList.toggle('show-hint', this.passthrough && empty && !this.composing);
    }
    /** The field's value for `text`: the anchor before the PC's text, or the anchors around the text typed blind. */
    layout(text) {
        return this.passthrough ? anchor.repeat(margin) + text + anchor.repeat(margin) : anchor + text;
    }
    write(text, start, end) {
        const field = this.firstElementChild;
        const value = this.layout(text),
            lead = this.passthrough ? margin : 1;
        if (field.value !== value) field.value = value;
        if (field.selectionStart !== start + lead || field.selectionEnd !== end + lead)
            field.setSelectionRange(start + lead, end + lead);
        this.written = value;
        this.writtenLead = lead;
        this.writtenPads = value.length - text.length;
        this.writtenStart = start + lead;
        this.writtenEnd = end + lead;
    }
    /** The field grows with its text through CSS field-sizing; this measures it where that is unsupported (Firefox). */
    resize() {
        if (sizesItself) return;
        const field = this.firstElementChild;
        field.style.height = 'auto';
        const borders = field.offsetHeight - field.clientHeight;
        field.style.height = `${(field.scrollHeight + borders) / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`;
    }
    render(state) {
        // During an IME composition the field is the keyboard's: writing into it makes the keyboard commit its word
        // again, a doubled letter. Only the state is taken; the text waits for the composition's end.
        if (this.composing) {
            const moved = state.field !== this.composedIn?.field || state.session !== this.composedIn?.session;
            if (moved && !state.keepEcho) this.invalidated = true;
            this.applyState(state);
            return;
        }
        // Text typed blind stays on the phone, to read and fix, while the PC's focus stays where it was typed (the
        // app says so: keepEcho); another element starts afresh (so do closing, and moving the caret: clearEcho).
        const keepEcho = this.passthrough && state.passthrough && (state.keepEcho ?? state.field === this.state?.field);
        this.applyState(state);
        if (!keepEcho) {
            this.text = state.text;
            this.caret = state.selectionStart;
            this.write(state.text, state.selectionStart, state.selectionEnd);
        }
        this.resize();
        this.updateHint();
    }
    /** Everything a PC state sets but the text itself. */
    applyState(state) {
        this.state = state;
        this.passthrough = state.passthrough === true;
        this.singleLine = state.available === true && state.singleLine === true;
        // The keyboard's Enter key shows what it does: an action where it presses Enter, a new line elsewhere.
        this.firstElementChild.enterKeyHint = this.submits() ? 'go' : 'enter';
        // Never read-only while the first read is on its way: the phone would not show its keyboard on the focus.
        this.firstElementChild.readOnly = !state.available && !this.passthrough && !state.reading;
    }
    /** Forgets the text typed blind, once it no longer matches the PC (the caret moved away from it). */
    clearEcho() {
        if (!this.passthrough || this.composing) return;
        this.text = '';
        this.caret = 0;
        this.write('', 0, 0);
        this.resize();
        this.updateHint();
    }
    focus() {
        this.firstElementChild.focus({ preventScroll: true });
    }
    blur() {
        this.firstElementChild.blur();
    }
}
customElements.define('text-editor', TextEditor);
