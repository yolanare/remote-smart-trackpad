export function createMotion(send, onError) {
    const queues = { move: { dx: 0, dy: 0, busy: false }, scroll: { dx: 0, dy: 0, busy: false } };
    let frame = 0,
        generation = 0;
    async function flush(action) {
        const queue = queues[action];
        if (queue.busy) return;
        const current = generation;
        queue.busy = true;
        try {
            while (current === generation && (Math.trunc(queue.dx) || Math.trunc(queue.dy))) {
                const dx = Math.trunc(queue.dx),
                    dy = Math.trunc(queue.dy);
                queue.dx -= dx;
                queue.dy -= dy;
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
 * Pointer gain for a finger speed in CSS px/ms. A smoothstep S-curve eases from a damped precision gain for slow
 * strokes to an amplified gain for flicks, like Windows' "Enhance pointer precision" and libinput's adaptive profile
 * (https://wayland.freedesktop.org/libinput/doc/latest/pointer-acceleration.html). Strength 0 disables it; the gain
 * is raised to the strength so stronger settings widen both ends without going negative.
 */
export function pointerGain(speed, strength) {
    if (!strength) return 1;
    const progress = Math.min(Math.max((speed - 0.1) / 1.5, 0), 1);
    const eased = progress * progress * (3 - 2 * progress);
    return (0.5 + eased * 2) ** strength;
}
