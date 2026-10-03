export function createMotion(send, onError) {
    // sentX/sentY: the scroll's last wheel amounts, which wheelStep keeps the next ones from repeating.
    const queues = {
        move: { dx: 0, dy: 0, busy: false },
        scroll: { dx: 0, dy: 0, busy: false, sentX: 0, sentY: 0 },
    };
    // What to send now: whole pixels for the pointer, wheel amounts shaped by wheelStep for a scroll.
    const next = (action, queue) =>
        action === 'move' ?
            { dx: Math.trunc(queue.dx), dy: Math.trunc(queue.dy) }
        :   { dx: wheelStep(queue.dx, queue.sentX), dy: wheelStep(queue.dy, queue.sentY) };
    let frame = 0,
        generation = 0;
    async function flush(action) {
        const queue = queues[action];
        if (queue.busy) return;
        const current = generation;
        queue.busy = true;
        try {
            for (let step = next(action, queue); current === generation && (step.dx || step.dy); step = next(action, queue)) {
                const { dx, dy } = step;
                queue.dx -= dx;
                queue.dy -= dy;
                if (dx) queue.sentX = Math.abs(dx);
                if (dy) queue.sentY = Math.abs(dy);
                await send(action, { dx, dy });
            }
        } catch (error) {
            if (current === generation) {
                queue.dx = queue.dy = 0;
                onError(error.message);
            }
        } finally {
            if (current === generation) queue.busy = false;
        }
    }
    return {
        add(action, dx, dy) {
            queues[action].dx += dx;
            queues[action].dy += dy;
            if (!frame)
                frame = requestAnimationFrame(() => {
                    frame = 0;
                    flush('move');
                    flush('scroll');
                });
        },
        /** Drops movement not yet sent, e.g. a fling cut short when the finger lifts. */
        clear(action) {
            queues[action].dx = queues[action].dy = 0;
        },
        reset() {
            generation++;
            cancelAnimationFrame(frame);
            frame = 0;
            for (const queue of Object.values(queues)) {
                queue.dx = queue.dy = 0;
                queue.busy = false;
            }
        },
    };
}

/**
 * The wheel amount to send now (120 a notch) from what a scroll has queued on one axis, given the last amount sent on
 * it. Apps that tell a mouse wheel from a touchpad by the deltas they get see a wheel in repeated amounts, amounts that
 * divide each other and whole pixels: VS Code's lists then animate, and a stream that flips between both scrolls
 * twice at once, smoothly and in jumps. So an amount is at least 2, neither divides nor is a multiple of the previous
 * one, and is no multiple of 6 or 9 (whole pixels in Chrome with 3 or 4 lines a notch, or 3 characters sideways). The
 * largest that fits goes; the rest waits for the next frame.
 */
export function wheelStep(queued, previous) {
    for (let size = Math.trunc(Math.abs(queued)); size >= 2; size--)
        if (size % 6 && size % 9 && (!previous || (size % previous && previous % size))) return Math.sign(queued) * size;
    return 0;
}

/**
 * Pointer gain for a finger speed in CSS px/ms. A smoothstep S-curve eases from a damped precision gain for slow
 * strokes to an amplified gain for flicks, like Windows' "Enhance pointer precision" and libinput's adaptive profile
 * (https://wayland.freedesktop.org/libinput/doc/latest/pointer-acceleration.html). Strength 0 disables it; the gain
 * is raised to the strength so stronger options widen both ends without going negative.
 */
export function pointerGain(speed, strength) {
    if (!strength) return 1;
    const progress = Math.min(Math.max((speed - 0.1) / 1.5, 0), 1);
    const eased = progress * progress * (3 - 2 * progress);
    return (0.5 + eased * 2) ** strength;
}
