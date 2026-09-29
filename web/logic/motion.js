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
