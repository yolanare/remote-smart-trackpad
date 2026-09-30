import './scroll-rail.js';
import { icon } from './icons.js';

class PointerPad extends HTMLElement {
    holding = false;
    slidingEnabled = false;
    slideFrame = 0;
    set sliding(value) {
        if (this.slidingEnabled && !value) this.stopSliding();
        this.slidingEnabled = value;
    }
    set scrollSliding(value) {
        for (const rail of this.querySelectorAll('scroll-rail')) rail.sliding = value;
    }
    stopSliding() {
        cancelAnimationFrame(this.slideFrame);
        this.slideFrame = 0;
        this.dispatchEvent(new CustomEvent('motion-stop', { bubbles: true }));
    }
    disconnectedCallback() {
        this.cancelGesture();
    }
    connectedCallback() {
        if (this.firstChild) return;
        this.innerHTML = `<div class="mouse"><div class="trackpad" role="application" aria-label="Move PC pointer"><div class="dots"></div></div><button class="mouse-left" aria-label="Left click" data-button="left"></button><button class="mouse-middle" aria-label="Middle click" data-button="middle"><span></span></button><button class="mouse-right" aria-label="Right click" data-button="right"></button></div><scroll-rail axis="y"></scroll-rail><scroll-rail axis="x"></scroll-rail><button class="mouse-hold" aria-label="Hold mouse buttons" aria-pressed="false"><span class="hold-box"><span class="hold-label">HOLD<br />CLICKS</span><span class="hold-check"></span></span></button>`;
        const pad = this.querySelector('.trackpad');
        // Gestures: one finger moves, a tap clicks (two quick taps double-click), and tap-then-touch-and-move drags
        // with the left button held until the finger lifts. A single tap's click waits one double-tap window so a
        // drag never starts with an extra click (which would open a file or maximize a window).
        const tapSlop = 10,
            tapDuration = 400,
            doubleTapWindow = 250,
            doubleTapDistance = 48;
        let pointer = null,
            x = 0,
            y = 0,
            startX = 0,
            startY = 0,
            startTime = 0,
            patternX = -4,
            patternY = -6,
            velocityX = 0,
            velocityY = 0,
            lastMove = 0,
            moved = false,
            pendingTap = null,
            secondTouch = false,
            dragging = false,
            buffered = [];
        const command = (detail) => this.dispatchEvent(new CustomEvent('command', { bubbles: true, detail }));
        const click = () => command({ action: 'click', data: { button: 'left' } });
        // speed is the smoothed finger velocity in CSS px/ms, used for pointer acceleration.
        const move = (dx, dy, speed) => {
            const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
            patternX = (patternX + dx) % (1.5 * unit);
            patternY = (patternY + dy) % (1.5 * unit);
            this.querySelector('.dots').style.backgroundPosition = `${patternX / unit}rem ${patternY / unit}rem`;
            this.dispatchEvent(new CustomEvent('motion', { bubbles: true, detail: { action: 'move', dx, dy, speed } }));
        };
        const flushTap = () => {
            if (!pendingTap) return;
            clearTimeout(pendingTap.timer);
            pendingTap = null;
            click();
        };
        const setDragging = (value) => {
            if (dragging === value) return;
            dragging = value;
            pad.classList.toggle('is-dragging', value);
            command({ action: 'button', data: { button: 'left', down: value } });
            if (value) navigator.vibrate?.(10);
        };
        this.cancelGesture = () => {
            this.stopSliding();
            this.releaseButtons?.();
            flushTap();
            setDragging(false);
            secondTouch = false;
            buffered = [];
            if (pointer !== null && pad.hasPointerCapture(pointer)) pad.releasePointerCapture(pointer);
            pointer = null;
        };
        const glide = () => {
            let previous = performance.now();
            const step = (now) => {
                const elapsed = now - previous;
                previous = now;
                if (elapsed > 100 || Math.hypot(velocityX, velocityY) < 0.01) {
                    this.slideFrame = 0;
                    return;
                }
                const decay = Math.exp(-elapsed / 240);
                move(velocityX * 240 * (1 - decay), velocityY * 240 * (1 - decay), Math.hypot(velocityX, velocityY));
                velocityX *= decay;
                velocityY *= decay;
                this.slideFrame = requestAnimationFrame(step);
            };
            this.slideFrame = requestAnimationFrame(step);
        };
        pad.addEventListener('pointerdown', (event) => {
            if (pointer !== null) return;
            pointer = event.pointerId;
            x = startX = event.clientX;
            y = startY = event.clientY;
            startTime = lastMove = performance.now();
            moved = false;
            velocityX = velocityY = 0;
            buffered = [];
            // A touch right after a tap, near it, may become a double click or a drag; decide on move or lift.
            if (pendingTap && Math.hypot(x - pendingTap.x, y - pendingTap.y) < doubleTapDistance) {
                clearTimeout(pendingTap.timer);
                pendingTap = null;
                secondTouch = true;
            } else flushTap();
            pad.setPointerCapture(pointer);
        });
        pad.addEventListener('pointermove', (event) => {
            if (event.pointerId !== pointer) return;
            const dx = event.clientX - x,
                dy = event.clientY - y;
            x = event.clientX;
            y = event.clientY;
            moved ||= Math.hypot(x - startX, y - startY) > tapSlop;
            const now = performance.now();
            const elapsed = Math.max(1, now - lastMove);
            const blend = elapsed > 100 ? 1 : 0.5;
            velocityX = velocityX * (1 - blend) + (dx / elapsed) * blend;
            velocityY = velocityY * (1 - blend) + (dy / elapsed) * blend;
            lastMove = now;
            const speed = Math.hypot(velocityX, velocityY);
            if (secondTouch && !dragging) {
                // Hold the first pixels back so the button goes down where the second touch landed.
                buffered.push([dx, dy, speed]);
                if (!moved) return;
                setDragging(true);
                for (const delta of buffered.splice(0)) move(...delta);
                return;
            }
            move(dx, dy, speed);
        });
        pad.addEventListener('pointerup', (event) => {
            if (event.pointerId !== pointer) return;
            pointer = null;
            const tap = !moved && performance.now() - startTime < tapDuration;
            if (dragging) setDragging(false);
            else if (secondTouch) {
                if (tap) {
                    click();
                    click();
                } else {
                    // A second touch held without moving: still the first tap's click.
                    click();
                    for (const delta of buffered) move(...delta);
                }
            } else if (tap) {
                const timer = setTimeout(() => {
                    pendingTap = null;
                    click();
                }, doubleTapWindow);
                pendingTap = { x: startX, y: startY, timer };
            } else if (this.slidingEnabled && performance.now() - lastMove < 100 && !this.querySelector('.is-held'))
                glide();
            secondTouch = false;
            buffered = [];
        });
        pad.addEventListener('pointercancel', this.cancelGesture);
        pad.addEventListener('lostpointercapture', () => {
            if (pointer !== null) this.cancelGesture();
        });
        // Hold mode: a tap presses a mouse button and keeps it down until the next tap on it (one finger at a time).
        const hold = this.querySelector('.mouse-hold');
        hold.querySelector('.hold-check').append(icon('check'));
        const latched = new Set();
        const setLatched = (button, down) => {
            if (down) latched.add(button);
            else latched.delete(button);
            button.classList.toggle('is-latched', down);
            command({ action: 'button', data: { button: button.dataset.button, down } });
        };
        this.releaseButtons = () => {
            for (const button of [...latched]) setLatched(button, false);
        };
        hold.addEventListener('pointerdown', (event) => event.preventDefault());
        hold.addEventListener('click', () => {
            this.holding = !this.holding;
            hold.setAttribute('aria-pressed', String(this.holding));
            if (!this.holding) this.releaseButtons();
        });
        this.querySelectorAll('[data-button]').forEach((button) => {
            let held = false,
                last = null;
            button.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                if (this.holding) return setLatched(button, !latched.has(button));
                if (held) return;
                button.setPointerCapture(event.pointerId);
                held = true;
                last = { x: event.clientX, y: event.clientY, time: performance.now() };
                button.classList.add('is-held');
                command({ action: 'button', data: { button: button.dataset.button, down: true } });
            });
            const release = () => {
                if (held) {
                    held = false;
                    button.classList.remove('is-held');
                    command({ action: 'button', data: { button: button.dataset.button, down: false } });
                }
            };
            // Dragging from the held middle button moves the pointer too (middle-drag panning, autoscroll).
            if (button.dataset.button === 'middle')
                button.addEventListener('pointermove', (event) => {
                    if (!held || !last) return;
                    const dx = event.clientX - last.x,
                        dy = event.clientY - last.y,
                        now = performance.now();
                    if (!dx && !dy) return;
                    move(dx, dy, Math.hypot(dx, dy) / Math.max(1, now - last.time));
                    last = { x: event.clientX, y: event.clientY, time: now };
                });
            button.addEventListener('pointerup', release);
            button.addEventListener('pointercancel', release);
            button.addEventListener('lostpointercapture', release);
            button.addEventListener('click', (event) => {
                // Keyboard activation has no pointer: click, or toggle in hold mode.
                if (event.detail !== 0) return;
                if (this.holding) setLatched(button, !latched.has(button));
                else command({ action: 'click', data: { button: button.dataset.button } });
            });
        });
        this.addEventListener('contextmenu', (event) => event.preventDefault());
    }
}
customElements.define('pointer-pad', PointerPad);
