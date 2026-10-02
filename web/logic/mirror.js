import { nextReplacementStep } from '../text-operations.js';

export function createMirror(send, render) {
    // reading: open, the PC's field not read yet (nothing is known about it, so nothing is reported missing either).
    let state = { open: false, reading: false, available: false, text: '', selectionStart: 0, selectionEnd: 0 };
    let confirmed = null,
        busy = false,
        composing = false,
        dirty = false,
        retried = false,
        generation = 0;
    const publish = () => render({ ...state });
    function adopt(snapshot) {
        confirmed = snapshot;
        composing = false;
        dirty = false;
        retried = false;
        state = {
            ...state,
            ...snapshot,
            reading: false,
            error: '',
            text: snapshot.text || '',
            selectionStart: snapshot.selectionStart || 0,
            selectionEnd: snapshot.selectionEnd || 0,
        };
        publish();
    }
    async function flush() {
        if (!state.open || !state.available || busy || composing || !dirty) return;
        const current = generation;
        const local = { ...state };
        const step = nextReplacementStep(confirmed.text, local.text, local.selectionStart);
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
            const moved = result.snapshot.session !== confirmed.session || result.snapshot.text !== confirmed.text;
            if (!result.accepted && !moved && !retried) {
                // Rejected for a newer revision only (the PC moved its caret, the text is as it was): the typing
                // still applies, so it is sent again against that revision instead of being dropped.
                retried = true;
                confirmed = result.snapshot;
                dirty = true;
            } else if (!result.accepted || result.snapshot.session !== confirmed.session) adopt(result.snapshot);
            else {
                retried = false;
                confirmed = result.snapshot;
                if (!dirty && final) adopt(confirmed);
                else dirty = true;
            }
        } catch (error) {
            if (current !== generation) return;
            state.available = false;
            state.error = error.message;
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
                state.available = false;
                state.reading = false;
                state.error = error.message;
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
            state.open = true;
            state.reading = true;
            // A fresh start: an error from before (a disconnection) no longer applies.
            state.error = '';
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
        input(text, selectionStart, selectionEnd) {
            if (!state.available) return;
            state = { ...state, text, selectionStart, selectionEnd };
            dirty = true;
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
            state.available = false;
            state.reading = false;
            state.error = 'PC disconnected';
            publish();
        },
    };
}
