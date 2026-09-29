import { icon } from './icons.js';
const rows = {
    // [key, label, icon (null for text), group]; matching adjacent groups share smaller corners.
    functions: Array.from({ length: 14 }, (_, index) => [`F${index + 1}`, `F${index + 1}`, null, 'functions']),
    media: [
        ['PlayPause', 'Play / pause', 'play', null],
        ['VolumeMute', 'Mute', 'mute', 'media'],
        ['VolumeDown', 'Volume down', 'quieter', 'media'],
        ['VolumeUp', 'Volume up', 'louder', 'media'],
    ],
    edit: [
        ['Escape', 'ESC', null, null],
        ['X', 'Cut', 'cut', 'clipboard'],
        ['C', 'Copy', 'copy', 'clipboard'],
        ['V', 'Paste', 'paste', 'clipboard'],
        ['Backspace', 'Backspace', 'delete', 'delete'],
        ['Delete', 'Delete', 'delete', 'delete'],
    ],
    modifiers: [
        ['Shift', 'Shift', 'shift', 'modifiers'],
        ['Control', 'CTRL', null, 'modifiers'],
        ['Alt', 'ALT', null, 'modifiers'],
        ['Win', 'Windows', 'windows', null],
        ['Tab', 'TAB', null, null],
        ['Enter', 'Enter', 'enter', null],
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
            const columns = name === 'functions' ? 7 : keys.length;
            row.style.setProperty('--columns', columns);
            for (const [index, [key, label, glyph, group]] of keys.entries()) {
                const button = document.createElement('button');
                const matches = (neighbor) => group != null && keys[neighbor]?.[3] === group;
                const left = index % columns > 0 && matches(index - 1);
                const right = index % columns < columns - 1 && matches(index + 1);
                const above = matches(index - columns);
                const below = matches(index + columns);
                button.classList.toggle('round-top-left', !left && !above);
                button.classList.toggle('round-top-right', !right && !above);
                button.classList.toggle('round-bottom-left', !left && !below);
                button.classList.toggle('round-bottom-right', !right && !below);
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
