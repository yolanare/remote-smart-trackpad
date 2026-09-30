import { hapticTrigger } from 'ios-haptics';

// Haptic feedback on the phone, only where something happens, in two kinds the options switch separately:
// - buttons: keys (on touch down, like a phone keyboard), mouse clicks, opening the options menu or toggling the
//   text editor, values that change (option toggles, color scheme, steppers, hold clicks), and the trackpad's drag
//   start and edge zones. Closing a menu, the backdrop, dialogs, links and reload stay silent.
// - scroll: a light tick each time a rail's tick mark passes its middle. The trackpad's movement never ticks.
//
// - iOS Safari has no vibration API. ios-haptics (https://github.com/tijnjh/ios-haptics) lays a transparent native
//   switch over an element; the user's own tap toggles it and Safari answers with its switch haptic. It only works
//   from a real tap, so it goes on the buttons listed below (the switch would swallow a mouse button's drag, and
//   would also buzz when the options toggle closes the menu). No scroll ticks on iOS.
// - Android and others: the Vibration API through tick(), called where the action happens.
const iosTargets = 'key-rows button, .mouse-hold, .stepper button, #editor-open, #editor-close';
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

/** A short tick of the given kind (Android; iOS gets its button haptics from attachHaptics). */
export function tick(duration = 8, kind = 'button') {
    if (enabled[kind]) navigator.vibrate?.(duration);
}
