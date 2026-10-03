import { hapticTrigger } from 'ios-haptics';

// Haptic feedback on the phone, only where something happens, in two kinds the options switch separately:
// - buttons: every button and link when it acts (remote.js); keys and mouse clicks on touch down, like a phone keyboard;
//   option toggles and steppers when their value changes; the trackpad's drag start and edge zones. Only closing
//   the options or modes menu (its toggle or its backdrop) stays silent.
// - scroll: a light tick each time a rail's tick mark passes its middle. The trackpad's movement never ticks.
//
// - iOS Safari has no vibration API. ios-haptics (https://github.com/tijnjh/ios-haptics) lays a transparent native
//   switch over an element; the user's own tap toggles it and Safari answers with its switch haptic. It only works
//   from a real tap. It goes on every button except: mouse buttons (the switch would swallow their drag), the
//   options and modes toggles (they would also buzz when closing) and their backdrops, and form buttons (a tap on
//   the switch would not submit). No scroll ticks on iOS.
// - Android and others: the Vibration API through tick(), called where the action happens.
const iosTargets =
    'button:not(.mouse-left, .mouse-right, .mouse-middle, .mouse-mode, #options-toggle, #options-dismiss, #mode-dismiss, form button)';
const enabled = { button: true, scroll: true };

/** Adds iOS tap haptics to the eligible buttons under root; safe to call again after re-rendering. */
export function attachHaptics(root) {
    for (const button of root.querySelectorAll(iosTargets)) hapticTrigger(button);
}

/** Turns each kind on or off; iOS button haptics follow through data-no-button-haptics (style.css). */
export function setHaptics({ button = enabled.button, scroll = enabled.scroll }) {
    enabled.button = button;
    enabled.scroll = scroll;
    document.documentElement.toggleAttribute('data-no-button-haptics', !button);
}

// The Vibration API has no intensity, only a duration: every tick is the shortest pulse, the lightest feedback (a
// phone's bedtime or do-not-disturb mode can silence it entirely).
const pulse = 1;
/** A tick of the given kind, button or scroll (Android; iOS gets its button haptics from attachHaptics). */
export function tick(kind = 'button') {
    if (enabled[kind]) navigator.vibrate?.(pulse);
}

/**
 * Stops the context menu of a right click on element, but leaves a touch's long press alone: Chrome on Android
 * vibrates whenever a page claims a long press, cancelling its contextmenu included, so a finger resting or sliding
 * slowly on a control buzzed. Unclaimed, that long press shows nothing on these controls (no link, image or
 * selectable text) and stays silent.
 */
export function blockMenu(element) {
    let touch = false;
    element.addEventListener('pointerdown', (event) => (touch = event.pointerType === 'touch'), { capture: true });
    element.addEventListener('contextmenu', (event) => {
        if (!touch) event.preventDefault();
    });
}
