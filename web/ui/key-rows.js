import { icon } from './icons.js';
// [key, label, icon (null for text), group]. Adjacent keys of the same group share one bordered container.
const functionKey = (index) => [`F${index + 1}`, `F${index + 1}`, null, 'functions'];
const rows = {
    functions: [],
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
// Function keys fill lines of at most this many keys, split evenly: 4 and 8 on one line, 12 and 16 on two, 18 and
// 24 on three. Computed, so a wider layout only needs a larger number.
const functionKeysPerLine = 8;
function functionLines(count) {
    const lines = Math.ceil(count / functionKeysPerLine);
    const perLine = Math.ceil(count / lines);
    return Array.from({ length: lines }, (_, line) =>
        Array.from({ length: Math.min(perLine, count - line * perLine) }, (_, index) =>
            functionKey(line * perLine + index)
        )
    );
}
// A thin vertical rule between the buttons of a group; it does not scale with a pressed button.
function separator() {
    const rule = document.createElement('hr');
    rule.className = 'key-separator';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
}
class KeyRows extends HTMLElement {
    held = new Set();
    sticky = false;
    playing = null;
    muted = null;
    functionCount = 0;
    connectedCallback() {
        if (this.firstChild) return;
        for (const [name, keys] of Object.entries(rows)) {
            const row = document.createElement('div');
            row.className = `key-row ${name}`;
            row.dataset.row = name;
            this.append(row);
            if (name !== 'functions') this.fillRow(row, keys);
        }
    }
    /** Consecutive keys of the same group go in one bordered container; a key without a group gets its own. */
    fillRow(row, keys) {
        let group = null;
        keys.forEach(([key, label, glyph, name], index) => {
            if (!group || name == null || keys[index - 1][3] !== name) {
                group = document.createElement('div');
                group.className = 'key-group';
                row.append(group);
            } else group.append(separator());
            group.append(this.button(key, label, glyph));
            group.style.setProperty('--keys', group.querySelectorAll('button').length);
        });
    }
    /** One container for all function keys, one line each; only vertical separators, the gaps mark the lines. */
    renderFunctions(count) {
        if (count === this.functionCount) return;
        this.functionCount = count;
        const row = this.querySelector('[data-row="functions"]');
        const group = document.createElement('div');
        group.className = 'key-group function-keys';
        for (const keys of functionLines(count)) {
            const line = document.createElement('div');
            line.className = 'key-line';
            keys.forEach(([key, label], index) => {
                if (index) line.append(separator());
                line.append(this.button(key, label, null));
            });
            group.append(line);
        }
        row.replaceChildren(group);
        this.dispatchEvent(new CustomEvent('keys-rendered', { bubbles: true }));
    }
    button(key, label, glyph) {
        const button = document.createElement('button');
        button.dataset.key = key;
        button.setAttribute('aria-label', label);
        if (glyph) button.append(icon(glyph));
        else button.textContent = label;
        if (key === 'Delete') button.classList.add('forward-delete');
        if (modifierKeys.has(key)) button.classList.add('modifier');
        if (modifierKeys.has(key) || key === 'VolumeMute') button.setAttribute('aria-pressed', 'false');
        button.addEventListener('pointerdown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
            if (modifierKeys.has(key)) {
                if (key === 'Win' && !this.sticky) {
                    // Windows acts on release (Start menu): outside sticky mode a tap presses it at once.
                    this.press(key, true);
                    this.press(key, false);
                } else this.press(key, !this.held.has(key));
                return;
            }
            if (key === 'PlayPause' && this.playing != null) this.media({ playing: !this.playing });
            if (key === 'VolumeMute' && this.muted != null) this.media({ muted: !this.muted });
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
        return button;
    }
    press(key, down) {
        if (down) this.held.add(key);
        else this.held.delete(key);
        this.dispatchEvent(
            new CustomEvent('command', { bubbles: true, detail: { action: 'key', data: { key, down } } })
        );
        this.updatePressed();
    }
    updatePressed() {
        for (const key of modifierKeys)
            this.querySelector(`[data-key="${key}"]`).setAttribute('aria-pressed', String(this.held.has(key)));
    }
    /** Mirrors the PC's playback and mute state; null leaves a value unknown. */
    media({ playing = this.playing, muted = this.muted }) {
        this.playing = playing;
        this.muted = muted;
        const play = this.querySelector('[data-key="PlayPause"]');
        const next = playing ? 'pause' : 'play';
        if (play.dataset.glyph !== next) {
            play.dataset.glyph = next;
            play.replaceChildren(icon(next));
            play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        }
        this.querySelector('[data-key="VolumeMute"]').setAttribute('aria-pressed', String(muted === true));
    }
    /**
     * Releases active modifiers. Outside sticky mode the app calls it after the next key or click (scrolling and
     * moving keep them); sticky modifiers only go on a manual tap, or when forced (blur, disconnect, settings).
     */
    reset({ force = false } = {}) {
        if (this.sticky && !force) return;
        for (const key of [...this.held]) this.press(key, false);
    }
    configure(settings, editing) {
        this.sticky = settings.sticky;
        this.renderFunctions(settings.functionKeys);
        for (const row of this.children)
            row.hidden = !settings[row.dataset.row] || (editing && row.dataset.row !== 'modifiers');
    }
}
customElements.define('key-rows', KeyRows);
