class TextEditor extends HTMLElement {
    connectedCallback() {
        if (this.firstChild) return;
        this.innerHTML =
            '<textarea id="editor-text" aria-label="PC text field" placeholder="Select an editable text field on your PC" spellcheck="true" autocapitalize="sentences"></textarea>';
        const textarea = this.firstElementChild;
        this.composing = false;
        this.invalidated = false;
        const emit = (name, detail) => this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
        const input = () => {
            if (!this.invalidated)
                emit('text-input', {
                    text: textarea.value,
                    start: textarea.selectionStart,
                    end: textarea.selectionEnd,
                });
            this.resize();
        };
        textarea.addEventListener('input', input);
        textarea.addEventListener('select', input);
        textarea.addEventListener('compositionstart', () => {
            this.composing = true;
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
    resize() {
        const field = this.firstElementChild;
        field.style.height = 'auto';
        field.style.height = `${Math.min(field.scrollHeight / parseFloat(getComputedStyle(document.documentElement).fontSize), 10.1875)}rem`;
    }
    render(state) {
        const field = this.firstElementChild;
        if (this.composing && (this.state?.session !== state.session || this.state?.revision !== state.revision))
            this.invalidated = true;
        this.state = state;
        field.readOnly = !state.available;
        if (field.value !== state.text) field.value = state.text;
        if (field.selectionStart !== state.selectionStart || field.selectionEnd !== state.selectionEnd)
            field.setSelectionRange(state.selectionStart, state.selectionEnd);
        this.resize();
    }
    focus() {
        this.firstElementChild.focus({ preventScroll: true });
    }
}
customElements.define('text-editor', TextEditor);
