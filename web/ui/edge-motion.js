// Edge motion (as on laptop touchpads): while a finger drags the pointer, holding it near an edge of the screen keeps
// the PC pointer moving. The phone only sends a velocity (`glide`); the PC moves the pointer smoothly on its own
// timer, so the motion does not step with network latency. Bands along the edges fade in as the finger approaches
// (from twice their size), brighten once it is inside, and only exist during a drag.

// Zone sizes as a share of the viewport. The bottom is larger than the top: the buttons sit down there.
const zone = { left: 0.12, right: 0.12, top: 0.05, bottom: 0.08 };
const approach = 2;
// Bands are drawn 5% larger than their zone, so the gradient's tail runs a little past the real trigger.
const bandScale = 2;
// Pointer speed deep in a zone, in CSS px/ms before mouse speed and acceleration apply.
const edgeSpeed = 0.8;
// Along each edge, the middle 40% of the screen moves straight (perpendicular to the edge); beyond it the direction
// tilts progressively, up to 45° in the corners. The screen's shape therefore never turns a sideways push diagonal.
const straight = 0.4;
// The PC stops a glide it has not heard about for 300 ms; renew it while it lasts.
const renewal = 100;
const sides = Object.keys(zone);

/** -1…1 from the center along an edge → the tilt toward that end: 0 in the straight middle, ±1 at the ends. */
function tilt(offset) {
    return Math.sign(offset) * Math.max(0, (Math.abs(offset) - straight) / (1 - straight));
}
const ease = (value) => value * value * (3 - 2 * value);

/**
 * glide(vx, vy, speed): pointer velocity in CSS px/ms (0, 0 stops) and its magnitude, for acceleration.
 * animate(dx, dy): per-frame visual offset for the phone's own feedback (the trackpad dots).
 */
export function createEdgeMotion({ glide, animate }) {
    const overlay = document.createElement('div');
    overlay.className = 'edge-motion';
    overlay.setAttribute('aria-hidden', 'true');
    const bands = Object.fromEntries(
        sides.map((side) => {
            const band = document.createElement('div');
            band.className = `edge-motion-${side}`;
            // The bands are sized from the same numbers the zones use.
            band.style.setProperty(
                side === 'left' || side === 'right' ? 'width' : 'height',
                `${zone[side] * bandScale * 100}%`
            );
            overlay.append(band);
            return [side, band];
        })
    );
    document.body.append(overlay);
    let velocity = { x: 0, y: 0, speed: 0 },
        sent = null,
        renewTimer = 0,
        frame = 0,
        last = 0;

    function send() {
        sent = { ...velocity };
        glide(velocity.x, velocity.y, velocity.speed);
    }
    function frameStep(now) {
        const elapsed = Math.min(50, now - last);
        last = now;
        if (!velocity.speed) {
            frame = 0;
            return;
        }
        animate(velocity.x * elapsed, velocity.y * elapsed);
        frame = requestAnimationFrame(frameStep);
    }
    function setVelocity(next) {
        velocity = next;
        const moving = velocity.speed > 0;
        // Send on a real change only; the renewal timer keeps an unchanged glide alive.
        const changed =
            !sent
            || Math.abs(sent.x - velocity.x) > 0.01
            || Math.abs(sent.y - velocity.y) > 0.01
            || moving !== sent.speed > 0;
        if (changed) send();
        if (moving && !renewTimer) renewTimer = setInterval(send, renewal);
        if (!moving && renewTimer) {
            clearInterval(renewTimer);
            renewTimer = 0;
        }
        if (moving && !frame) {
            last = performance.now();
            frame = requestAnimationFrame(frameStep);
        }
    }
    return {
        /** The dragging finger moved to (x, y), in viewport coordinates. */
        update(x, y) {
            const width = innerWidth,
                height = innerHeight;
            const size = {
                left: width * zone.left,
                right: width * zone.right,
                top: height * zone.top,
                bottom: height * zone.bottom,
            };
            const distance = { left: x, right: width - x, top: y, bottom: height - y };
            // Position along the edges, -1…1 from the center of the screen.
            const across = { x: (x - width / 2) / (width / 2), y: (y - height / 2) / (height / 2) };
            const push = {
                left: { x: -1, y: tilt(across.y) },
                right: { x: 1, y: tilt(across.y) },
                top: { x: tilt(across.x), y: -1 },
                bottom: { x: tilt(across.x), y: 1 },
            };
            let depth = 0,
                directionX = 0,
                directionY = 0;
            for (const side of sides) {
                const inside = Math.min(1, Math.max(0, 1 - distance[side] / size[side]));
                const proximity = Math.min(1, Math.max(0, (approach * size[side] - distance[side]) / size[side]));
                bands[side].style.setProperty('--proximity', proximity);
                bands[side].classList.toggle('is-active', inside > 0);
                if (!inside) continue;
                // In a corner both edges push, each by how deep the finger is in it.
                directionX += push[side].x * inside;
                directionY += push[side].y * inside;
                depth = Math.max(depth, inside);
            }
            const length = Math.hypot(directionX, directionY);
            const speed = depth && length ? edgeSpeed * ease(depth) : 0;
            setVelocity(
                speed ?
                    { x: (directionX / length) * speed, y: (directionY / length) * speed, speed }
                :   { x: 0, y: 0, speed: 0 }
            );
        },
        /** The drag ended: stop the glide and hide the bands. */
        end() {
            for (const band of Object.values(bands)) {
                band.style.setProperty('--proximity', 0);
                band.classList.remove('is-active');
            }
            if (velocity.speed || sent?.speed) setVelocity({ x: 0, y: 0, speed: 0 });
            cancelAnimationFrame(frame);
            frame = 0;
        },
    };
}
