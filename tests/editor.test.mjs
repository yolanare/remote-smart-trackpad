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
test('IME holds uncommitted input and a changed field invalidates composition', async () => {
    const h = harness();
    h.mirror.open();
    await h.reply(snapshot('Original'));
    h.mirror.compose(true);
    h.mirror.input('Uncommitted', 11, 11);
    assert.equal(h.requests.length, 0);
    h.mirror.poll();
    await h.reply(snapshot('New field', 'field-b'));
    h.mirror.compose(false);
    assert.equal(h.requests.length, 0);
    assert.equal(h.changes.at(-1).text, 'New field');
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
