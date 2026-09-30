import './scroll-rail.js';

class PointerPad extends HTMLElement {
    slidingEnabled = false;
    slideFrame = 0;
    set sliding(value) {
        if (this.slidingEnabled && !value) this.stopSliding();
        this.slidingEnabled = value;
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
        this.innerHTML = `<div class="mouse"><div class="trackpad" role="application" aria-label="Move PC pointer"><div class="dots"></div></div><button class="mouse-left" aria-label="Left click" data-button="left"></button><button class="mouse-right" aria-label="Right click" data-button="right"></button></div><scroll-rail axis="y"></scroll-rail><scroll-rail axis="x"></scroll-rail><button class="mouse-middle" aria-label="Middle click" data-button="middle"><span></span></button>`;
        const pad = this.querySelector('.trackpad');
        let pointer = null,
            x = 0,
            y = 0,
            startX = 0,
            startY = 0,
            patternX = -4,
            patternY = -6,
            velocityX = 0,
            velocityY = 0,
            lastMove = 0,
            moved = false;
        const command = (detail) => this.dispatchEvent(new CustomEvent('command', { bubbles: true, detail }));
        // speed is the smoothed finger velocity in CSS px/ms, used for pointer acceleration.
        const move = (dx, dy, speed) => {
            const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
            patternX = (patternX + dx) % (1.5 * unit);
            patternY = (patternY + dy) % (1.5 * unit);
            this.querySelector('.dots').style.backgroundPosition = `${patternX / unit}rem ${patternY / unit}rem`;
            this.dispatchEvent(new CustomEvent('motion', { bubbles: true, detail: { action: 'move', dx, dy, speed } }));
        };
        this.cancelGesture = () => {
            this.stopSliding();
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
            x = event.clientX;
            y = event.clientY;
            startX = x;
            startY = y;
            moved = false;
            velocityX = velocityY = 0;
            lastMove = performance.now();
            pad.setPointerCapture(pointer);
        });
        pad.addEventListener('pointermove', (event) => {
            if (event.pointerId !== pointer) return;
            const dx = event.clientX - x,
                dy = event.clientY - y;
            x = event.clientX;
            y = event.clientY;
            moved ||= Math.hypot(x - startX, y - startY) > 4;
            const now = performance.now();
            const elapsed = Math.max(1, now - lastMove);
            const blend = elapsed > 100 ? 1 : 0.5;
            velocityX = velocityX * (1 - blend) + (dx / elapsed) * blend;
            velocityY = velocityY * (1 - blend) + (dy / elapsed) * blend;
            lastMove = now;
            move(dx, dy, Math.hypot(velocityX, velocityY));
        });
        pad.addEventListener('pointerup', (event) => {
            if (event.pointerId !== pointer) return;
            pointer = null;
            if (!moved) command({ action: 'click', data: { button: 'left' } });
            else if (this.slidingEnabled && performance.now() - lastMove < 100 && !this.querySelector('.is-held'))
                glide();
        });
        pad.addEventListener('pointercancel', this.cancelGesture);
        pad.addEventListener('lostpointercapture', () => {
            if (pointer !== null) this.cancelGesture();
        });
        this.querySelectorAll('[data-button]').forEach((button) => {
            let held = false;
            button.addEventListener('pointerdown', (event) => {
                if (held) return;
                event.preventDefault();
                button.setPointerCapture(event.pointerId);
                held = true;
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
            button.addEventListener('pointerup', release);
            button.addEventListener('pointercancel', release);
            button.addEventListener('lostpointercapture', release);
            button.addEventListener('click', (event) => {
                if (event.detail === 0) command({ action: 'click', data: { button: button.dataset.button } });
            });
        });
        this.addEventListener('contextmenu', (event) => event.preventDefault());
    }
}
customElements.define('pointer-pad', PointerPad);
