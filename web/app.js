import './style.css';
import './ui/pointer-pad.js';
import './ui/key-rows.js';
import './ui/text-editor.js';
import { addIcons } from './ui/icons.js';
import { createConnection } from './logic/connection.js';
import { createMirror } from './logic/mirror.js';
import { createMotion } from './logic/motion.js';

const $ = (selector) => document.querySelector(selector);
const settings = { functions: false, media: false, edit: true, modifiers: true, sticky: false };
try {
    Object.assign(settings, JSON.parse(localStorage.getItem('remote-smart-trackpad-layout') || '{}'));
} catch {}
let editing = false,
    namingOnly = false,
    connected = false;
addIcons(document);
const rows = $('key-rows');
const editor = $('text-editor');
function status(message, state = 'warning') {
    $('#connection').dataset.state = state;
    $('#connection').title = message;
    $('#connection-label').textContent = state === 'ready' ? '' : message;
    $('#connection').setAttribute('aria-label', message || 'Connected');
}
function layout() {
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const transitioning =
        $('.app').classList.contains('editing') !== editing && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const elements =
        transitioning ? [...document.querySelectorAll('.trackpad, .mouse-left, .mouse-right, .input-dock')] : [];
    const before = elements.map((element) => element.getBoundingClientRect());
    $('.app').classList.toggle('editing', editing);
    $('#editor-open').hidden = editing;
    $('#editor-close').hidden = !editing;
    $('#options-toggle').hidden = editing;
    editor.hidden = !editing;
    rows.configure(settings, editing);
    elements.forEach((element, index) => {
        const after = element.getBoundingClientRect(),
            prior = before[index];
        if (after.height && prior.height)
            element.animate(
                [
                    {
                        transform: `translateY(${(prior.top - after.top) / unit}rem) scaleY(${prior.height / after.height})`,
                        transformOrigin: 'top',
                    },
                    { transform: 'none', transformOrigin: 'top' },
                ],
                { duration: 180, easing: 'ease-out' }
            );
    });
}
const connection = createConnection(({ state }) => {
    connected = state === 'ready';
    const pairing = state === 'pairing' || state === 'name';
    namingOnly = state === 'name';
    $('#pairing').hidden = !pairing;
    $('#controls').hidden = pairing;
    $('#pair-code-label').hidden = namingOnly;
    $('#pair-code').required = !namingOnly;
    status(
        {
            pairing: 'Pair this device',
            name: 'Your name',
            connecting: 'Connecting…',
            disconnected: 'Disconnected',
            'another-device': 'Another device is active',
            unavailable: 'PC unavailable',
            ready: 'Connected',
        }[state],
        state
    );
    if (!connected) {
        mirror.disconnected();
        motion.reset();
        rows.reset();
    } else mirror.poll();
});
const send = (action, data) => connection.send(action, data);
const motion = createMotion(send, (message) => status(message));
const mirror = createMirror(send, (state) => {
    editing = state.open;
    layout();
    editor.render(state);
    if (editing && state.error) status(state.error);
    else if (editing && !state.available) status(state.reason || 'Select an editable PC text field');
    else if (connected) status('Connected', 'ready');
});
document.addEventListener('command', async (event) => {
    try {
        await send(event.detail.action, event.detail.data);
        if (
            !rows.sticky
            && (event.detail.action === 'click' || (event.detail.action === 'button' && !event.detail.data.down))
        )
            rows.reset();
        mirror.poll();
    } catch (error) {
        status(error.message);
    }
});
document.addEventListener('motion', (event) => motion.add(event.detail.action, event.detail.dx, event.detail.dy));
document.addEventListener('text-input', (event) =>
    mirror.input(event.detail.text, event.detail.start, event.detail.end)
);
document.addEventListener('text-composition', (event) => mirror.compose(event.detail));
editor.firstElementChild.addEventListener('beforeinput', (event) => {
    if (event.isComposing || ![...rows.held].some((key) => ['Control', 'Alt', 'Win'].includes(key))) return;
    const key =
        {
            deleteContentBackward: 'Backspace',
            deleteContentForward: 'Delete',
            insertLineBreak: 'Enter',
            insertParagraph: 'Enter',
        }[event.inputType]
        || (event.data === ' ' ? 'Space'
        : /^[a-z]$/i.test(event.data || '') ? event.data.toUpperCase()
        : null);
    if (!key) return;
    event.preventDefault();
    send('shortcut', { key, modifiers: [...rows.held] })
        .then(() => mirror.poll())
        .catch((error) => status(error.message));
    if (!rows.sticky) rows.reset();
});
$('#editor-open').addEventListener('click', () => {
    mirror.open();
    editor.focus();
});
$('#editor-close').addEventListener('click', () => {
    editor.firstElementChild.blur();
    mirror.close();
    rows.reset();
});
$('#pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#pair-error').textContent = '';
    try {
        await connection.pair($('#pair-name').value, namingOnly ? undefined : $('#pair-code').value);
    } catch (error) {
        $('#pair-error').textContent = error.message;
    }
});
const menu = $('#options');
function closeMenu() {
    menu.hidden = true;
    $('#options-toggle').setAttribute('aria-expanded', 'false');
}
$('#options-toggle').addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    $('#options-toggle').setAttribute('aria-expanded', String(!menu.hidden));
});
for (const input of menu.querySelectorAll('input')) {
    input.checked = Boolean(settings[input.name]);
    input.addEventListener('change', () => {
        settings[input.name] = input.checked;
        localStorage.setItem('remote-smart-trackpad-layout', JSON.stringify(settings));
        rows.reset();
        layout();
    });
}
document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target) && !$('#options-toggle').contains(event.target)) closeMenu();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
});
function viewport() {
    const visible = window.visualViewport;
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
    document.documentElement.style.setProperty('--viewport-height', `${(visible?.height ?? innerHeight) / unit}rem`);
    document.documentElement.style.setProperty('--viewport-top', `${(visible?.offsetTop ?? 0) / unit}rem`);
}
window.visualViewport?.addEventListener('resize', viewport);
window.visualViewport?.addEventListener('scroll', viewport);
window.addEventListener('resize', viewport);
const release = () => {
    motion.reset();
    rows.reset();
    send('release').catch(() => {});
};
window.addEventListener('blur', release);
window.addEventListener('pagehide', release);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
    else mirror.poll();
});
setInterval(() => {
    if (!document.hidden && connected) mirror.poll();
}, 200);
layout();
viewport();
connection.connect();
