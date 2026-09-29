import { icon } from './icons.js';
const rows = {
    functions: Array.from({ length: 14 }, (_, index) => [`F${index + 1}`, `F${index + 1}`]),
    media: [
        ['VolumeMute', 'Mute', 'mute'],
        ['VolumeDown', 'Volume down', 'quieter'],
        ['VolumeUp', 'Volume up', 'louder'],
        ['PlayPause', 'Play / pause', 'play'],
    ],
    edit: [
        ['Escape', 'ESC'],
        ['X', 'Cut', 'cut'],
        ['C', 'Copy', 'copy'],
        ['V', 'Paste', 'paste'],
        ['Backspace', 'Backspace', 'delete'],
        ['Delete', 'Delete', 'delete'],
    ],
    modifiers: [
        ['Shift', 'Shift', 'shift'],
        ['Control', 'CTRL'],
        ['Alt', 'ALT'],
        ['Win', 'Windows', 'windows'],
        ['Tab', 'TAB'],
        ['Enter', 'Enter', 'enter'],
    ],
};
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Win']);
class KeyRows extends HTMLElement {
    held = new Set();
    sticky = false;
    connectedCallback() {
        if (this.firstChild) return;
        for (const [name, keys] of Object.entries(rows)) {
            const row = document.createElement('div');
            row.className = `key-row ${name}`;
            row.dataset.row = name;
            for (const [key, label, glyph] of keys) {
                const button = document.createElement('button');
                button.dataset.key = key;
                button.setAttribute('aria-label', label);
                if (glyph) button.append(icon(glyph));
                else button.textContent = label;
                if (key === 'Delete') button.classList.add('forward-delete');
                if (modifierKeys.has(key)) button.setAttribute('aria-pressed', 'false');
                button.addEventListener('pointerdown', (event) => event.preventDefault());
                button.addEventListener('click', () => {
                    if (modifierKeys.has(key)) {
                        if (this.held.has(key)) this.held.delete(key);
                        else this.held.add(key);
                        this.dispatchEvent(
                            new CustomEvent('command', {
                                bubbles: true,
                                detail: { action: 'key', data: { key, down: this.held.has(key) } },
                            })
                        );
                        this.updatePressed();
                        return;
                    }
                    const modifiers = [...this.held];
                    if (['C', 'V', 'X'].includes(key) && !modifiers.includes('Control')) modifiers.push('Control');
                    this.dispatchEvent(
                        new CustomEvent('command', {
                            bubbles: true,
                            detail: { action: 'shortcut', data: { key, modifiers } },
                        })
                    );
                    if (!this.sticky) this.reset();
                });
                row.append(button);
            }
            this.append(row);
        }
    }
    updatePressed() {
        this.querySelectorAll('[aria-pressed]').forEach((button) =>
            button.setAttribute('aria-pressed', String(this.held.has(button.dataset.key)))
        );
    }
    reset() {
        for (const key of this.held)
            this.dispatchEvent(
                new CustomEvent('command', { bubbles: true, detail: { action: 'key', data: { key, down: false } } })
            );
        this.held.clear();
        this.updatePressed();
    }
    configure(settings, editing) {
        this.sticky = settings.sticky;
        for (const row of this.children)
            row.hidden = !settings[row.dataset.row] || (editing && row.dataset.row !== 'modifiers');
    }
}
customElements.define('key-rows', KeyRows);
