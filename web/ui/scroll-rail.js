export class ScrollRail extends HTMLElement {
    #sliding = true;
    #viewport = null;
    get sliding() {
        return this.#sliding;
    }
    /**
     * True scrolls natively, with the browser's fling after the finger lifts. False follows the finger directly,
     * like the trackpad without sliding: no native scrolling, so no momentum the browser could keep running.
     */
    set sliding(value) {
        this.#sliding = value;
        if (this.#viewport) this.#viewport.style.touchAction = value ? '' : 'none';
    }
    connectedCallback() {
        if (this.firstChild) return;
        const horizontal = this.getAttribute('axis') === 'x';
        this.innerHTML = '<div class="rail-viewport" tabindex="0"><div class="rail-content"></div></div>';
        const viewport = (this.#viewport = this.firstElementChild);
        this.sliding = this.#sliding;
        viewport.setAttribute('aria-label', horizontal ? 'Horizontal scroll' : 'Vertical scroll');
        const property = horizontal ? 'scrollLeft' : 'scrollTop';
        const center = 524280;
        let previous = center,
            resetting = false,
            flinging = false,
            idle,
            drag = null;
        const emit = (delta) =>
            this.dispatchEvent(
                new CustomEvent('motion', {
                    bubbles: true,
                    detail: { action: 'scroll', dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta },
                })
            );
        const recenter = () => {
            resetting = true;
            viewport[property] = center;
            previous = viewport[property];
            requestAnimationFrame(() => {
                resetting = false;
            });
        };
        const recenterLater = () => {
            clearTimeout(idle);
            // Recenter only after native momentum stops; moving during a fling cancels it on iOS.
            idle = setTimeout(() => {
                if (Math.abs(previous - center) > 65536) recenter();
            }, 250);
        };
        requestAnimationFrame(recenter);
        this.observer = new ResizeObserver(() => {
            if (viewport.clientWidth && viewport.clientHeight && viewport[property] === 0) recenter();
        });
        this.observer.observe(viewport);

        // Direct mode (sliding off): the finger's movement is the scroll, and lifting it ends everything at once.
        viewport.addEventListener('pointerdown', (event) => {
            if (this.#sliding || event.pointerType === 'mouse' || drag) return;
            drag = { id: event.pointerId, position: horizontal ? event.clientX : event.clientY };
            viewport.setPointerCapture(event.pointerId);
        });
        viewport.addEventListener('pointermove', (event) => {
            if (event.pointerId !== drag?.id) return;
            const position = horizontal ? event.clientX : event.clientY;
            const delta = drag.position - position;
            drag.position = position;
            if (!delta) return;
            // Moved by code with `previous` in step, so the scroll listener does not emit it a second time.
            viewport[property] += delta;
            previous = viewport[property];
            emit(delta);
            recenterLater();
        });
        const endDrag = (event) => {
            if (event.pointerId !== drag?.id) return;
            drag = null;
            this.dispatchEvent(new CustomEvent('motion-release', { bubbles: true, detail: { action: 'scroll' } }));
        };
        viewport.addEventListener('pointerup', endDrag);
        viewport.addEventListener('pointercancel', endDrag);
        viewport.addEventListener('lostpointercapture', endDrag);

        // Native mode (sliding on, mouse wheel, keyboard): scroll events carry the movement, fling included.
        viewport.addEventListener('touchstart', () => (flinging = false), { passive: true });
        viewport.addEventListener('touchend', () => (flinging = true), { passive: true });
        viewport.addEventListener('wheel', () => (flinging = false), { passive: true });
        viewport.addEventListener(
            'scroll',
            () => {
                const position = viewport[property],
                    delta = position - previous;
                previous = position;
                if (delta && !resetting && (this.#sliding || !flinging)) emit(delta);
                recenterLater();
            },
            { passive: true }
        );
        viewport.addEventListener('scrollend', () => {
            flinging = false;
            if (Math.abs(previous - center) > 65536) recenter();
        });
    }
    disconnectedCallback() {
        this.observer?.disconnect();
    }
}
customElements.define('scroll-rail', ScrollRail);
