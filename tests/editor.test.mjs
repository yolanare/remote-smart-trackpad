import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { nextReplacementStep } from '../web/text-operations.js';

const source = (await readFile(new URL('../web/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/, '');
const stateKey = 'remote-smart-trackpad-editor-state';
const draftKey = 'remote-smart-trackpad-draft';

function editorHarness(saved = {}) {
  const elements = new Map();
  function element() {
    const handlers = new Map();
    const classes = new Set();
    return {
      value: '', selectionStart: 0, textContent: '', dataset: {}, lastElementChild: {}, children: [],
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle() {}, contains: name => classes.has(name) },
      addEventListener(name, callback) { handlers.set(name, callback); },
      fire(name, event = {}) { return handlers.get(name)?.({ preventDefault() {}, ...event }); },
      setPointerCapture() {},
      append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; }, setAttribute() {}, focus() {}
    };
  }
  const find = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const storage = new Map(Object.entries({ 'remote-smart-trackpad-token': 'paired', ...saved }));
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const requests = [];
  const intervals = new Map();
  const timers = new Map();
  const frames = new Map();
  let timerId = 0;
  let socket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { socket = this; }
    send(json) { requests.push(JSON.parse(json)); }
  }
  runInNewContext(source, {
    nextReplacementStep, document: { querySelector: find, querySelectorAll: () => [], createElement: element, addEventListener() {} },
    window: { addEventListener() {} }, localStorage,
    sessionStorage: { getItem: () => null }, WebSocket: Socket,
    location: { protocol: 'http:', host: '192.168.1.10:8765' },
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    navigator: {}, performance,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame(callback) { const id = ++timerId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setInterval: (callback, delay) => intervals.set(delay, callback), confirm: () => false
  });
  socket.onopen();
  return {
    find, storage, requests,
    key(label) { return find('#key-grid').children.find(button => button.textContent === label).fire('click'); },
    fireTimers(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } },
    frame() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    observe: () => intervals.get(750)(),
    disconnect() { socket.readyState = 3; return socket.onclose(); },
    reconnectTransport() { socket.readyState = 1; socket.onopen(); },
    async reply(action, result) {
      const request = requests.findLast(request => request.action === action);
      assert.ok(request, 'Expected command: ' + action);
      socket.onmessage({ data: JSON.stringify({ id: request.id, ok: true, result }) });
      await new Promise(resolve => setImmediate(resolve));
    },
    async reject(action, code) {
      const request = requests.findLast(request => request.action === action);
      socket.onmessage({ data: JSON.stringify({ id: request.id, ok: false, code, error: code }) });
      await new Promise(resolve => setImmediate(resolve));
    },
    async open(text = '') {
      const opening = find('#editor-open').fire('click');
      await this.reply('open', { text, session: 'session', mode: text ? 'selection' : 'insertion' });
      await opening;
    },
    type(text) {
      find('#editor-text').value = text;
      find('#editor-text').selectionStart = text.length;
      find('#editor-text').fire('input');
    }
  };
}

test('HTTP phone sends committed text and retains a recoverable copy after acknowledgement', async () => {
  const phone = editorHarness();
  await phone.open();
  phone.type('Bonjour');
  const edit = phone.requests.find(request => request.action === 'edit');
  assert.ok(edit, 'Typing on HTTP must send an edit');
  assert.equal(edit.data.text, 'Bonjour');
  assert.ok(edit.data.operationId.length >= 32);
  await phone.reply('edit', { position: 7 });
  const persisted = JSON.parse(phone.storage.get(stateKey));
  assert.equal(persisted.confirmed, 'Bonjour');
});

test('composition is not transmitted until it is committed', async () => {
  const phone = editorHarness();
  await phone.open();
  phone.find('#editor-text').fire('compositionstart');
  phone.type('bonj');
  assert.equal(phone.requests.filter(request => request.action === 'edit').length, 0);
  phone.type('bonjour');
  phone.find('#editor-text').fire('compositionend');
  assert.equal(phone.requests.filter(request => request.action === 'edit').length, 1);
  assert.equal(phone.requests.find(request => request.action === 'edit').data.text, 'bonjour');
});

test('typing while the PC opens a session is retained when the response arrives', async () => {
  const phone = editorHarness();
  const opening = phone.find('#editor-open').fire('click');
  phone.type('mobile draft');
  await phone.reply('open', { text: 'PC selection', session: 'session', mode: 'selection' });
  await opening;
  assert.equal(phone.find('#editor-text').value, 'mobile draft');
  assert.equal(phone.storage.get(draftKey), 'mobile draft');
  assert.equal(phone.requests.filter(request => request.action === 'edit').length, 0);
});

test('reloading an acknowledged session restores its text without sending a deletion', async () => {
  const phone = editorHarness({ [stateKey]: JSON.stringify({ session: 'session', outstanding: null }) });
  const opening = phone.find('#editor-open').fire('click');
  await phone.reply('inspect', { state: 'not-applied', text: 'Bonjour' });
  await opening;
  assert.equal(phone.find('#editor-text').value, 'Bonjour');
  assert.equal(phone.requests.filter(request => request.action === 'edit').length, 0);
});

test('server restart leaves the confirmed mobile text available for recovery', async () => {
  const phone = editorHarness({ [stateKey]: JSON.stringify({ session: 'old-session', confirmed: 'Bonjour', outstanding: null }) });
  const opening = phone.find('#editor-open').fire('click');
  await phone.reject('inspect', 'session_gone');
  await opening;
  assert.equal(phone.find('#editor-text').value, 'Bonjour');
  assert.equal(phone.requests.filter(request => request.action === 'edit').length, 0);
  await phone.find('#editor-close').fire('click');
  assert.equal(JSON.parse(phone.storage.get(stateKey)).confirmed, 'Bonjour');
});

test('PC selection notification cannot replace a composition started while observing', async () => {
  const phone = editorHarness();
  await phone.open('Bonjour');
  const observation = phone.observe();
  phone.find('#editor-text').fire('compositionstart');
  await phone.reply('observe', { state: 'selection-changed', text: 'PC selection' });
  await observation;
  assert.equal(phone.requests.filter(request => request.action === 'open').length, 1);
  assert.equal(phone.find('#editor-text').value, 'Bonjour');
  assert.equal(phone.storage.get(draftKey), 'Bonjour');
});

test('closing during recovery does not replay an unapplied operation in the background', async () => {
  const phone = editorHarness({
    [stateKey]: JSON.stringify({ session: 'session', confirmed: '', outstanding: { operationId: 'pending', start: 0, end: 0, text: 'Bonjour', position: 7 } }),
    [draftKey]: 'Bonjour'
  });
  const opening = phone.find('#editor-open').fire('click');
  await phone.find('#editor-close').fire('click');
  await phone.reply('inspect', { state: 'not-applied', text: '' });
  assert.equal(phone.requests.filter(request => request.action === 'edit').length, 0);
  await opening;
  assert.equal(phone.storage.get(draftKey), 'Bonjour');
});

test('closing suspends text commands immediately while the PC close is pending', async () => {
  const phone = editorHarness();
  await phone.open('Bonjour');
  const closing = phone.find('#editor-close').fire('click');
  phone.type('Bonjour encore');
  assert.equal(phone.requests.filter(request => request.action === 'edit').length, 0);
  await phone.reply('close', null);
  await closing;
  assert.equal(phone.storage.get(draftKey), 'Bonjour encore');
});

test('a late observation error cannot recreate a draft after a confirmed close', async () => {
  const phone = editorHarness();
  await phone.open('Bonjour');
  const observation = phone.observe();
  const closing = phone.find('#editor-close').fire('click');
  await phone.reply('close', null);
  await closing;
  await phone.reject('observe', 'session_gone');
  await observation;
  assert.equal(phone.storage.has(draftKey), false);
  assert.equal(phone.storage.has(stateKey), false);
});

test('an unconfirmed close keeps the last acknowledged text recoverable', async () => {
  const phone = editorHarness();
  await phone.open('Bonjour');
  const closing = phone.find('#editor-close').fire('click');
  await phone.reject('close', 'connection_lost');
  await closing;
  assert.equal(JSON.parse(phone.storage.get(stateKey)).confirmed, 'Bonjour');
});

for (const state of ['applied', 'not-applied']) {
  test('recovery resolves an operation with a lost acknowledgement: ' + state, async () => {
    const operation = { operationId: 'pending-operation', start: 3, end: 3, text: 'jour', position: 7 };
    const phone = editorHarness({
      [stateKey]: JSON.stringify({ session: 'session', confirmed: 'Bon', outstanding: operation }),
      [draftKey]: 'Bonjour'
    });
    const opening = phone.find('#editor-open').fire('click');
    await phone.reply('inspect', { state, text: state === 'applied' ? 'Bonjour' : 'Bon' });
    const edits = phone.requests.filter(request => request.action === 'edit');
    assert.equal(edits.length, state === 'applied' ? 0 : 1);
    if (state === 'not-applied') {
      assert.deepEqual(edits[0].data, { session: 'session', ...operation });
      await phone.reply('edit', { position: 7 });
    }
    await opening;
    assert.equal(phone.find('#editor-text').value, 'Bonjour');
    assert.equal(JSON.parse(phone.storage.get(stateKey)).confirmed, 'Bonjour');
    assert.equal(phone.storage.has(draftKey), false);
  });
}

test('cancelling one finger cancels the entire gesture without a right click', async () => {
  const phone = editorHarness();
  const pad = phone.find('#trackpad');
  pad.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  pad.fire('pointerdown', { pointerId: 2, clientX: 10, clientY: 0 });
  await pad.fire('pointercancel', { pointerId: 1 });
  await pad.fire('pointerup', { pointerId: 2 });
  phone.fireTimers(320);
  assert.equal(phone.requests.filter(request => request.action === 'click').length, 0);
});

test('lifting one scrolling finger does not turn the remaining finger into pointer movement', async () => {
  const phone = editorHarness();
  const pad = phone.find('#trackpad');
  pad.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  pad.fire('pointerdown', { pointerId: 2, clientX: 10, clientY: 0 });
  pad.fire('pointermove', { pointerId: 1, clientX: 0, clientY: 20 });
  await pad.fire('pointerup', { pointerId: 1 });
  pad.fire('pointermove', { pointerId: 2, clientX: 10, clientY: 30 });
  phone.frame();
  assert.equal(phone.requests.filter(request => request.action === 'move').length, 0);
  assert.equal(phone.requests.filter(request => request.action === 'scroll').length, 1);
});

test('drag sends its last movement before releasing the mouse button', async () => {
  const phone = editorHarness();
  const pad = phone.find('#trackpad');
  pad.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  phone.fireTimers(420);
  pad.fire('pointermove', { pointerId: 1, clientX: 20, clientY: 0 });
  const lifting = pad.fire('pointerup', { pointerId: 1 });
  phone.frame();
  await phone.reply('move', null);
  await lifting;
  assert.deepEqual(phone.requests.map(request => [request.action, request.data.down]), [['button', true], ['move', undefined], ['button', false]]);
});

test('lost pointer capture releases a drag and drops queued movement', () => {
  const phone = editorHarness();
  const pad = phone.find('#trackpad');
  pad.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  phone.fireTimers(420);
  pad.fire('pointermove', { pointerId: 1, clientX: 20, clientY: 0 });
  pad.fire('lostpointercapture', { pointerId: 1 });
  phone.frame();
  assert.deepEqual(phone.requests.map(request => request.action), ['button', 'release']);
});

test('disconnection cancels a pending long press before the connection returns', async () => {
  const phone = editorHarness();
  phone.find('#trackpad').fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  await phone.disconnect();
  phone.reconnectTransport();
  phone.fireTimers(420);
  assert.equal(phone.requests.filter(request => request.action === 'button').length, 0);
});

test('an armed modifier applies only to the next key even before acknowledgement', async () => {
  const phone = editorHarness();
  await phone.key('Ctrl');
  phone.key('Tab');
  phone.key('Enter');
  assert.deepEqual(phone.requests.map(request => ({ action: request.action, data: request.data })), [
    { action: 'shortcut', data: { key: 'Tab', modifiers: ['Control'] } },
    { action: 'shortcut', data: { key: 'Enter', modifiers: [] } }
  ]);
});

test('a locked modifier applies to consecutive shortcuts until explicitly unlocked', async () => {
  const phone = editorHarness();
  await phone.key('Ctrl');
  await phone.key('Ctrl');
  phone.key('Tab');
  phone.key('Enter');
  await phone.key('Ctrl');
  phone.key('Tab');
  assert.deepEqual(phone.requests.map(request => request.data.modifiers), [['Control'], ['Control'], []]);
});
