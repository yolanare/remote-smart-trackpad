/**
 * Fades a scrolling element's content out where more of it hides, in step with the scrolling: the top fade grows
 * with the distance scrolled and the bottom one shrinks with the distance left, each up to 2rem (--fade-above and
 * --fade-below, which style.css turns into a mask on the content, not on its container). Follows the element's size
 * too; `update` is returned for content changes it cannot see (rows shown or hidden).
 */
export function fadeOverflow(element) {
    let frame = 0;
    const update = () => {
        frame = 0;
        const full = 2 * parseFloat(getComputedStyle(document.documentElement).fontSize);
        const { scrollTop, scrollHeight, clientHeight } = element;
        const above = Math.min(Math.max(scrollTop, 0), full),
            below = Math.min(Math.max(scrollHeight - clientHeight - scrollTop, 0), full);
        element.style.setProperty('--fade-above', `${above}px`);
        element.style.setProperty('--fade-below', `${below}px`);
    };
    // Once per frame, however many scroll events arrive.
    element.addEventListener('scroll', () => (frame ||= requestAnimationFrame(update)), { passive: true });
    new ResizeObserver(update).observe(element);
    update();
    return update;
}
