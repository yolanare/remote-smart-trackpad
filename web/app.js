import './style.css';
import './ui/pointer-pad.js';
import './ui/key-rows.js';
import './ui/text-editor.js';
import { addIcons } from './ui/icons.js';
import { createConnection } from './logic/connection.js';
import { createMirror } from './logic/mirror.js';
import { createMotion } from './logic/motion.js';

const $ = (selector) => document.querySelector(selector);
const settings = {
    functions: false,
    media: false,
    edit: true,
    modifiers: true,
    sticky: false,
    mouseSliding: false,
    mouseSpeed: 1,
    scrollSpeed: 1,
};
try {
    Object.assign(settings, JSON.parse(localStorage.getItem('remote-smart-trackpad-layout') || '{}'));
} catch {}
for (const name of ['mouseSpeed', 'scrollSpeed']) {
    const input = document.querySelector(`[name="${name}"]`);
    if (!Number.isFinite(settings[name]) || settings[name] < Number(input.min) || settings[name] > Number(input.max))
        settings[name] = 1;
}
function saveSettings() {
    try {
        localStorage.setItem('remote-smart-trackpad-layout', JSON.stringify(settings));
    } catch {}
}
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
    $('pointer-pad').sliding = settings.mouseSliding === true;
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
        $('pointer-pad').cancelGesture();
        mirror.disconnected();
        motion.reset();
        rows.reset();
    } else mirror.poll();
});
const send = (action, data) => connection.send(action, data);
const motion = createMotion(send, (message) => status(message));
document.addEventListener('motion-stop', () => motion.reset());
document.addEventListener('pointerdown', () => $('pointer-pad').stopSliding(), { capture: true });
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
document.addEventListener('motion', (event) => {
    const { action, dx, dy } = event.detail;
    const speed = action === 'move' ? settings.mouseSpeed : settings.scrollSpeed;
    motion.add(action, dx * speed, dy * speed);
});
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
let menuAnimation;
function setMenu(open) {
    if (open) $('pointer-pad').cancelGesture();
    const current =
        !menu.hidden ? { opacity: getComputedStyle(menu).opacity, transform: getComputedStyle(menu).transform } : null;
    menuAnimation?.cancel();
    if (!open && menu.contains(document.activeElement)) $('#options-toggle').focus({ preventScroll: true });
    $('#options-toggle').setAttribute('aria-expanded', String(open));
    $('#options-dismiss').hidden = !open;
    $('#controls').inert = open;
    $('#pairing').inert = open;
    menu.inert = !open;
    if (open) menu.hidden = false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        menu.hidden = !open;
        return;
    }
    const frames = [
        { opacity: 0, transform: 'translateY(-0.25rem)' },
        { opacity: 1, transform: 'translateY(0)' },
    ];
    menuAnimation = menu.animate([current ?? frames[0], frames[open ? 1 : 0]], {
        duration: open ? 160 : 100,
        easing: 'ease-out',
    });
    menuAnimation.onfinish = () => {
        menu.hidden = !open;
    };
}
$('#options-toggle').addEventListener('click', () => {
    setMenu($('#options-toggle').getAttribute('aria-expanded') !== 'true');
});
$('#options-dismiss').addEventListener('click', () => setMenu(false));
for (const input of menu.querySelectorAll('input[type="range"]')) {
    const update = () => {
        const value = input.valueAsNumber;
        settings[input.name] = value;
        input.style.setProperty(
            '--fill',
            `${((value - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`
        );
        $(`#${input.id}-value`).value = `${Number(value.toFixed(2))}×`;
        input.setAttribute('aria-valuetext', `${Number(value.toFixed(2))} times`);
    };
    input.value = settings[input.name];
    update();
    input.addEventListener('input', () => {
        update();
        saveSettings();
    });
}
for (const input of menu.querySelectorAll('input[type="checkbox"]')) {
    input.checked = Boolean(settings[input.name]);
    input.addEventListener('change', () => {
        settings[input.name] = input.checked;
        saveSettings();
        rows.reset();
        layout();
    });
}
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#options-toggle').getAttribute('aria-expanded') === 'true') setMenu(false);
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
    $('pointer-pad').cancelGesture();
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
