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
        // The rest position is the middle of the scroll range, which follows the interface scale (rem-sized content).
        const center = () => {
            const size =
                horizontal ?
                    viewport.scrollWidth - viewport.clientWidth
                :   viewport.scrollHeight - viewport.clientHeight;
            return Math.max(0, Math.round(size / 2));
        };
        let previous = 0,
            resetting = false,
            flinging = false,
            idle,
            drag = null;
        // speed: smoothed scroll velocity in CSS px/ms, like the trackpad's finger speed, for scroll acceleration.
        let speed = 0,
            lastEmit = 0;
        const emit = (delta) => {
            const now = performance.now(),
                elapsed = now - lastEmit;
            const blend = elapsed > 100 ? 1 : 0.5;
            speed = speed * (1 - blend) + (Math.abs(delta) / Math.max(1, elapsed)) * blend;
            lastEmit = now;
            this.dispatchEvent(
                new CustomEvent('motion', {
                    bubbles: true,
                    detail: { action: 'scroll', dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta, speed },
                })
            );
        };
        // Ticks repeat every 1.875rem with the tick itself at 1.8125–1.875rem (see .rail-content in style.css).
        const ticks = () => {
            const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
            return { period: 1.875 * unit, tick: 1.84375 * unit };
        };
        const content = viewport.firstElementChild;
        // At rest (scrolled to `center`) a tick sits in the middle of the rail, whatever its size.
        const align = () => {
            const { period, tick } = ticks();
            const size = horizontal ? viewport.clientWidth : viewport.clientHeight;
            // Whole pixels: a 1px tick on a half pixel blurs away.
            const offset = Math.round((((center() + size / 2 - tick) % period) + period) % period);
            content.style.backgroundPosition = horizontal ? `${offset}px 0` : `0 ${offset}px`;
        };
        const recenter = () => {
            // Jump back by whole tick periods only, so the visible ticks do not shift when the rail recenters.
            const { period } = ticks();
            resetting = true;
            viewport[property] = center() + ((((previous - center()) % period) + period) % period);
            previous = viewport[property];
            requestAnimationFrame(() => {
                resetting = false;
            });
        };
        const recenterLater = () => {
            clearTimeout(idle);
            // Recenter only after native momentum stops; moving during a fling cancels it on iOS.
            idle = setTimeout(() => {
                if (Math.abs(previous - center()) > 16384) recenter();
            }, 250);
        };
        // Exactly to the rest position (first layout, or a resize such as an interface scale change moved it).
        const reset = () => {
            previous = center();
            recenter();
        };
        requestAnimationFrame(reset);
        // A resize (layout, keyboard, interface scale) happens at rest: re-center exactly so a tick stays in the middle.
        this.observer = new ResizeObserver(() => {
            align();
            if (viewport.clientWidth && viewport.clientHeight && !drag) reset();
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
        // Touch feedback: the ticks brighten while a finger is on the rail (touch events last through native
        // panning, unlike the pointer, which the browser cancels once it scrolls).
        viewport.addEventListener(
            'touchstart',
            () => {
                flinging = false;
                this.classList.add('is-touched');
            },
            { passive: true }
        );
        const untouch = () => this.classList.remove('is-touched');
        viewport.addEventListener(
            'touchend',
            (event) => {
                flinging = true;
                if (!event.touches.length) untouch();
            },
            { passive: true }
        );
        viewport.addEventListener('touchcancel', untouch, { passive: true });
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
            if (Math.abs(previous - center()) > 16384) recenter();
        });
    }
    disconnectedCallback() {
        this.observer?.disconnect();
    }
}
customElements.define('scroll-rail', ScrollRail);
