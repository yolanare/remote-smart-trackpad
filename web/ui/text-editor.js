// A zero-width space before the text keeps a character behind the caret, so mobile keyboards report Backspace even
// when the mirrored field is empty. Deleting it is forwarded to the PC as a Backspace key press.
const anchor = '​';
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
        textarea.value = anchor;
        this.composing = false;
        this.invalidated = false;
        const emit = (name, detail) => this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
        const read = () => {
            const raw = textarea.value,
                at = raw.indexOf(anchor);
            const shift = (position) => (at >= 0 && position > at ? position - 1 : position);
            return {
                at,
                text: at < 0 ? raw : raw.slice(0, at) + raw.slice(at + 1),
                start: shift(textarea.selectionStart),
                end: shift(textarea.selectionEnd),
            };
        };
        const input = () => {
            const { at, text, start, end } = read();
            if (at !== 0 && !this.composing) this.write(text, start, end);
            if (at < 0 && text === this.text) emit('text-key', { key: 'Backspace' });
            else if (this.passthrough) {
                if (!this.composing) this.forward(text, start, emit);
            } else if (!this.invalidated) {
                this.text = text;
                emit('text-input', { text, start, end });
            }
            this.resize();
            this.updateHint();
        };
        textarea.addEventListener('beforeinput', (event) => {
            this.caret = read().start;
            // Phone keyboards often skip the Enter keydown: the line break they insert is the Enter key, too.
            if (!['insertLineBreak', 'insertParagraph'].includes(event.inputType) || !this.submits()) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            emit('text-key', { key: 'Enter' });
        });
        textarea.addEventListener('input', input);
        textarea.addEventListener('select', () => {
            // A selection placed by render() is the PC's own caret, not an edit to send back.
            if (textarea.selectionStart === this.writtenStart && textarea.selectionEnd === this.writtenEnd) return;
            input();
        });
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
            if (this.passthrough && navigationKeys.has(key)) this.clearEcho();
        });
        // Keep the caret after the anchor so Backspace always has something to delete.
        document.addEventListener('selectionchange', () => {
            if (
                document.activeElement === textarea
                && !this.composing
                && textarea.selectionStart === 0
                && textarea.value.startsWith(anchor)
            )
                textarea.setSelectionRange(1, Math.max(1, textarea.selectionEnd));
        });
        textarea.addEventListener('compositionstart', () => {
            this.composing = true;
            this.updateHint();
            this.invalidated = false;
            emit('text-composition', true);
        });
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
     * In a PC field that holds one line (a search box, an <input>), Enter cannot add a line: the keyboard's Enter key
     * presses Enter there (search, submit). Anywhere else it adds a line, never sending a message by mistake.
     */
    submits() {
        return this.singleLine && !this.passthrough;
    }
    /** Sends the difference from the last forwarded text as key presses and typed text. */
    forward(text, caret, emit) {
        const previous = this.text;
        const shorter = Math.min(previous.length, text.length);
        let prefix = 0,
            suffix = 0;
        while (prefix < shorter && previous[prefix] === text[prefix]) prefix++;
        while (suffix < shorter - prefix && previous[previous.length - 1 - suffix] === text[text.length - 1 - suffix])
            suffix++;
        const removed = [...segmenter.segment(previous.slice(prefix, previous.length - suffix))].length;
        const inserted = text.slice(prefix, text.length - suffix);
        const forwardDelete = !inserted && this.caret <= prefix;
        this.text = text;
        this.caret = caret;
        if (removed || inserted)
            emit('text-passthrough', {
                backspace: forwardDelete ? 0 : removed,
                delete: forwardDelete ? removed : 0,
                text: inserted,
            });
    }
    /** The field's own placeholder cannot show behind the anchor, so blind typing gets an overlay hint. */
    updateHint() {
        const empty = this.firstElementChild.value.replace(anchor, '') === '';
        this.classList.toggle('show-hint', this.passthrough && empty && !this.composing);
    }
    write(text, start, end) {
        const field = this.firstElementChild;
        if (field.value !== anchor + text) field.value = anchor + text;
        if (field.selectionStart !== start + 1 || field.selectionEnd !== end + 1)
            field.setSelectionRange(start + 1, end + 1);
        this.writtenStart = start + 1;
        this.writtenEnd = end + 1;
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
        if (this.composing && (this.state?.session !== state.session || this.state?.revision !== state.revision))
            this.invalidated = true;
        // Text typed blind stays on the phone, to read and fix, while the PC's focus stays on the same element;
        // another element starts afresh (so do closing, and moving the caret: clearEcho).
        const keepEcho = this.passthrough && state.passthrough && state.field === this.state?.field;
        this.state = state;
        this.passthrough = state.passthrough === true;
        this.singleLine = state.available === true && state.singleLine === true;
        // The keyboard's Enter key shows what it does: an action in a one-line field, a new line elsewhere.
        this.firstElementChild.enterKeyHint = this.submits() ? 'go' : 'enter';
        // Never read-only while the first read is on its way: the phone would not show its keyboard on the focus.
        this.firstElementChild.readOnly = !state.available && !this.passthrough && !state.reading;
        if (!keepEcho) {
            this.text = state.text;
            this.write(state.text, state.selectionStart, state.selectionEnd);
        }
        this.resize();
        this.updateHint();
    }
    /** Forgets the text typed blind, once it no longer matches the PC (the caret moved away from it). */
    clearEcho() {
        if (!this.passthrough || this.composing) return;
        this.text = '';
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
