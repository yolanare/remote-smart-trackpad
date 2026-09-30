import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerGain } from '../web/logic/motion.js';

test('pointer acceleration damps slow strokes, amplifies fast ones and can be disabled', () => {
    assert.equal(pointerGain(3, 0), 1);
    assert.ok(pointerGain(0.05, 1) < 1, 'slow strokes gain precision');
    assert.ok(pointerGain(3, 1) > 2, 'fast flicks travel further');
    assert.ok(pointerGain(0.4, 1) < pointerGain(0.8, 1), 'gain rises with speed');
    assert.ok(pointerGain(0.05, 2) > 0 && pointerGain(0.05, 2) < pointerGain(0.05, 1), 'stronger stays positive');
});
