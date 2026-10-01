import test from 'node:test';
import assert from 'node:assert/strict';
import { createMirror } from '../web/logic/mirror.js';

const snapshot = (text, session = 'field-a', revision = 0) => ({
    available: true,
    session,
    revision,
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
});
function harness() {
    const requests = [],
        changes = [];
    const mirror = createMirror(
        (action, data) => new Promise((resolve, reject) => requests.push({ action, data, resolve, reject })),
        (state) => changes.push(state)
    );
    return {
        mirror,
        requests,
        changes,
        async reply(value) {
            requests.shift().resolve(value);
            await new Promise((resolve) => setImmediate(resolve));
        },
    };
}
test('opening mirrors the complete field; PC focus changes replace it without closing', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('Existing PC text'));
    assert.equal(h.changes.at(-1).text, 'Existing PC text');
    h.mirror.poll();
    await h.reply(snapshot('Other field', 'field-b'));
    assert.equal(h.changes.at(-1).text, 'Other field');
    assert.equal(h.changes.at(-1).open, true);
});
test('IME holds uncommitted input; a field changed meanwhile rejects it without replaying it', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('Original'));
    h.mirror.compose(true);
    h.mirror.input('Uncommitted', 11, 11);
    assert.equal(h.requests.length, 0);
    // No reading while the composition waits: the PC's state would replace what is being typed.
    h.mirror.poll();
    assert.equal(h.requests.length, 0);
    h.mirror.compose(false);
    assert.equal(h.requests[0].action, 'mirror-edit');
    await h.reply({ accepted: false, snapshot: snapshot('New field', 'field-b') });
    assert.equal(h.changes.at(-1).text, 'New field');
    assert.equal(h.requests.length, 0);
});
test('fast typing survives the PC moving on: no read while typing waits, a stale revision is retried', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('Hi'));
    h.mirror.input('Hi t', 4, 4);
    const first = h.requests.shift();
    // More typing while the first edit is on its way; a poll would read the PC and lose it.
    h.mirror.input('Hi the', 6, 6);
    h.mirror.poll();
    assert.equal(h.requests.length, 0);
    // The PC only moved its caret (new revision, same text): the edit is sent again, nothing typed is dropped.
    first.resolve({
        accepted: false,
        snapshot: { ...snapshot('Hi', 'field-a', 1), selectionStart: 0, selectionEnd: 0 },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.requests[0].data.revision, 1);
    assert.equal(h.requests[0].data.text, ' the');
    await h.reply({ accepted: true, snapshot: snapshot('Hi the', 'field-a', 2) });
    assert.equal(h.changes.at(-1).text, 'Hi the');
});
test('stale rejected edits use the authoritative snapshot and never replay old typing', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('Old'));
    h.mirror.input('Old typing', 10, 10);
    assert.equal(h.requests[0].data.session, 'field-a');
    await h.reply({ accepted: false, snapshot: snapshot('New', 'field-b') });
    assert.equal(h.changes.at(-1).text, 'New');
    assert.equal(h.requests.length, 0);
});
test('close ignores late replies; reconnect rereads PC state without replaying text', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('Before'));
    h.mirror.input('Pending', 7, 7);
    h.mirror.disconnected();
    await h.reply({ accepted: true, snapshot: snapshot('Pending', 'field-a', 1) });
    h.mirror.poll();
    await h.reply(snapshot('After reconnect', 'field-b'));
    assert.equal(h.changes.at(-1).text, 'After reconnect');
    h.mirror.poll();
    h.mirror.close();
    await h.reply(snapshot('Late'));
    assert.equal(h.changes.at(-1).open, false);
});
test('unavailable fields clear the mirror but keep the editor open', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('Private text'));
    h.mirror.poll();
    await h.reply({ available: false, text: '' });
    assert.equal(h.changes.at(-1).text, '');
    assert.equal(h.changes.at(-1).open, true);
    assert.equal(h.changes.at(-1).available, false);
});
test('a failed edit rereads the PC so typing resumes without refocusing', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('ab\n\nc'));
    h.mirror.input('ab\n\n', 4, 4);
    h.requests.shift().reject(new Error('PC text range differs'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.changes.at(-1).available, false);
    h.mirror.poll();
    assert.equal(h.requests[0].data.session, undefined, 'the poll must not ask for "unchanged"');
    await h.reply(snapshot('ab\n\nc'));
    assert.equal(h.changes.at(-1).available, true);
});
