import test from 'node:test';
import assert from 'node:assert/strict';
import { createOptions } from '../web/logic/options.js';

const schema = {
    mouseSpeed: { default: 2, valid: (value) => Number.isFinite(value) && value >= 0.25 && value <= 16 },
    navButtons: { default: true, valid: (value) => typeof value === 'boolean' },
    colorScheme: { default: 'auto', valid: (value) => ['auto', 'dark', 'light'].includes(value) },
};
function memory(stored) {
    const storage = {
        stored,
        load: () => storage.stored,
        save: (values) => (storage.stored = { ...values }),
        clear: () => (storage.stored = undefined),
    };
    return storage;
}

test('stored values override the defaults; invalid ones and old options are dropped', () => {
    const storage = memory({ mouseSpeed: 4, navButtons: 'yes', tapScrollX: true });
    const options = createOptions(schema, storage);
    assert.deepEqual(options.values, { mouseSpeed: 4, navButtons: true, colorScheme: 'auto' });
    assert.equal('tapScrollX' in storage.stored, false, 'a removed option is forgotten');
});

test('set validates, remembers and tells listeners what changed', () => {
    const storage = memory(undefined);
    const options = createOptions(schema, storage);
    const heard = [];
    options.onChange((names) => heard.push([...names, options.values[names[0]]]));
    options.set('mouseSpeed', 99);
    options.set('mouseSpeed', 2);
    options.set('colorScheme', 'dark');
    assert.deepEqual(heard, [['colorScheme', 'dark']], 'invalid and unchanged values change nothing');
    assert.equal(storage.stored.colorScheme, 'dark');
});

test('reset brings every option back and forgets the stored ones', () => {
    const storage = memory({ mouseSpeed: 8, colorScheme: 'light' });
    const options = createOptions(schema, storage);
    const heard = [];
    options.onChange((names) => heard.push(names));
    options.reset();
    assert.deepEqual(options.values, { mouseSpeed: 2, navButtons: true, colorScheme: 'auto' });
    assert.deepEqual(heard, [['mouseSpeed', 'colorScheme']]);
    assert.equal(storage.stored, undefined);
});

test('a storage that throws (private browsing) only loses the memory', () => {
    const failing = {
        load: () => {
            throw new Error('denied');
        },
        save: () => {
            throw new Error('denied');
        },
        clear: () => {
            throw new Error('denied');
        },
    };
    const options = createOptions(schema, failing);
    options.set('navButtons', false);
    assert.equal(options.values.navButtons, false);
    options.reset();
    assert.equal(options.values.navButtons, true);
});
