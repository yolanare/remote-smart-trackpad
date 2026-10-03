// A panel that opens out of its control and closes back into it, like a liquid glass menu. Its container is a surface
// of its own (an absolute box beside the panel: background, radius, shadow, the blur of what lies behind), so the
// panel only holds the content: scrolling it repaints no blur, and its edges can fade without touching the container.
// Opening, the surface stretches from the control's shape to the panel's on a spring that overshoots a little, and the
// content comes in once the surface has made room for it; open, the surface follows the panel; closing runs back into
// the control, quicker. The surface blurs what is behind it all along (style.css): only its opacity fades it in, at
// the start of the opening, and out, at the end of the closing. Reversed mid-way, it carries on from where it is.

// A spring with a slight overshoot (about 2%), as a CSS linear() easing.
const spring =
    'linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)';
// The content scales in (no blur: a filter over the whole panel is too slow on phones).
const hiddenContent = { opacity: 0, transform: 'scale(0.92)' },
    shownContent = { opacity: 1, transform: 'none' };
// Opening: the surface springs for 380 ms and peaks (its overshoot) around 210 to 240 ms; the content is in by then.
// Its opacity waits until halfway (about 140 ms), so the scale leads and the content does not show cramped.
const surfaceOpening = 380,
    contentDelay = 40,
    contentOpening = 200;
// Per panel: its surface, and the morph running on it (stop, where the surface is).
const surfaces = new WeakMap(),
    running = new WeakMap();

/** A box's corner radius in px, at most half its shorter side (a pill's 999rem would morph as a huge radius). */
function radiusOf(element, box) {
    return Math.min(
        parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
        Math.min(box.width, box.height) / 2
    );
}
/** A box as the surface's geometry, in the panel's positioning area. */
function shapeOf(panel, box, radius) {
    const area = panel.offsetParent.getBoundingClientRect();
    return {
        left: `${box.left - area.left}px`,
        top: `${box.top - area.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        borderRadius: `${radius}px`,
    };
}

/** The panel's surface, created beside it on first use; it follows the panel's size while open. */
function surfaceOf(panel) {
    let entry = surfaces.get(panel);
    if (entry) return entry;
    const surface = document.createElement('div');
    surface.className = 'morph-surface';
    surface.style.zIndex = getComputedStyle(panel).zIndex;
    panel.before(surface);
    const observer = new ResizeObserver(() => entry.settled && settle(panel));
    observer.observe(panel);
    entry = { surface, observer, settled: false };
    surfaces.set(panel, entry);
    return entry;
}
/** Open and at rest: the surface sits exactly on the panel. */
function settle(panel) {
    const entry = surfaceOf(panel),
        box = panel.getBoundingClientRect();
    Object.assign(entry.surface.style, shapeOf(panel, box, radiusOf(panel, box)));
    entry.settled = true;
}
function removeSurface(panel) {
    const entry = surfaces.get(panel);
    if (!entry) return;
    entry.observer.disconnect();
    entry.surface.remove();
    surfaces.delete(panel);
    panel.classList.remove('is-glass');
}

/** Puts an open panel's surface back on it, after something moved the panel without resizing it. */
export function followPanel(panel) {
    if (surfaces.get(panel)?.settled) settle(panel);
}

/**
 * Shows or hides `panel` (positioned, with a background, radius and shadow its surface takes over) by morphing it out
 * of `source` (the visible shape of the control that opens it) or back into it. reduced: no motion. Resolves when done.
 */
export function morphPanel(panel, source, open, { reduced = false } = {}) {
    const previous = running.get(panel);
    // Interrupted: the surface and the content start from where they are.
    const surfaceFrom = previous?.surface(),
        contentFrom = previous && {
            opacity: getComputedStyle(panel).opacity,
            transform: getComputedStyle(panel).transform,
        };
    previous?.stop();
    panel.hidden = false;
    panel.classList.add('is-glass');
    if (reduced) {
        if (open) settle(panel);
        else {
            removeSurface(panel);
            panel.hidden = true;
        }
        return Promise.resolve();
    }
    const entry = surfaceOf(panel),
        { surface } = entry;
    const panelBox = panel.getBoundingClientRect(),
        sourceBox = source.getBoundingClientRect();
    const closedShape = shapeOf(panel, sourceBox, radiusOf(source, sourceBox)),
        openShape = shapeOf(panel, panelBox, radiusOf(panel, panelBox));
    const startShape =
        surfaceFrom
        ?? (open || !entry.settled ?
            closedShape
        :   shapeOf(panel, surface.getBoundingClientRect(), radiusOf(panel, panelBox)));
    entry.settled = false;
    panel.classList.add('is-morphing');
    // The content grows from the control's middle.
    panel.style.transformOrigin = `${sourceBox.left + sourceBox.width / 2 - panelBox.left}px ${sourceBox.top + sourceBox.height / 2 - panelBox.top}px`;
    // The surface fades in over the first fifth of the opening, out over the last third of the closing; reversed
    // mid-way, from the opacity it has.
    const from = { opacity: open ? 0 : 1, ...startShape };
    const grow = surface.animate(
        open ?
            [from, { opacity: 1, offset: 0.2 }, { ...openShape, opacity: 1 }]
        :   [from, { opacity: from.opacity, offset: 0.66 }, { ...closedShape, opacity: 0 }],
        {
            duration: open ? surfaceOpening : 200,
            easing: open ? spring : 'cubic-bezier(0.4, 0, 0.2, 1)',
            fill: 'both',
        }
    );
    const content = panel.animate(
        contentFrom || !open ?
            [contentFrom ?? shownContent, open ? shownContent : hiddenContent]
        :   [hiddenContent, { opacity: 0, offset: 0.5 }, shownContent],
        {
            duration: open ? contentOpening : 90,
            delay: open && !contentFrom ? contentDelay : 0,
            easing: 'ease-out',
            fill: 'both',
        }
    );
    const stop = () => {
        grow.cancel();
        content.cancel();
        panel.classList.remove('is-morphing');
        panel.style.transformOrigin = '';
        if (running.get(panel)?.stop === stop) running.delete(panel);
    };
    running.set(panel, {
        stop,
        surface: () => ({
            ...shapeOf(
                panel,
                surface.getBoundingClientRect(),
                parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 0
            ),
            opacity: Number(getComputedStyle(surface).opacity),
        }),
    });
    return new Promise((resolve) => {
        grow.onfinish = () => {
            stop();
            if (open) settle(panel);
            else {
                removeSurface(panel);
                panel.hidden = true;
            }
            resolve();
        };
        grow.oncancel = resolve;
    });
}
