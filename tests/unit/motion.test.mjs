import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerGain, wheelStep } from '../../web/logic/motion.js';

test('pointer acceleration damps slow strokes, amplifies fast ones and can be disabled', () => {
    assert.equal(pointerGain(3, 0), 1);
    assert.ok(pointerGain(0.05, 1) < 1, 'slow strokes gain precision');
    assert.ok(pointerGain(3, 1) > 2, 'fast flicks travel further');
    assert.ok(pointerGain(0.4, 1) < pointerGain(0.8, 1), 'gain rises with speed');
    assert.ok(pointerGain(0.05, 2) > 0 && pointerGain(0.05, 2) < pointerGain(0.05, 1), 'stronger stays positive');
});

// VS Code's MouseWheelClassifier (src/vs/base/browser/ui/scrollbar/scrollableElement.ts): its lists animate what
// looks like a mouse wheel and follow a touchpad at once. Fed DOM deltas; true while it believes in a mouse wheel.
function wheelClassifier() {
    const items = [];
    const almostInt = (value) => Math.abs(Math.round(value) - value) < 0.01 + Number.EPSILON * 100;
    return (delta) => {
        let score = almostInt(delta) ? 0.5 : 0.75;
        const previous = items.at(-1)?.delta;
        if (previous !== undefined) {
            const min = Math.max(Math.min(Math.abs(delta), Math.abs(previous)), 1),
                max = Math.max(Math.abs(delta), Math.abs(previous));
            if (max % min === 0) score -= 0.5;
        }
        items.push({ delta, score: Math.min(Math.max(score, 0), 1) });
        const recent = items.slice(-5).reverse();
        let remaining = 1,
            total = 0;
        recent.forEach((item, index) => {
            const influence = index === recent.length - 1 ? remaining : 2 ** -(index + 1);
            remaining -= influence;
            total += item.score * influence;
        });
        return total <= 0.5;
    };
}

// A finger on a rail, frame by frame: slow, speeding up, fast and steady, slowing down (wheel units per frame).
const stroke = [
    ...Array.from({ length: 40 }, (_, frame) => 0.6 + frame * 0.05),
    ...Array.from({ length: 40 }, (_, frame) => 2.6 + frame * 0.6),
    ...Array.from({ length: 60 }, (_, frame) => 26 + 4 * Math.sin(frame / 3)),
    ...Array.from({ length: 40 }, (_, frame) => 26 - frame * 0.6),
];

function sendStroke(step) {
    let queued = 0,
        previous = 0;
    const sent = [];
    for (const amount of stroke) {
        queued += amount;
        // One frame's flush: as many amounts as fit, as motion.js does.
        for (let size = step(queued, previous); size; size = step(queued, previous)) {
            queued -= size;
            previous = Math.abs(size);
            sent.push(size);
        }
    }
    return { sent, left: queued };
}

test('scroll amounts never look like a mouse wheel to apps that tell one from a touchpad', () => {
    // Chrome turns a wheel amount into pixels: amount / 120 notch × lines per notch × 100/3 (float32), so 10/9 px a
    // unit with 4 lines (measured on Windows), 5/6 with 3 lines or 3 characters sideways.
    for (const lines of [3, 4]) {
        const pixels = (amount) => Math.fround((amount / 120) * lines * (100 / 3));
        const looksLikeWheel = (sent) => {
            const classify = wheelClassifier();
            return sent.map((amount) => classify(pixels(amount))).filter(Boolean).length;
        };
        // What every frame's whole units used to send: VS Code flipped between animating and following.
        const before = sendStroke((queued) => Math.trunc(queued));
        assert.ok(looksLikeWheel(before.sent) > 10, 'the old stream fooled the classifier ' + lines);
        const after = sendStroke(wheelStep);
        assert.equal(looksLikeWheel(after.sent), 0, 'lines ' + lines + ': ' + after.sent.join(' '));
        assert.ok(after.left < 9, 'only a few units wait: ' + after.left);
        assert.ok(after.sent.every((amount) => amount >= 2));
    }
    assert.equal(wheelStep(-7.5, 0), -7, 'scrolls the other way too');
    assert.equal(wheelStep(1.9, 0), 0, 'a single unit waits for more');
});
