export class ScrollRail extends HTMLElement {
    connectedCallback() {
        if (this.firstChild) return;
        const horizontal = this.getAttribute('axis') === 'x';
        this.innerHTML = '<div class="rail-viewport" tabindex="0"><div class="rail-content"></div></div>';
        const viewport = this.firstElementChild;
        viewport.setAttribute('aria-label', horizontal ? 'Horizontal scroll' : 'Vertical scroll');
        const property = horizontal ? 'scrollLeft' : 'scrollTop';
        const center = 524280;
        let previous = center,
            resetting = false,
            idle;
        const recenter = () => {
            resetting = true;
            viewport[property] = center;
            previous = viewport[property];
            requestAnimationFrame(() => {
                resetting = false;
            });
        };
        requestAnimationFrame(recenter);
        this.observer = new ResizeObserver(() => {
            if (viewport.clientWidth && viewport.clientHeight && viewport[property] === 0) recenter();
        });
        this.observer.observe(viewport);
        viewport.addEventListener(
            'scroll',
            () => {
                const position = viewport[property],
                    delta = position - previous;
                previous = position;
                if (delta && !resetting)
                    this.dispatchEvent(
                        new CustomEvent('motion', {
                            bubbles: true,
                            detail: { action: 'scroll', dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta },
                        })
                    );
                clearTimeout(idle);
                // Recenter only after native momentum stops; moving during a fling cancels it on iOS.
                idle = setTimeout(() => {
                    if (Math.abs(previous - center) > 65536) recenter();
                }, 250);
            },
            { passive: true }
        );
        viewport.addEventListener('scrollend', () => {
            if (Math.abs(previous - center) > 65536) recenter();
        });
    }
    disconnectedCallback() {
        this.observer?.disconnect();
    }
}
customElements.define('scroll-rail', ScrollRail);
