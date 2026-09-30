import './style.css';
import './ui/pointer-pad.js';
import './ui/key-rows.js';
import './ui/text-editor.js';
import { addIcons } from './ui/icons.js';
import { attachHaptics, tick } from './ui/haptics.js';
import { createConnection } from './logic/connection.js';
import { createMirror } from './logic/mirror.js';
import { createMotion, pointerGain } from './logic/motion.js';

const $ = (selector) => document.querySelector(selector);
const storageKey = 'remote-smart-trackpad-layout';
addIcons(document);
attachHaptics(document);
// Function keys are re-rendered when their count changes; their new buttons get haptics too.
document.addEventListener('keys-rendered', (event) => attachHaptics(event.target));
const app = $('.app'),
    dock = $('.input-dock'),
    pad = $('pointer-pad'),
    rows = $('key-rows'),
    editor = $('text-editor'),
    menu = $('#options'),
    backdrop = $('#options-dismiss'),
    toggle = $('#options-toggle');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rem = (pixels) => `${pixels / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`;

// The option inputs' HTML attributes are the defaults; values stored on this phone override them.
const fields = [...menu.querySelectorAll('input[name]')];
// A radio group (segmented control) is one text setting: its default is the radio checked in the markup.
const radios = (name) => [...menu.querySelectorAll(`input[type="radio"][name="${name}"]`)];
const defaultOf = (input) =>
    input.type === 'checkbox' ? input.defaultChecked
    : input.type === 'radio' ? radios(input.name).find((radio) => radio.defaultChecked).value
    : Number(input.defaultValue);
const isValid = (input, value) =>
    input.type === 'checkbox' ? typeof value === 'boolean'
    : input.type === 'radio' ? radios(input.name).some((radio) => radio.value === value)
    : Number.isFinite(value) && value >= Number(input.min) && value <= Number(input.max);
// Captured once: writing a hidden input's value also rewrites its default.
const defaults = Object.fromEntries(fields.map((input) => [input.name, defaultOf(input)]));
const settings = { ...defaults };
try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
    for (const input of fields) if (isValid(input, stored[input.name])) settings[input.name] = stored[input.name];
} catch {}
function saveSettings() {
    try {
        localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {}
}

const labels = {
    pairing: 'Pair this device',
    name: 'Your name',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    unavailable: 'PC unavailable · reconnecting…',
    ready: 'Connected',
};
let connectionState = 'connecting',
    connected = false,
    namingOnly = false,
    mirrorState = { open: false },
    notice = '',
    noticeTimer;
function refreshStatus() {
    let message = labels[connectionState],
        state = connectionState;
    if (state === 'ready') {
        state = 'warning';
        if (notice) message = notice;
        else if (mirrorState.open && mirrorState.error) message = mirrorState.error;
        else if (mirrorState.open && !mirrorState.available)
            message = mirrorState.reason || 'No text field · typing to PC';
        else state = 'ready';
    }
    $('#connection').dataset.state = state;
    $('#connection').title = message;
    $('#connection').setAttribute('aria-label', message);
    $('#connection-label').textContent = state === 'ready' ? '' : message;
}
/** Shows a command error for a few seconds, then returns to the connection state. */
function showNotice(message) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
        notice = '';
        refreshStatus();
    }, 4000);
    refreshStatus();
}

// Layout: `editing` is the requested state; `shownEditing` is what the layout currently displays.
let editing = false,
    shownEditing = false,
    switching = false,
    morphs = 0;
function applyLayout() {
    pad.sliding = settings.mouseSliding === true;
    pad.edgeMotion = settings.edgeMotion === true;
    pad.scrollSliding = settings.scrollSliding !== false;
    app.classList.toggle('editing', shownEditing);
    $('#editor-open').hidden = shownEditing;
    $('#editor-close').hidden = !shownEditing;
    toggle.hidden = shownEditing;
    editor.hidden = !shownEditing && !dock.classList.contains('editor-pending');
    rows.configure(settings, shownEditing);
}
/** Freezes the app and dock at their current size so the layout can change underneath. */
function pinGeometry() {
    morphs++;
    const start = { top: app.offsetTop, height: app.offsetHeight, dock: dock.offsetHeight };
    for (const animation of [...app.getAnimations(), ...dock.getAnimations()]) animation.cancel();
    app.style.top = rem(start.top);
    app.style.height = rem(start.height);
    dock.style.height = rem(start.dock);
    dock.classList.add('is-morphing');
    return start;
}
/** Animates the real layout from the pinned geometry to its new natural size; the trackpad follows as flex space. */
function morphFrom(start) {
    const token = morphs;
    app.style.top = app.style.height = dock.style.height = '';
    const end = { top: app.offsetTop, height: app.offsetHeight, dock: dock.offsetHeight };
    // Matches --layout-transition, which drives the pointer pad's own row changes.
    const timing = { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
    const animations = [];
    if (start.top !== end.top || start.height !== end.height)
        animations.push(
            app.animate(
                [
                    { top: rem(start.top), height: rem(start.height) },
                    { top: rem(end.top), height: rem(end.height) },
                ],
                timing
            )
        );
    if (start.dock && end.dock && start.dock !== end.dock)
        animations.push(dock.animate([{ height: rem(start.dock) }, { height: rem(end.dock) }], timing));
    Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
        if (token === morphs) dock.classList.remove('is-morphing');
    });
}
/** Runs a layout change and fades in the controls it reveals. */
function reveal(change) {
    const targets = [$('#editor-open'), $('#editor-close'), toggle, editor, ...rows.children];
    const wasHidden = targets.map(
        (element) => element.hidden || (element === editor && dock.classList.contains('editor-pending'))
    );
    change();
    if (reducedMotion()) return;
    targets.forEach((element, index) => {
        if (wasHidden[index] && !element.hidden)
            element.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration: 220,
                delay: 60,
                easing: 'ease-out',
                fill: 'backwards',
            });
    });
}
/** Resolves once the phone keyboard has finished resizing the viewport, or shortly after if it never does. */
function viewportSettled() {
    return new Promise((resolve) => {
        let quiet = setTimeout(done, 220);
        const limit = setTimeout(done, 700);
        const changed = () => {
            clearTimeout(quiet);
            quiet = setTimeout(done, 80);
        };
        function done() {
            clearTimeout(quiet);
            clearTimeout(limit);
            window.removeEventListener('resize', changed);
            window.visualViewport?.removeEventListener('resize', changed);
            resolve();
        }
        window.addEventListener('resize', changed);
        window.visualViewport?.addEventListener('resize', changed);
    });
}
async function switchEditing() {
    switching = true;
    const opening = editing,
        animated = !reducedMotion();
    const start = animated && pinGeometry();
    // Focus must happen now, inside the tap, for the keyboard to open; the field stays invisible until the layout moves.
    if (opening) {
        dock.classList.add('editor-pending');
        editor.hidden = false;
        editor.focus();
    } else editor.blur();
    // Wait for the keyboard to appear or leave first; moving while it resizes the viewport looks incoherent.
    if (animated) await viewportSettled();
    shownEditing = opening;
    reveal(() => {
        dock.classList.remove('editor-pending');
        applyLayout();
    });
    if (animated) morphFrom(start);
    switching = false;
    layout();
}
function layout({ animate = false } = {}) {
    if (switching) return;
    if (shownEditing !== editing) return void switchEditing();
    if (!animate || reducedMotion()) return applyLayout();
    const start = pinGeometry();
    reveal(applyLayout);
    morphFrom(start);
}

// Polling runs only while it can show something: a connected, visible page with the editor open or media keys shown.
let mirrorTimer = 0,
    mediaTimer = 0;
function schedulePolling() {
    const active = connected && !document.hidden;
    const wantMirror = active && mirrorState.open;
    if (wantMirror && !mirrorTimer) mirrorTimer = setInterval(() => mirror.poll(), 200);
    if (!wantMirror && mirrorTimer) {
        clearInterval(mirrorTimer);
        mirrorTimer = 0;
    }
    const wantMedia = active && settings.media && !mirrorState.open;
    if (wantMedia && !mediaTimer) mediaTimer = setInterval(refreshMedia, 3000);
    if (!wantMedia && mediaTimer) {
        clearInterval(mediaTimer);
        mediaTimer = 0;
    }
}
async function refreshMedia() {
    if (!connected || !settings.media) return;
    try {
        rows.media(await send('media-state'));
    } catch {}
}

const connection = createConnection(({ state }) => {
    connected = state === 'ready';
    connectionState = state;
    const pairing = state === 'pairing' || state === 'name';
    namingOnly = state === 'name';
    $('#pairing').hidden = !pairing;
    $('#controls').hidden = pairing;
    $('#pair-code-label').hidden = namingOnly;
    $('#pair-code').required = !namingOnly;
    if (!connected) {
        pad.cancelGesture();
        mirror.disconnected();
        motion.reset();
        rows.reset({ force: true });
    } else {
        mirror.poll();
        refreshMedia();
    }
    refreshStatus();
    schedulePolling();
});
const send = (action, data) => connection.send(action, data);
const motion = createMotion(send, showNotice);
const mirror = createMirror(send, (state) => {
    mirrorState = state;
    editing = state.open;
    layout();
    editor.render({ ...state, passthrough: connected && state.open && !state.available });
    refreshStatus();
    schedulePolling();
});

// No zoom, whatever the browser allows (Firefox's "zoom on all websites" ignores user-scalable=no): the remote
// never uses two-finger gestures, so a second finger never reaches the browser's pinch handling.
// For 4 s after loading, zoom stays allowed so a page stuck zoomed can be pinched back out. Then a strict viewport
// (scale fixed at 1) is applied, which also makes the browser zoom back out natively; a later zoom is reset the same way.
const viewportMeta = $('meta[name="viewport"]');
const viewportBase = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
const viewportLocked = `${viewportBase}, minimum-scale=1, maximum-scale=1, user-scalable=no`;
let zoomGrace = true;
viewportMeta.content = viewportBase;
document.documentElement.classList.add('zoom-grace');
function resetZoom() {
    // Rewriting the tag with a different value, then the strict one, makes browsers re-apply it and clamp the scale.
    viewportMeta.content = `${viewportBase}, maximum-scale=1.01`;
    requestAnimationFrame(() => (viewportMeta.content = viewportLocked));
}
setTimeout(() => {
    zoomGrace = false;
    document.documentElement.classList.remove('zoom-grace');
    resetZoom();
}, 4000);
window.visualViewport?.addEventListener('resize', () => {
    if (!zoomGrace && Math.abs(visualViewport.scale - 1) > 0.01) resetZoom();
});
document.addEventListener(
    'touchmove',
    (event) => {
        if (!zoomGrace && event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
);
for (const type of ['gesturestart', 'gesturechange'])
    document.addEventListener(type, (event) => zoomGrace || event.preventDefault());
document.addEventListener('motion-stop', () => motion.reset());
document.addEventListener('motion-release', (event) => motion.clear(event.detail.action));
document.addEventListener('pointerdown', () => pad.stopSliding(), { capture: true });
// Press feedback for everything tappable: buttons, option rows and segments (labels), links, disclosures. The
// pressed class is reliable on touch (:active can stick or never show) and held for a short beat, so quick taps still
// visibly press. A slider's own label only names it, so it has no press state.
// Inside something that scrolls (the options menu), a touch may be the start of a scroll: like native lists, the
// press (and its vibration) waits a beat and is dropped if the finger moves or the browser takes over to scroll.
const pressable = 'button, label:not(.speed-setting label), a[href], summary';
const pressDelay = 100,
    pressSlop = 8;
const pressed = new Map();
const inScroller = (element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(node);
        if (/auto|scroll/.test(overflowY) && node.scrollHeight > node.clientHeight) return true;
        if (/auto|scroll/.test(overflowX) && node.scrollWidth > node.clientWidth) return true;
    }
    return false;
};
const showPress = (entry) => {
    if (entry.shown) return;
    entry.shown = true;
    entry.at = performance.now();
    entry.element.classList.add('is-pressed');
    tick();
};
document.addEventListener(
    'pointerdown',
    (event) => {
        const element = event.target.closest?.(pressable);
        if (!element || element.disabled) return;
        const entry = { element, x: event.clientX, y: event.clientY, shown: false };
        pressed.set(event.pointerId, entry);
        if (event.pointerType !== 'mouse' && inScroller(element))
            entry.timer = setTimeout(() => showPress(entry), pressDelay);
        else showPress(entry);
    },
    { capture: true }
);
document.addEventListener(
    'pointermove',
    (event) => {
        const entry = pressed.get(event.pointerId);
        if (!entry || entry.shown) return;
        if (Math.hypot(event.clientX - entry.x, event.clientY - entry.y) < pressSlop) return;
        clearTimeout(entry.timer);
        pressed.delete(event.pointerId);
    },
    { capture: true, passive: true }
);
const unpress = (event) => {
    const entry = pressed.get(event.pointerId);
    if (!entry) return;
    pressed.delete(event.pointerId);
    clearTimeout(entry.timer);
    // A quick tap lifts before the delay: it still presses. A scroll (pointercancel) never does.
    if (event.type === 'pointerup') showPress(entry);
    if (!entry.shown) return;
    setTimeout(() => entry.element.classList.remove('is-pressed'), Math.max(0, 90 - (performance.now() - entry.at)));
    // A tapped control gives focus back once its click ran, so it never lingers looking active.
    if (event.pointerType !== 'mouse')
        setTimeout(() => entry.element.contains(document.activeElement) && document.activeElement.blur());
};
// Input modality for CSS: focus rings only after keyboard use (see :root[data-modality] in style.css).
document.addEventListener(
    'pointerdown',
    (event) => (document.documentElement.dataset.modality = event.pointerType === 'mouse' ? 'mouse' : 'touch'),
    { capture: true }
);
document.addEventListener('keydown', () => (document.documentElement.dataset.modality = 'keyboard'), {
    capture: true,
});
document.addEventListener('pointerup', unpress, { capture: true });
document.addEventListener('pointercancel', unpress, { capture: true });

const mediaKeys = new Set(['PlayPause', 'VolumeMute']);
document.addEventListener('command', async (event) => {
    const { action, data } = event.detail;
    try {
        await send(action, data);
        if (!rows.sticky && (action === 'click' || (action === 'button' && !data.down))) rows.reset();
        // Playback state changes asynchronously in the media app; confirm the optimistic toggle shortly after.
        if (action === 'shortcut' && mediaKeys.has(data.key)) setTimeout(refreshMedia, 400);
        mirror.poll();
    } catch (error) {
        showNotice(error.message);
    }
});
document.addEventListener('motion', (event) => {
    const { action, dx, dy, speed = 0 } = event.detail;
    const mouse = action === 'move';
    const gain =
        mouse ?
            settings.mouseSpeed * pointerGain(speed, settings.mouseAcceleration)
        :   settings.scrollSpeed * pointerGain(speed, settings.scrollAcceleration);
    const signX = settings[mouse ? 'invertMouseX' : 'invertScrollX'] ? -1 : 1;
    const signY = settings[mouse ? 'invertMouseY' : 'invertScrollY'] ? -1 : 1;
    motion.add(action, dx * gain * signX, dy * gain * signY);
});
// Edge motion sends a velocity; the PC glides the pointer smoothly with the same speed, acceleration and inversion.
document.addEventListener('edge-glide', (event) => {
    const { vx, vy, speed } = event.detail;
    const gain = settings.mouseSpeed * pointerGain(speed, settings.mouseAcceleration);
    send('glide', {
        vx: vx * gain * (settings.invertMouseX ? -1 : 1),
        vy: vy * gain * (settings.invertMouseY ? -1 : 1),
    }).catch(() => {});
});
document.addEventListener('text-input', (event) =>
    mirror.input(event.detail.text, event.detail.start, event.detail.end)
);
document.addEventListener('text-composition', (event) => mirror.compose(event.detail));
document.addEventListener('text-key', (event) => {
    send('shortcut', { key: event.detail.key, modifiers: [...rows.held] })
        .then(() => mirror.poll())
        .catch((error) => showNotice(error.message));
    if (!rows.sticky) rows.reset();
});
document.addEventListener('text-passthrough', (event) =>
    send('text', event.detail).catch((error) => showNotice(error.message))
);
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
        .catch((error) => showNotice(error.message));
    if (!rows.sticky) rows.reset();
});
$('#editor-open').addEventListener('click', () => {
    mirror.open();
    editor.focus();
});
$('#editor-close').addEventListener('click', () => {
    editor.blur();
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

let menuAnimations = [];
function setMenu(open) {
    if (open) pad.cancelGesture();
    const current =
        !menu.hidden ? { opacity: getComputedStyle(menu).opacity, transform: getComputedStyle(menu).transform } : null;
    const shade = backdrop.hidden ? 0 : getComputedStyle(backdrop).opacity;
    menuAnimations.forEach((animation) => animation.cancel());
    if (!open && menu.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    toggle.setAttribute('aria-expanded', String(open));
    $('#controls').inert = open;
    $('#pairing').inert = open;
    menu.inert = !open;
    if (open) menu.hidden = backdrop.hidden = false;
    if (reducedMotion()) {
        menu.hidden = backdrop.hidden = !open;
        return;
    }
    const frames = [
        { opacity: 0, transform: 'translateY(-0.25rem)' },
        { opacity: 1, transform: 'translateY(0)' },
    ];
    const timing = { duration: open ? 160 : 100, easing: 'ease-out' };
    menuAnimations = [
        menu.animate([current ?? frames[0], frames[open ? 1 : 0]], timing),
        backdrop.animate([{ opacity: shade }, { opacity: open ? 1 : 0 }], timing),
    ];
    menuAnimations[0].onfinish = () => {
        menu.hidden = backdrop.hidden = !open;
    };
}
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
backdrop.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (event) => {
    // Escape inside the reset confirmation only closes the dialog.
    // Escape is the way out, e.g. when the remote is opened on the PC it controls: release every press at once
    // (held and latched mouse buttons, hold mode, modifiers, drag, glide) here and on the PC.
    if (event.key === 'Escape') {
        pad.setHolding(false);
        release();
    }
    if (event.key === 'Escape' && !$('#reset-confirm').open && toggle.getAttribute('aria-expanded') === 'true')
        setMenu(false);
});

const times = (value) => `${Number(value.toFixed(2))}×`;
function showSetting(input) {
    const value = settings[input.name];
    if (input.type === 'checkbox') return void (input.checked = value);
    if (input.type === 'radio') return void (input.checked = input.value === value);
    input.value = value;
    const off = input.name.endsWith('Acceleration') && value === 0;
    // Sliders name their output with for=; a stepper's output sits in its own pill.
    const output =
        menu.querySelector(`output[for="${input.id}"]`)
        ?? menu.querySelector(`.stepper[data-setting="${input.name}"] output`);
    // data-unit="" shows a plain number (a count); otherwise a multiplier.
    if (output)
        output.value =
            off ? 'Off'
            : input.dataset.unit === '' ? String(value)
            : times(value);
    if (input.type !== 'range') return;
    const fill = (value - Number(input.min)) / (Number(input.max) - Number(input.min));
    input.style.setProperty('--fill', `${fill * 100}%`);
    input.setAttribute('aria-valuetext', off ? 'Off' : `${Number(value.toFixed(2))} times`);
}
// Steppers step through the values listed in data-steps for the setting named in data-setting.
const steppers = [...menu.querySelectorAll('.stepper')].map((stepper) => ({
    stepper,
    name: stepper.dataset.setting,
    steps: stepper.dataset.steps.split(' ').map(Number),
}));
function updateSteppers() {
    for (const { stepper, name, steps } of steppers) {
        stepper.querySelector('[data-step="-1"]').disabled = settings[name] <= steps[0];
        stepper.querySelector('[data-step="1"]').disabled = settings[name] >= steps.at(-1);
    }
}
// Color scheme: Auto follows the device; Dark and Light force it (tokens.css reads data-theme).
const themeColor = $('meta[name="theme-color"]');
function applyTheme() {
    if (settings.colorScheme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.colorScheme;
    themeColor.content = getComputedStyle(document.body).backgroundColor;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
function applyScale() {
    document.documentElement.style.fontSize = `${settings.uiScale * 100}%`;
    updateSteppers();
    viewport();
}
for (const input of fields) {
    showSetting(input);
    if (input.type === 'range')
        input.addEventListener('input', () => {
            settings[input.name] = input.valueAsNumber;
            showSetting(input);
            saveSettings();
        });
    if (input.type === 'radio')
        input.addEventListener('change', () => {
            settings[input.name] = input.value;
            saveSettings();
            applyTheme();
        });
    if (input.type === 'checkbox')
        input.addEventListener('change', () => {
            settings[input.name] = input.checked;
            saveSettings();
            rows.reset({ force: true });
            layout({ animate: true });
            schedulePolling();
            refreshMedia();
        });
}
for (const { stepper, name, steps } of steppers)
    for (const button of stepper.querySelectorAll('[data-step]'))
        button.addEventListener('click', () => {
            const current = settings[name];
            const next =
                button.dataset.step === '1' ?
                    steps.find((step) => step > current + 1e-6)
                :   steps.findLast((step) => step < current - 1e-6);
            if (next === undefined) return;
            settings[name] = next;
            showSetting(menu.querySelector(`input[name="${name}"]`));
            saveSettings();
            updateSteppers();
            if (name === 'uiScale') applyScale();
            if (name === 'functionKeys') layout({ animate: true });
        });
// Reset confirmation: fades and scales in; Cancel, Reset and Escape play the reverse before the dialog really closes.
const confirmDialog = $('#reset-confirm');
let closingDialog = false;
function animateDialog(opening) {
    if (reducedMotion()) return Promise.resolve();
    const panel = [
        { opacity: 0, transform: 'scale(0.96)' },
        { opacity: 1, transform: 'scale(1)' },
    ];
    const shade = [{ opacity: 0 }, { opacity: 1 }];
    const timing = {
        duration: opening ? 180 : 120,
        easing: opening ? 'cubic-bezier(0.2, 0, 0, 1)' : 'ease-in',
        fill: 'forwards',
    };
    const animation = confirmDialog.animate(opening ? panel : panel.reverse(), timing);
    try {
        confirmDialog.animate(opening ? shade : shade.reverse(), { ...timing, pseudoElement: '::backdrop' });
    } catch {}
    return animation.finished.catch(() => {});
}
async function closeDialog(value) {
    if (closingDialog || !confirmDialog.open) return;
    closingDialog = true;
    await animateDialog(false);
    confirmDialog.close(value);
    for (const animation of confirmDialog.getAnimations({ subtree: true })) animation.cancel();
    closingDialog = false;
}
confirmDialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    closeDialog(event.submitter?.value ?? 'cancel');
});
confirmDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog('cancel');
});
// Browsers only let `cancel` be vetoed after a user gesture; stopping Escape itself keeps the exit animation.
document.addEventListener(
    'keydown',
    (event) => {
        if (event.key !== 'Escape' || !confirmDialog.open) return;
        event.preventDefault();
        closeDialog('cancel');
    },
    { capture: true }
);
$('#options-reload').addEventListener('click', () => location.reload());
$('#options-reset').addEventListener('click', () => {
    // Escape leaves returnValue untouched, so clear the previous answer first.
    confirmDialog.returnValue = '';
    confirmDialog.showModal();
    animateDialog(true);
});
$('#reset-confirm').addEventListener('close', () => {
    if ($('#reset-confirm').returnValue !== 'reset') return;
    for (const input of fields) {
        settings[input.name] = defaults[input.name];
        showSetting(input);
    }
    try {
        localStorage.removeItem(storageKey);
    } catch {}
    applyScale();
    applyTheme();
    rows.reset({ force: true });
    layout({ animate: true });
    schedulePolling();
    refreshMedia();
});

function viewport() {
    const visible = window.visualViewport;
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
    document.documentElement.style.setProperty('--viewport-height', `${(visible?.height ?? innerHeight) / unit}rem`);
    document.documentElement.style.setProperty('--viewport-top', `${(visible?.offsetTop ?? 0) / unit}rem`);
}
// The options menu opens under the top bar, which grows with a long status message.
new ResizeObserver(([entry]) => {
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
    document.documentElement.style.setProperty('--topbar-height', `${entry.target.offsetHeight / unit}rem`);
}).observe($('.topbar'));
window.visualViewport?.addEventListener('resize', viewport);
window.visualViewport?.addEventListener('scroll', viewport);
window.addEventListener('resize', viewport);
const release = () => {
    pad.cancelGesture();
    motion.reset();
    rows.reset({ force: true });
    send('release').catch(() => {});
};
window.addEventListener('blur', release);
window.addEventListener('pagehide', release);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
    else if (connectionState === 'disconnected' || connectionState === 'unavailable') connection.wake();
    else {
        mirror.poll();
        refreshMedia();
    }
    schedulePolling();
});
// Installing as an app needs a service worker, which needs HTTPS this phone trusts (the PC's /trust page explains).
let installPrompt = null;
function offerTrust() {
    if (['localhost', '127.0.0.1'].includes(location.hostname)) return;
    $('#trust-pc').href = `http://${location.host}/trust`;
    $('#trust-pc').hidden = false;
}
addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('#install-app').hidden = false;
});
addEventListener('appinstalled', () => {
    installPrompt = null;
    $('#install-app').hidden = true;
});
$('#install-app').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('#install-app').hidden = true;
});
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if ('serviceWorker' in navigator && isSecureContext)
    navigator.serviceWorker
        .register('/sw.js')
        .then(() => {
            // Firefox never fires beforeinstallprompt; on Android it installs from its own menu instead.
            if (!installed && /Firefox/.test(navigator.userAgent) && /Android/.test(navigator.userAgent))
                $('#install-hint').hidden = false;
        })
        .catch(offerTrust);
else if (!installed) offerTrust();
// Development builds (npm run watch) reload when the bundle changed. Background pages freeze their timers, so the
// check also runs on every wake-up and when the server announces a build over the live connection.
if (__DEV_RELOAD__) {
    let revision;
    const checkBuild = async () => {
        try {
            const response = await fetch('/dev-build.json', { cache: 'no-store' });
            const next = (await response.json()).revision;
            if (revision && next && next !== revision) location.reload();
            revision ??= next;
        } catch {}
    };
    checkBuild();
    setInterval(checkBuild, 5000);
    document.addEventListener('visibilitychange', () => document.hidden || checkBuild());
    for (const type of ['focus', 'pageshow', 'online']) addEventListener(type, checkBuild);
    document.addEventListener('dev-build', checkBuild);
}
applyScale();
applyTheme();
layout();
connection.connect();
