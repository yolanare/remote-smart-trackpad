// The PC bridge's pure rules (host/windows/mirror-rules.psm1, Select-InsertStrategy in host/windows/input.psm1), run
// in PowerShell through tests/unit/host-rules.ps1 (docs/adr/0002). Facts recorded from real browsers (npm run test:placeholders --
// --record) are replayed from tests/fixtures/field-facts.json.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline';

const windows = process.platform === 'win32';
let rules, waiting;
before(() => {
    if (!windows) return;
    rules = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tests/unit/host-rules.ps1'],
        {
            stdio: ['pipe', 'pipe', 'inherit'],
            windowsHide: true,
        }
    );
    waiting = [];
    readline.createInterface({ input: rules.stdout }).on('line', (line) => waiting.shift()(JSON.parse(line)));
});
after(() => rules?.stdin.end());
/** The rule's answer for these facts. */
async function ask(rule, facts) {
    const answer = await new Promise((resolve) => {
        waiting.push(resolve);
        rules.stdin.write(JSON.stringify({ rule, facts }) + '\n');
    });
    if (!answer.ok) throw new Error(answer.error);
    return answer.result;
}
const verdict = async (facts) => {
    const {
        unreadable,
        empty,
        singleLine = false,
    } = await ask('Get-FieldVerdict', { caret: 0, boxWidth: 300, boxHeight: 30, ...facts });
    return { unreadable, empty, singleLine };
};
const web = (content) => ({
    dom: true,
    native: false,
    valueLength: 0,
    editableText: false,
    editableObject: false,
    leafless: false,
    singleLine: false,
    ...content,
});

test('field verdict: readable, placeholder only, or typed blind', { skip: !windows }, async () => {
    // A Win32 field hiding its content behind its name.
    assert.deepEqual(await verdict({ framework: 'Win32', name: 'Password', text: 'Password', content: null }), {
        unreadable: true,
        empty: false,
        singleLine: false,
    });
    // A classic one-line edit box.
    assert.deepEqual(
        await verdict({ framework: 'WinForm', name: 'textbox', text: 'hi', win32SingleLine: true, content: null }),
        { unreadable: false, empty: false, singleLine: true }
    );
    // Chrome's address bar reads its name when empty.
    const omnibox = { framework: 'Chrome', name: 'Address and search bar', content: { dom: false, singleLine: true } };
    assert.deepEqual(await verdict({ ...omnibox, text: 'Address and search bar' }), {
        unreadable: false,
        empty: true,
        singleLine: true,
    });
    assert.deepEqual(await verdict({ ...omnibox, text: 'hello' }), {
        unreadable: false,
        empty: false,
        singleLine: true,
    });
    // A code editor's hidden input (VS Code): too small to show text.
    assert.deepEqual(
        await verdict({
            framework: 'Chrome',
            name: '',
            text: 'x',
            boxWidth: 1,
            boxHeight: 1,
            content: web({ native: true, valueLength: 1 }),
        }),
        { unreadable: true, empty: true, singleLine: false }
    );
    // VS Code's editor (EditContext): its element reads its accessible name, or a few characters around the caret.
    const editContext = {
        framework: 'Chrome',
        className: 'native-edit-context',
        name: 'The editor is not accessible at this time. To enable screen reader optimized mode, use Shift+Alt+F1',
        content: web({ leafless: true }),
    };
    for (const text of [editContext.name, 'ello world', ''])
        assert.deepEqual(await verdict({ ...editContext, text }), { unreadable: true, empty: true, singleLine: false });
    // An empty <input> reads its placeholder as an embedded object.
    assert.deepEqual(
        await verdict({
            framework: 'Chrome',
            name: 'Search',
            text: '￼',
            content: web({ native: true, singleLine: true }),
        }),
        { unreadable: false, empty: true, singleLine: true }
    );
    // A contenteditable showing only generated text, then with typed text.
    assert.deepEqual(
        await verdict({ framework: 'Chrome', name: '', text: 'Type a message', content: web({ otherText: true }) }),
        { unreadable: false, empty: true, singleLine: false }
    );
    assert.deepEqual(
        await verdict({
            framework: 'Chrome',
            name: '',
            text: 'hello',
            content: web({ editableText: true, singleLine: true }),
        }),
        { unreadable: false, empty: false, singleLine: false }
    );
    // Firefox's role=textbox hides its text nodes: a caret past the start stands after real text.
    const firefox = { framework: 'Gecko', name: '', text: 'hello', content: web({ leafless: true }) };
    assert.deepEqual(await verdict({ ...firefox, caret: 5 }), { unreadable: false, empty: false, singleLine: false });
    assert.deepEqual(await verdict({ ...firefox, caret: 0 }), { unreadable: false, empty: true, singleLine: false });
});

test('field kind: the keyboard a field calls for', { skip: !windows }, async () => {
    const kind = (facts) => ask('Get-FieldKind', facts);
    for (const type of ['email', 'tel', 'url', 'search', 'number'])
        assert.equal(await kind({ content: web({ native: true, inputType: type }) }), type);
    // Types the phone has no keyboard for, no type at all, no IAccessible2: plain text.
    assert.equal(await kind({ content: web({ native: true, inputType: 'date' }) }), 'text');
    assert.equal(await kind({ content: web({ native: true }) }), 'text');
    assert.equal(await kind({ content: null }), 'text');
    // A classic edit box that takes digits only.
    assert.equal(await kind({ content: null, win32Digits: true }), 'digits');
});

test('text repair: what a field reports but nobody typed is taken away', { skip: !windows }, async () => {
    const repair = (facts) => ask('Repair-MirrorText', { native: false, className: '', phantomBreak: false, ...facts });
    assert.deepEqual(await repair({ framework: 'Chrome', text: '\n', start: 1, end: 1 }), {
        text: '',
        start: 0,
        end: 0,
    });
    assert.deepEqual(await repair({ framework: 'Chrome', text: 'a\n', start: 2, end: 2, phantomBreak: true }), {
        text: 'a',
        start: 1,
        end: 1,
    });
    assert.deepEqual(
        await repair({ framework: 'Chrome', text: 'a\n', start: 2, end: 2, native: true, phantomBreak: true }),
        { text: 'a\n', start: 2, end: 2 }
    );
    assert.deepEqual(
        await repair({
            framework: 'WinForm',
            className: 'WindowsForms10.RichEdit20W.app.0.1',
            text: 'hello\n',
            start: 6,
            end: 6,
        }),
        { text: 'hello', start: 5, end: 5 }
    );
    assert.deepEqual(await repair({ framework: 'Win32', className: 'Edit', text: 'hello\n', start: 6, end: 6 }), {
        text: 'hello\n',
        start: 6,
        end: 6,
    });
});

test(
    'edit outcome: applied, completed by the field, reshaped by a mask, or not there yet',
    { skip: !windows },
    async () => {
        const read = (text, extra = {}) => ({
            readable: true,
            session: 's',
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
            ...extra,
        });
        const outcome = (facts) =>
            ask('Get-EditOutcome', { old: '06', next: '061', landed: 3, session: 's', stableMs: 0, ...facts });
        assert.equal(await outcome({ read: read('061') }), 'applied');
        assert.equal(await outcome({ read: read('06 1', { session: 'other' }) }), 'moved');
        assert.equal(await outcome({ read: read('06 1'), stableMs: 50 }), 'pending');
        assert.equal(await outcome({ read: read('06 1'), stableMs: 150 }), 'reshaped');
        // A field that answers late still holds the old text: never taken for its answer.
        assert.equal(await outcome({ read: read('06'), stableMs: 500 }), 'pending');
        assert.equal(
            await outcome({
                old: '',
                next: 'a',
                landed: 1,
                read: read('apple', { selectionStart: 1, selectionEnd: 5 }),
            }),
            'completed'
        );
    }
);

test('insert strategy: line breaks each field takes', { skip: !windows }, async () => {
    const strategy = (facts) => ask('Select-InsertStrategy', { rich: false, className: '', framework: '', ...facts });
    assert.equal(await strategy({ text: 'hello' }), 'characters');
    assert.equal(await strategy({ text: 'a\nb', framework: 'Chrome', rich: true }), 'shift-enter');
    assert.equal(await strategy({ text: 'a\nb', framework: 'Chrome' }), 'paste');
    assert.equal(
        await strategy({ text: 'a\nb', framework: 'WinForm', className: 'WindowsForms10.RichEdit20W.app.0.1' }),
        'enter'
    );
    assert.equal(
        await strategy({ text: 'a\nb', framework: 'WinForm', className: 'WindowsForms10.EDIT.app.0.1' }),
        'carriage-return'
    );
    assert.equal(await strategy({ text: 'a\nb', framework: 'Win32', className: 'Edit' }), 'carriage-return');
    assert.equal(await strategy({ text: 'a\nb', framework: 'WPF', className: 'TextBox' }), 'paste');
});

test('field verdicts recorded from real browsers stay the same', { skip: !windows }, async () => {
    let recorded;
    try {
        recorded = JSON.parse(await readFile('tests/fixtures/field-facts.json', 'utf8'));
    } catch {
        return;
    }
    for (const { browser, id, facts, verdict: expected } of recorded) {
        const { unreadable, empty, singleLine = false } = await ask('Get-FieldVerdict', facts);
        assert.deepEqual({ unreadable, empty, singleLine }, expected, `${browser} ${id}`);
    }
});

test('PowerShell sources are plain ASCII', async () => {
    // Windows PowerShell reads a file without a byte order mark as ANSI: any other character turns to mojibake (a
    // regex of zero-width characters breaks). Write them as \uXXXX escapes.
    const { readdir } = await import('node:fs/promises');
    for (const directory of ['host', 'scripts', 'tests'])
        for (const name of await readdir(directory, { recursive: true }))
            if (/\.(ps1|psm1)$/.test(name)) {
                const lines = (await readFile(`${directory}/${name}`, 'utf8')).split('\n');
                const line = lines.findIndex((text) => /[^\x00-\x7F]/.test(text));
                assert.equal(line, -1, `${directory}/${name}:${line + 1} holds a non-ASCII character`);
            }
});
