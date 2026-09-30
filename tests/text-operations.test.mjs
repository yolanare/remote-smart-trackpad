import test from 'node:test';
import assert from 'node:assert/strict';
import { replacementFor, nextReplacementStep } from '../web/text-operations.js';

function verify(previous, current, position = current.length) {
    const change = replacementFor(previous, current, position);
    assert.equal(previous.slice(0, change.start) + change.text + previous.slice(change.end), current);
    assert.equal(change.position, position);
    return change;
}

test('small typing and autocorrection transmit only the changed span', () => {
    assert.deepEqual(verify('bonjour', 'bonjours'), { start: 7, end: 7, text: 's', position: 8 });
    assert.deepEqual(verify('bonjor', 'bonjour'), { start: 5, end: 5, text: 'u', position: 7 });
    const correction = verify('très long', 'très court');
    assert.equal(correction.start, 5);
    assert.equal(correction.text, 'court');
});

test('emoji and combining marks stay within whole text elements', () => {
    const emoji = verify('A👩‍💻B', 'A👩‍🚀B', 6);
    assert.equal(emoji.start, 1);
    assert.equal(emoji.end, 'A👩‍💻'.length);
    const accent = verify('é!', 'é!');
    assert.equal(accent.start, 0);
    assert.equal(accent.end, 2);
});

test('an insertion in a one-megabyte buffer stays a small operation', () => {
    const previous = 'a'.repeat(1024 * 1024);
    const change = verify(previous, previous + 'é');
    assert.deepEqual(change, {
        start: previous.length,
        end: previous.length,
        text: 'é',
        position: previous.length + 1,
    });
});

test('a large committed paste is split into whole-character operations', () => {
    const target = 'A' + '👩‍💻'.repeat(5000) + 'Z';
    let applied = 'AZ';
    let steps = 0;
    while (applied !== target) {
        const step = nextReplacementStep(applied, target, target.length, 16_384);
        assert.ok(step.text.length <= 16_384);
        assert.equal(applied.slice(0, step.start) + step.text + applied.slice(step.end), step.resultText);
        assert.notEqual(step.resultText, applied);
        applied = step.resultText;
        steps++;
        assert.ok(steps < 10);
    }
    assert.equal(applied, target);
});
test('a new line typed next to another is placed at the caret', () => {
    assert.deepEqual(replacementFor('abc\n', 'abc\n\n', 4), { start: 3, end: 3, text: '\n', position: 4 });
    assert.deepEqual(replacementFor('abc\n\n', 'abc\n', 3), { start: 3, end: 4, text: '', position: 3 });
    assert.deepEqual(replacementFor('aa', 'aaa', 1), { start: 0, end: 0, text: 'a', position: 1 });
});
