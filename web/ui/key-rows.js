import { icon } from './icons.js';
import { blockMenu, tick } from './haptics.js';
// Rows, in display order. enabled: shown by default (the option menu's "Show … row" switches it per phone). compact:
// lower keys, for dense rows of short labels. above: placed above the trackpad (the less used rows), so the trackpad
// and the rows used most sit lower, under the thumb; the others go below it. Each key: key (what is sent, or a name in controlShortcuts), label (the
// text, or the accessible name of an icon key), icon (a name from icons.js; none for a text key), group (adjacent keys
// of the same group share one bordered container), repeat (sent again and again while held, like a physical keyboard).
const functionKey = (index) => ({ key: `F${index + 1}`, label: `F${index + 1}`, group: 'functions' });
const rows = {
    functions: { enabled: false, compact: true, above: true, keys: [] },
    media: {
        enabled: true,
        compact: true,
        above: true,
        keys: [
            { key: 'PlayPause', label: 'Play / pause', icon: 'play' },
            { key: 'VolumeMute', label: 'Mute', icon: 'mute', group: 'media' },
            { key: 'VolumeDown', label: 'Volume down', icon: 'quieter', group: 'media', repeat: true },
            { key: 'VolumeUp', label: 'Volume up', icon: 'louder', group: 'media', repeat: true },
        ],
    },
    edit: {
        enabled: true,
        above: true,
        keys: [
            { key: 'Undo', label: 'Undo', icon: 'undo', group: 'history', repeat: true },
            { key: 'Redo', label: 'Redo', icon: 'redo', group: 'history', repeat: true },
            { key: 'Cut', label: 'Cut', icon: 'cut', group: 'clipboard' },
            { key: 'Copy', label: 'Copy', icon: 'copy', group: 'clipboard' },
            { key: 'Paste', label: 'Paste', icon: 'paste', group: 'clipboard' },
            { key: 'Backspace', label: 'Backspace', icon: 'delete', group: 'delete', repeat: true },
            { key: 'Delete', label: 'Delete', icon: 'delete', group: 'delete', repeat: true },
        ],
    },
    characters: {
        enabled: false,
        compact: true,
        keys: [
            ...['Z', 'S', 'F'].map((letter) => ({ key: letter, label: letter, group: 'video', repeat: true })),
            ...['T', 'W'].map((letter) => ({ key: letter, label: letter, group: 'window', repeat: true })),
        ],
    },
    arrows: {
        enabled: true,
        compact: true,
        keys: [
            { key: 'Home', label: 'Home', icon: 'home', group: 'line' },
            { key: 'End', label: 'End', icon: 'end', group: 'line' },
            { key: 'Up', label: 'Up', icon: 'up', group: 'arrows', repeat: true },
            { key: 'Down', label: 'Down', icon: 'down', group: 'arrows', repeat: true },
            { key: 'Left', label: 'Left', icon: 'left', group: 'arrows', repeat: true },
            { key: 'Right', label: 'Right', icon: 'right', group: 'arrows', repeat: true },
        ],
    },
    modifiers: {
        enabled: true,
        keys: [
            { key: 'Escape', label: 'ESC', group: 'escape' },
            { key: 'Tab', label: 'TAB', group: 'escape', repeat: true },
            { key: 'Win', label: 'Windows', icon: 'windows' },
            { key: 'Shift', label: 'Shift', icon: 'shift', group: 'modifiers' },
            { key: 'Control', label: 'CTRL', group: 'modifiers' },
            { key: 'Alt', label: 'ALT', group: 'modifiers' },
            { key: 'Enter', label: 'Enter', icon: 'enter' },
        ],
    },
};
/** Whether each row shows by default, for the option menu's "Show … row" switches (see remote.js). */
export const rowDefaults = Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row.enabled]));
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Win']);
// Editing commands: the key sent with Control, whatever modifiers are active.
const controlShortcuts = { Undo: 'Z', Redo: 'Y', Cut: 'X', Copy: 'C', Paste: 'V' };
// Auto-repeat timing: the first repeat after the delay (about a long press), then this many ms apart.
const repeatDelay = 700,
    repeatInterval = 30;
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
    /** Every row, in display order, wherever it sits. */
    rowElements = [];
    /**
     * The rows marked above go into the element whose id the `above` attribute names (placed before the trackpad);
     * the others into this element. One component keeps the keys' shared state (held modifiers, media state).
     */
    connectedCallback() {
        if (this.rowElements.length) return;
        const above = document.getElementById(this.getAttribute('above')) ?? this;
        for (const [name, { compact, above: placedAbove, keys }] of Object.entries(rows)) {
            const row = document.createElement('div');
            row.className = `key-row ${name}`;
            row.classList.toggle('compact-keys', compact === true);
            row.dataset.row = name;
            (placedAbove ? above : this).append(row);
            this.rowElements.push(row);
            if (name !== 'functions') this.fillRow(row, keys);
        }
    }
    /** The button of a key, in whichever row it sits. */
    keyButton(key) {
        for (const row of this.rowElements) {
            const button = row.querySelector(`[data-key="${key}"]`);
            if (button) return button;
        }
        return null;
    }
    /** Consecutive keys of the same group go in one bordered container; a key without a group gets its own. */
    fillRow(row, keys) {
        let group = null;
        keys.forEach((entry, index) => {
            if (!group || !entry.group || keys[index - 1].group !== entry.group) {
                group = document.createElement('div');
                group.className = 'key-group';
                row.append(group);
            } else group.append(separator());
            group.append(this.button(entry));
            group.style.setProperty('--keys', group.querySelectorAll('button').length);
        });
    }
    /** One container for all function keys, one line each; only vertical separators, the gaps mark the lines. */
    renderFunctions(count) {
        if (count === this.functionCount) return;
        this.functionCount = count;
        const row = this.rowElements.find((element) => element.dataset.row === 'functions');
        const group = document.createElement('div');
        group.className = 'key-group function-keys';
        for (const keys of functionLines(count)) {
            const line = document.createElement('div');
            line.className = 'key-line';
            keys.forEach((entry, index) => {
                if (index) line.append(separator());
                line.append(this.button(entry));
            });
            group.append(line);
        }
        row.replaceChildren(group);
        // The row is as tall as its lines (style.css).
        row.style.setProperty('--lines', group.children.length);
        this.countShown();
        row.dispatchEvent(new CustomEvent('keys-rendered', { bubbles: true }));
    }
    button({ key, label, icon: glyph, repeat = false }) {
        const button = document.createElement('button');
        button.dataset.key = key;
        button.setAttribute('aria-label', label);
        // Fill button: the inner .fill takes the pressed / on color, inset from the group's border.
        button.className = 'fill-button';
        const fill = document.createElement('span');
        fill.className = 'fill';
        if (glyph) fill.append(icon(glyph));
        else fill.textContent = label;
        button.append(fill);
        if (key === 'Delete') button.classList.add('forward-delete');
        if (modifierKeys.has(key)) button.classList.add('modifier');
        if (modifierKeys.has(key) || key === 'VolumeMute') button.setAttribute('aria-pressed', 'false');
        button.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            // Like a phone keyboard: the tick comes on touch down.
            tick();
        });
        if (repeat) this.repeatOnHold(button, key);
        button.addEventListener('click', (event) => {
            if (modifierKeys.has(key)) {
                if (key === 'Win' && !this.sticky) {
                    // Windows acts on release (Start menu): outside sticky mode a tap presses it at once.
                    this.press(key, true);
                    this.press(key, false);
                } else this.press(key, !this.held.has(key));
                return;
            }
            // A repeating key already went on touch down; only keyboard activation (no pointer: detail 0) remains.
            if (repeat && event.detail > 0) return;
            if (key === 'PlayPause' && this.playing != null) this.media({ playing: !this.playing });
            if (key === 'VolumeMute' && this.muted != null) this.media({ muted: !this.muted });
            this.send(key);
            if (!this.sticky) this.reset();
        });
        return button;
    }
    /** Sends the key with the active modifiers; editing commands (Undo, Cut…) send their key with Control. */
    send(key) {
        const modifiers = [...this.held];
        if (controlShortcuts[key] && !modifiers.includes('Control')) modifiers.push('Control');
        this.dispatchEvent(
            new CustomEvent('command', {
                bubbles: true,
                detail: { action: 'shortcut', data: { key: controlShortcuts[key] ?? key, modifiers } },
            })
        );
    }
    /**
     * Auto-repeat: sent on touch down, then after repeatDelay every repeatInterval until the finger lifts (or the
     * browser takes the touch to scroll). Modifiers apply to every repeat and are released at the end, once.
     */
    repeatOnHold(button, key) {
        let pointer = null,
            timer;
        const stop = (event) => {
            if (event.pointerId !== pointer) return;
            pointer = null;
            clearTimeout(timer);
            if (!this.sticky) this.reset();
        };
        const again = () => {
            this.send(key);
            timer = setTimeout(again, repeatInterval);
        };
        button.addEventListener('pointerdown', (event) => {
            if (pointer !== null || event.button !== 0) return;
            pointer = event.pointerId;
            button.setPointerCapture(event.pointerId);
            this.send(key);
            timer = setTimeout(again, repeatDelay);
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, stop);
        // Nothing opens while the key repeats: no right-click menu, and a long touch shows nothing (user-select: none).
        blockMenu(button);
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
        for (const key of modifierKeys) this.keyButton(key).setAttribute('aria-pressed', String(this.held.has(key)));
    }
    /** Mirrors the PC's playback and mute state; null leaves a value unknown. */
    media({ playing = this.playing, muted = this.muted }) {
        this.playing = playing;
        this.muted = muted;
        const play = this.keyButton('PlayPause');
        const next = playing ? 'pause' : 'play';
        if (play.dataset.glyph !== next) {
            play.dataset.glyph = next;
            play.querySelector('.fill').replaceChildren(icon(next));
            play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        }
        this.keyButton('VolumeMute').setAttribute('aria-pressed', String(muted === true));
    }
    /**
     * Releases active modifiers. Outside sticky mode the app calls it after the next key or click (scrolling and
     * moving keep them); sticky modifiers only go on a manual tap, or when forced (blur, disconnect, options).
     */
    reset({ force = false } = {}) {
        if (this.sticky && !force) return;
        for (const key of [...this.held]) this.press(key, false);
    }
    /** Presses the modifiers shown held again on the PC (it lets go of every key when the connection drops). */
    restore() {
        for (const key of this.held)
            this.dispatchEvent(
                new CustomEvent('command', { bubbles: true, detail: { action: 'key', data: { key, down: true } } })
            );
    }
    configure(options) {
        this.sticky = options.sticky;
        this.renderFunctions(options.functionKeys);
        for (const row of this.rowElements) row.hidden = !options[row.dataset.row];
        this.countShown();
    }
    /** The lines and rows each container shows, for its minimum height (style.css: .key-rows). */
    countShown() {
        for (const container of new Set(this.rowElements.map((row) => row.parentElement))) {
            const shown = [...container.children].filter((row) => !row.hidden);
            const lines = shown.reduce((sum, row) => sum + Number(row.style.getPropertyValue('--lines') || 1), 0);
            container.style.setProperty('--shown-lines', lines);
            container.style.setProperty('--shown-rows', shown.length);
        }
    }
}
customElements.define('key-rows', KeyRows);
