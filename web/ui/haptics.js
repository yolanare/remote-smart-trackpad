import { hapticTrigger } from 'ios-haptics';

// Haptic feedback on the phone.
// - iOS Safari has no vibration API. ios-haptics (https://github.com/tijnjh/ios-haptics) lays a transparent native
//   switch over an element; the user's own tap toggles it and Safari answers with its switch haptic. It only works
//   from a real tap, and the switch lets the page pan, so it goes on plain buttons, never on the trackpad or the
//   mouse buttons, whose drags need every touch.
// - Android and others: the Vibration API, called directly (it does nothing where unsupported).
const excluded = '.mouse-left, .mouse-right, .mouse-middle';

/** Adds iOS tap haptics to every eligible button under root; safe to call again after re-rendering. */
export function attachHaptics(root) {
    for (const button of root.querySelectorAll('button')) if (!button.matches(excluded)) hapticTrigger(button);
}

/** A short tick for presses, drags and edges (Android; iOS gets its haptics from attachHaptics). */
export function tick(duration = 8) {
    navigator.vibrate?.(duration);
}
