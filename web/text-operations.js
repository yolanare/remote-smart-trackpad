const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function boundaryBefore(text, index) {
    if (index <= 0 || index >= text.length) return index;
    return segmenter.segment(text).containing(index).index;
}

function boundaryAfter(text, index) {
    if (index <= 0 || index >= text.length) return index;
    const previous = segmenter.segment(text).containing(index - 1);
    return previous.index + previous.segment.length;
}

export function replacementFor(previous, current, position) {
    let start = 0;
    while (start < Math.min(previous.length, current.length) && previous[start] === current[start]) start++;
    let suffix = 0;
    while (
        suffix < Math.min(previous.length, current.length) - start
        && previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
    )
        suffix++;
    // With repeated neighbours ("\n" typed after "\n") a pure insertion or deletion could sit at several places; slide
    // it back to the caret so the PC can apply it where its caret already is.
    const inserted = current.length - previous.length;
    if (Number.isInteger(position) && previous.length - suffix === start) {
        while (start > 0 && start + inserted > position && previous[start - 1] === current[start - 1 + inserted]) {
            start--;
            suffix++;
        }
    } else if (Number.isInteger(position) && current.length - suffix === start) {
        while (start > position && previous[start - 1] === previous[previous.length - suffix - 1]) {
            start--;
            suffix++;
        }
    }
    start = Math.min(boundaryBefore(previous, start), boundaryBefore(current, start));
    let end = boundaryAfter(previous, previous.length - suffix);
    let currentEnd = boundaryAfter(current, current.length - suffix);
    if (previous.slice(0, start) !== current.slice(0, start) || previous.slice(end) !== current.slice(currentEnd)) {
        start = 0;
        end = previous.length;
        currentEnd = current.length;
    }
    return { start, end, text: current.slice(start, currentEnd), position };
}

export function nextReplacementStep(previous, current, position, maxInsert = 16_384) {
    const change = replacementFor(previous, current, position);
    if (change.text.length <= maxInsert) return { ...change, resultText: current };
    const chunkEnd = boundaryBefore(change.text, maxInsert);
    if (chunkEnd === 0) throw new Error('A single text element exceeds the insertion limit');
    const text = change.text.slice(0, chunkEnd);
    return {
        start: change.start,
        end: change.end,
        text,
        position: change.start + text.length,
        resultText: previous.slice(0, change.start) + text + previous.slice(change.end),
    };
}
