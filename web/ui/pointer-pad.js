import './scroll-rail.js';

class PointerPad extends HTMLElement {
    connectedCallback() {
        if (this.firstChild) return;
        this.innerHTML = `<div class="mouse"><div class="trackpad" role="application" aria-label="Move PC pointer"><div class="dots"></div></div><button class="mouse-left" aria-label="Left click" data-button="left"></button><button class="mouse-right" aria-label="Right click" data-button="right"></button></div><scroll-rail axis="y"></scroll-rail><scroll-rail axis="x"></scroll-rail><button class="mouse-middle" aria-label="Middle click" data-button="middle"><span></span></button>`;
        const pad = this.querySelector('.trackpad');
        let pointer = null,
            x = 0,
            y = 0,
            patternX = -4,
            patternY = -6,
            moved = false;
        const command = (detail) => this.dispatchEvent(new CustomEvent('command', { bubbles: true, detail }));
        pad.addEventListener('pointerdown', (event) => {
            if (pointer !== null) return;
            pointer = event.pointerId;
            x = event.clientX;
            y = event.clientY;
            moved = false;
            pad.setPointerCapture(pointer);
        });
        pad.addEventListener('pointermove', (event) => {
            if (event.pointerId !== pointer) return;
            const dx = event.clientX - x,
                dy = event.clientY - y;
            x = event.clientX;
            y = event.clientY;
            moved ||= Math.abs(dx) + Math.abs(dy) > 1;
            const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
            patternX = (patternX + dx) % (1.5 * unit);
            patternY = (patternY + dy) % (1.5 * unit);
            this.querySelector('.dots').style.backgroundPosition = `${patternX / unit}rem ${patternY / unit}rem`;
            this.dispatchEvent(new CustomEvent('motion', { bubbles: true, detail: { action: 'move', dx, dy } }));
        });
        pad.addEventListener('pointerup', (event) => {
            if (event.pointerId !== pointer) return;
            pointer = null;
            if (!moved) command({ action: 'click', data: { button: 'left' } });
        });
        pad.addEventListener('pointercancel', () => {
            pointer = null;
        });
        pad.addEventListener('lostpointercapture', () => {
            pointer = null;
        });
        this.querySelectorAll('[data-button]').forEach((button) => {
            let held = false;
            button.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                button.setPointerCapture(event.pointerId);
                held = true;
                command({ action: 'button', data: { button: button.dataset.button, down: true } });
            });
            const release = () => {
                if (held) {
                    held = false;
                    command({ action: 'button', data: { button: button.dataset.button, down: false } });
                }
            };
            button.addEventListener('pointerup', release);
            button.addEventListener('lostpointercapture', release);
            button.addEventListener('click', (event) => {
                if (event.detail === 0) command({ action: 'click', data: { button: button.dataset.button } });
            });
        });
        this.addEventListener('contextmenu', (event) => event.preventDefault());
    }
}
customElements.define('pointer-pad', PointerPad);
