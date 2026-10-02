import { nextReplacementStep, replacementFor } from '../text-operations.js';

export function createMirror(send, render) {
    // reading: open, the PC's field not read yet (nothing is known about it, so nothing is reported missing either).
    let state = { open: false, reading: false, available: false, text: '', selectionStart: 0, selectionEnd: 0 };
    let confirmed = null,
        busy = false,
        composing = false,
        dirty = false,
        retried = false,
        generation = 0,
        // When the PC last took typing: a focus change soon after comes from that typing (a code's next box).
        typedAt = -Infinity;
    const typingMovesFocus = 1500;
    /** A replay without key presses: the typing only (see replay). */
    const typingOnly = (before, now, target) => {
        const { backspaces, ...typed } = replay(before, now, target) || {};
        return 'text' in typed ? typed : null;
    };
    const publish = () => render({ ...state });
    // Nothing is known of the field: no text from an earlier one may show (typing blind would add to it).
    const unknown = { text: '', selectionStart: 0, selectionEnd: 0 };
    /** Takes the PC's state; pending: local typing still to send on top of it (see replay). */
    function adopt(snapshot, pending = null) {
        confirmed = snapshot;
        dirty = pending !== null;
        retried = false;
        state = {
            ...state,
            ...snapshot,
            reading: false,
            error: '',
            text: snapshot.text || '',
            selectionStart: snapshot.selectionStart || 0,
            selectionEnd: snapshot.selectionEnd || 0,
            ...pending,
        };
        publish();
    }
    /**
     * The typing that turned `before` into `now` (text and caret), replayed at the caret of `target`, as the keyboard
     * would have typed it there: the characters removed before the caret and those inserted. Null when there is none,
     * or the change is not typing that ends at the caret (an autocorrection of an earlier word). `backspaces`: how many
     * of the removed characters reach past the start of the field (Backspace in an empty field).
     */
    function replay(before, now, target) {
        if (!target.available || now.text === before) return null;
        const change = replacementFor(before, now.text, now.selectionStart);
        if (change.start + change.text.length !== now.selectionStart) return null;
        const removed = change.end - change.start;
        // A selection on the PC (a completion) goes first, like typing over it.
        const selected = target.selectionEnd > target.selectionStart;
        const from = Math.max(0, target.selectionStart - (selected ? Math.max(0, removed - 1) : removed));
        const caret = from + change.text.length;
        return {
            text: target.text.slice(0, from) + change.text + target.text.slice(target.selectionEnd),
            selectionStart: caret,
            selectionEnd: caret,
            backspaces: selected ? 0 : Math.max(0, removed - target.selectionStart),
        };
    }
    /**
     * Typing over the PC's selection (a completion an address bar selected) replaces that selection, typed there as a
     * keyboard would, so the field completes again: not a deletion of what follows the common start.
     */
    function typedOverSelection(pc, local) {
        const { selectionStart: start, selectionEnd: end, text } = pc;
        if (end <= start || local.text === text || local.selectionStart !== local.selectionEnd) return null;
        const head = text.slice(0, start),
            tail = text.slice(end),
            typedEnd = local.text.length - tail.length;
        if (typedEnd < start || local.selectionStart !== typedEnd) return null;
        if (!local.text.startsWith(head) || !local.text.endsWith(tail)) return null;
        const typed = local.text.slice(start, typedEnd);
        if (typed.length > 16_384) return null;
        return { start, end, text: typed, position: typedEnd, resultText: local.text };
    }
    async function flush() {
        if (!state.open || !state.available || busy || composing || !dirty) return;
        const current = generation;
        const local = { ...state };
        const step =
            typedOverSelection(confirmed, local)
            ?? nextReplacementStep(confirmed.text, local.text, local.selectionStart);
        const final = step.resultText === local.text;
        busy = true;
        dirty = false;
        try {
            const result = await send('mirror-edit', {
                session: confirmed.session,
                revision: confirmed.revision,
                operationId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                start: step.start,
                end: step.end,
                text: step.text,
                selectionStart: final ? local.selectionStart : step.position,
                selectionEnd: final ? local.selectionEnd : step.position,
            });
            if (current !== generation) return;
            const movedOn = result.snapshot.session !== confirmed.session;
            const moved = movedOn || result.snapshot.text !== confirmed.text;
            const followsTyping = performance.now() - typedAt < typingMovesFocus;
            if (result.typed || (result.accepted && step.text !== confirmed.text.slice(step.start, step.end)))
                typedAt = performance.now();
            if (!result.accepted && !result.typed && !moved && !retried) {
                // Rejected for a newer revision only (the PC moved its caret, the text is as it was): the typing
                // still applies, so it is sent again against that revision instead of being dropped.
                retried = true;
                confirmed = result.snapshot;
                dirty = true;
            } else if (!result.accepted || result.snapshot.session !== confirmed.session) {
                // Typed, but the field made something else of it (an input mask, a case change, a completion, the
                // focus moving on): its text wins, and what was typed on the phone meanwhile follows at its caret.
                // Not typed because the focus had already moved on, right after typing (the field moved it): the
                // typing goes where the focus went, as on a keyboard. Moved on otherwise (the user went elsewhere):
                // it is dropped.
                const since =
                    result.typed ? local.text
                    : movedOn && followsTyping ? confirmed.text
                    : null;
                const { backspaces = 0, ...pending } =
                    (since !== null && final && replay(since, state, result.snapshot)) || {};
                // Only in another field: within the same one, an erasure the PC's text cannot hold is no key to press.
                if (!backspaces || result.snapshot.session === confirmed.session)
                    adopt(result.snapshot, 'text' in pending ? pending : null);
                else {
                    // Erased past the start of the field typing reached (a code's next box): Backspace goes to the
                    // PC as a key, which such fields answer themselves (back to the previous box), then it is reread.
                    const before = state.text;
                    for (let count = 0; count < backspaces; count++)
                        await send('shortcut', { key: 'Backspace', modifiers: [] });
                    typedAt = performance.now();
                    const snapshot = await send('mirror-read', {});
                    if (current !== generation) return;
                    // What was typed meanwhile follows in the field the keys led to.
                    adopt(snapshot, typingOnly(before, state, snapshot));
                }
            } else {
                retried = false;
                confirmed = result.snapshot;
                // The phone's caret stays where it is: the PC can report its own late (Chromium), and a caret the
                // keyboard is moving would jump back. Every edit places the PC's caret where the phone's is anyway.
                if (!dirty && final && confirmed.text === local.text)
                    adopt({ ...confirmed, selectionStart: local.selectionStart, selectionEnd: local.selectionEnd });
                else if (!dirty && final) adopt(confirmed);
                else dirty = true;
            }
        } catch (error) {
            if (current !== generation) return;
            state = { ...state, ...unknown, available: false, error: error.message };
            dirty = false;
            // Forget the confirmed snapshot so the next poll rereads the PC instead of hearing "unchanged".
            confirmed = null;
            publish();
        } finally {
            if (current === generation) {
                busy = false;
                flush();
            }
        }
    }
    // Never while local typing waits to be sent (an IME composition included): the PC's state would replace it.
    async function poll() {
        if (!state.open || busy || dirty) return;
        const current = generation;
        busy = true;
        try {
            const snapshot = await send('mirror-read', { session: confirmed?.session, revision: confirmed?.revision });
            if (current !== generation) return;
            if (snapshot.unchanged) return;
            if (
                !confirmed
                || snapshot.session !== confirmed.session
                || snapshot.revision !== confirmed.revision
                || snapshot.available !== confirmed.available
                || snapshot.field !== confirmed.field
            )
                adopt(snapshot);
        } catch (error) {
            if (current === generation) {
                state = { ...state, ...unknown, available: false, reading: false, error: error.message };
                confirmed = null;
                publish();
            }
        } finally {
            if (current === generation) {
                busy = false;
                flush();
            }
        }
    }
    return {
        open() {
            generation++;
            busy = false;
            dirty = false;
            confirmed = null;
            // A fresh start: an error from before (a disconnection) no longer applies.
            state = { ...state, ...unknown, open: true, reading: true, error: '' };
            publish();
            return poll();
        },
        close() {
            generation++;
            busy = false;
            dirty = false;
            composing = false;
            state.open = false;
            state.reading = false;
            state.available = false;
            publish();
            send('mirror-close').catch(() => {});
        },
        /**
         * The phone's text and caret after typing. `previous`: the text it typed over. When the PC's text replaced
         * it meanwhile (it arrived during an IME composition, which the editor does not interrupt), only the typing
         * applies, at the PC's caret: the phone's stale text never overwrites the PC's.
         */
        input(text, selectionStart, selectionEnd, previous = state.text) {
            if (!state.available) return;
            const { backspaces, ...replayed } =
                (previous !== state.text && replay(previous, { text, selectionStart }, state)) || {};
            state = { ...state, ...('text' in replayed ? replayed : { text, selectionStart, selectionEnd }) };
            dirty = true;
            if ('text' in replayed) publish();
            flush();
        },
        compose(value) {
            composing = value;
            if (!value) flush();
        },
        poll,
        disconnected() {
            generation++;
            busy = false;
            dirty = false;
            confirmed = null;
            state = { ...state, ...unknown, available: false, reading: false, error: 'PC disconnected' };
            publish();
        },
    };
}
