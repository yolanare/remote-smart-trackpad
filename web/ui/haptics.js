import { hapticTrigger } from 'ios-haptics';

// Haptic feedback on the phone, only where native controls give one:
// - keys, on touch down, like a phone keyboard;
// - controls whose value changes (option toggles, color scheme, steppers, hold clicks), once it changed;
// - trackpad signals: a drag starting, an edge zone reached.
// Buttons that only open, close, dismiss or navigate (menus, backdrop, dialogs, links, reload) stay silent.
//
// - iOS Safari has no vibration API. ios-haptics (https://github.com/tijnjh/ios-haptics) lays a transparent native
//   switch over an element; the user's own tap toggles it and Safari answers with its switch haptic. It only works
//   from a real tap, so it goes on the buttons listed below (option rows toggle natively and are left out).
// - Android and others: the Vibration API through tick(), called where the action happens.
const iosTargets = 'key-rows button, .mouse-hold, .stepper button';

/** Adds iOS tap haptics to the eligible buttons under root; safe to call again after re-rendering. */
export function attachHaptics(root) {
    for (const button of root.querySelectorAll(iosTargets)) hapticTrigger(button);
}

/** A short tick (Android; iOS gets its haptics from attachHaptics). */
export function tick(duration = 8) {
    navigator.vibrate?.(duration);
}
