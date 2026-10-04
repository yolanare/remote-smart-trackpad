import { tick } from './haptics.js';

// The options menu as the options' adapter (logic/options.js): its inputs show the values and set them.

/**
 * The options' schema, from the menu's inputs: their HTML attributes are the defaults (the key rows' switches take
 * theirs from `rowDefaults`, key-rows.js), and their kind and limits what a value may be. A radio group (segmented
 * control) is one option, its default the radio checked in the markup. A hidden input names its default in
 * data-default: desktop browsers restore form values when the page reloads, and a hidden input's restored value
 * becomes its default too (a reset then went back to the last interface scale).
 */
export function readSchema(menu, rowDefaults) {
    for (const [name, enabled] of Object.entries(rowDefaults))
        menu.querySelector(`input[name="${name}"]`).defaultChecked = enabled;
    const radios = (name) => [...menu.querySelectorAll(`input[type="radio"][name="${name}"]`)];
    const schema = {};
    for (const input of menu.querySelectorAll('input[name]')) {
        if (input.name in schema) continue;
        schema[input.name] =
            input.type === 'checkbox' ? { default: input.defaultChecked, valid: (value) => typeof value === 'boolean' }
            : input.type === 'radio' ?
                {
                    default: radios(input.name).find((radio) => radio.defaultChecked).value,
                    valid: (value) => radios(input.name).some((radio) => radio.value === value),
                }
            :   {
                    default: Number(input.dataset.default ?? input.defaultValue),
                    valid: (value) =>
                        Number.isFinite(value) && value >= Number(input.min) && value <= Number(input.max),
                };
    }
    return schema;
}

const times = (value) => `${Number(value.toFixed(2))}×`;

/**
 * A slider under a finger (style.css lets touches through it to its row): a drag that starts sideways sets it, one
 * that starts up or down is the menu scrolling and leaves it alone, a tap sets it where it lands. Mouse and keyboard
 * keep the native slider.
 */
function followFinger(input, options) {
    const row = input.parentElement,
        slop = 8;
    let touch = null;
    const valueAt = (x) => {
        const box = input.getBoundingClientRect(),
            thumb = 0.875 * parseFloat(getComputedStyle(document.documentElement).fontSize);
        const share = Math.min(1, Math.max(0, (x - box.left - thumb / 2) / (box.width - thumb)));
        const min = Number(input.min),
            step = Number(input.step) || 1;
        const value = min + Math.round((share * (Number(input.max) - min)) / step) * step;
        return Number(value.toFixed(6));
    };
    const set = (x) => options.set(input.name, valueAt(x));
    row.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') return;
        const box = input.getBoundingClientRect();
        if (event.clientY < box.top || event.clientY > box.bottom) return;
        touch = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    });
    row.addEventListener('pointermove', (event) => {
        if (event.pointerId !== touch?.id) return;
        const dx = Math.abs(event.clientX - touch.x),
            dy = Math.abs(event.clientY - touch.y);
        if (!touch.dragging) {
            if (dy > slop && dy > dx) return void (touch = null);
            if (dx <= slop) return;
            touch.dragging = true;
            row.setPointerCapture(event.pointerId);
        }
        set(event.clientX);
    });
    row.addEventListener('pointerup', (event) => {
        if (event.pointerId !== touch?.id) return;
        if (!touch.dragging) set(event.clientX);
        touch = null;
    });
    row.addEventListener('pointercancel', () => (touch = null));
}

/**
 * Shows the options in the menu and lets its inputs change them: switches and segments tick when they change, sliders
 * follow the finger, steppers step through their data-steps. A step of the interface scale reflows the whole menu:
 * it scrolls so the stepper stays under the finger.
 */
export function bindOptionsMenu(menu, options) {
    const fields = [...menu.querySelectorAll('input[name]')];
    function show(input) {
        const value = options.values[input.name];
        if (input.type === 'checkbox') return void (input.checked = value);
        if (input.type === 'radio') return void (input.checked = input.value === value);
        input.value = value;
        const off = input.name.endsWith('Acceleration') && value === 0;
        // Sliders name their output with for=; a stepper's output sits in its own pill.
        const output =
            menu.querySelector(`output[for="${input.id}"]`)
            ?? menu.querySelector(`.stepper[data-option="${input.name}"] output`);
        // data-unit="" shows a plain number (a count); otherwise a multiplier.
        if (output)
            output.value =
                off ? 'Off'
                : input.dataset.unit === '' ? String(value)
                : times(value);
        if (input.type !== 'range') return;
        // Where the thumb stands, from 0 to 1: the track's fill and the gap around the thumb follow it.
        input.style.setProperty(
            '--position',
            String((value - Number(input.min)) / (Number(input.max) - Number(input.min)))
        );
        input.setAttribute('aria-valuetext', off ? 'Off' : `${Number(value.toFixed(2))} times`);
    }
    // Steppers step through the values listed in data-steps for the option named in data-option.
    const steppers = [...menu.querySelectorAll('.stepper')].map((stepper) => ({
        stepper,
        name: stepper.dataset.option,
        steps: stepper.dataset.steps.split(' ').map(Number),
    }));
    function showSteppers() {
        for (const { stepper, name, steps } of steppers) {
            stepper.querySelector('[data-step="-1"]').disabled = options.values[name] <= steps[0];
            stepper.querySelector('[data-step="1"]').disabled = options.values[name] >= steps.at(-1);
        }
    }
    function keepInPlace(element, top) {
        const adjust = () => (menu.scrollTop += element.getBoundingClientRect().top - top);
        adjust();
        // Again once the top bar's height has followed (ResizeObserver, after this frame).
        requestAnimationFrame(() => requestAnimationFrame(adjust));
    }
    for (const input of fields.filter((field) => field.type === 'range')) followFinger(input, options);
    for (const input of fields) {
        show(input);
        if (input.type === 'range') input.addEventListener('input', () => options.set(input.name, input.valueAsNumber));
        if (input.type === 'radio' || input.type === 'checkbox')
            input.addEventListener('change', () => {
                options.set(input.name, input.type === 'radio' ? input.value : input.checked);
                // After the change applies, so turning button haptics on ticks and turning them off does not.
                tick();
            });
    }
    showSteppers();
    for (const { stepper, name, steps } of steppers)
        for (const button of stepper.querySelectorAll('[data-step]'))
            button.addEventListener('click', () => {
                const current = options.values[name];
                const next =
                    button.dataset.step === '1' ?
                        steps.find((step) => step > current + 1e-6)
                    :   steps.findLast((step) => step < current - 1e-6);
                if (next === undefined) return;
                const top = stepper.getBoundingClientRect().top;
                options.set(name, next);
                tick();
                keepInPlace(stepper, top);
            });
    options.onChange((names) => {
        for (const input of fields) if (names.includes(input.name)) show(input);
        showSteppers();
    });
}
