// Typing check: the phone app types for real into test fields on this PC, through a test host and its Windows
// bridge, and each field must end up holding exactly what was typed (or what its mask makes of it): no letter
// doubled, none lost, whether the phone reads the field or types blind. The phone must show the PC's text, or what
// it typed blind.
// - Phone: the app in headless Chrome, emulating a phone. It types like a hardware keyboard (keys), with a typo
//   erased by Backspace (typo), like Gboard (ime: each word composed, then committed), slowly (slow: a pause
//   between keys, where late answers show) or with Gboard's autocorrection fixing each word (correct).
// - PC: tests/fixtures/typing.html in Chrome and Firefox windows, then their address bars, and native WinForms and
//   WPF windows (tests/checks/typing-windows.ps1) and Windows' Notepad, each field in turn brought to the foreground
//   and focused.
// Every test window carries a random marker in its title, and the test host's bridge refuses input unless the
// foreground window has it (REMOTE_SMART_TRACKPAD_INPUT_GUARD): nothing typed can reach another app. Windows come
// to the foreground one after the other, so leave the PC alone while it runs.
//   node tests/checks/typing-check.mjs [--quick] [--target=chrome,firefox,winforms,wpf,notepad] [--case=id,id]
//                                  [--mode=keys,ime,slow,typo,correct,...] [--verbose: what the phone sent]
//                                  [--trace: what the phone was shown]
// The full run takes about 45 minutes. --quick (about 3) plays one field of each kind that ever broke, in the modes
// that found bugs, in Chrome and WinForms: enough after changes that do not touch typing itself. Run the full one
// after changes to the typing session, the mirror or the bridge. --target, --case and --mode still narrow it.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cleanupBrowsers, installed, openBrowser } from './test-browsers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = (name) =>
    process.argv
        .find((argument) => argument.startsWith(`--${name}=`))
        ?.split('=')[1]
        .split(',');
const quick = process.argv.includes('--quick');
// The quick run: per target, the fields kept (one of each kind), and the modes.
const quickCases = {
    chrome: ['input', 'editable', 'phone', 'complete', 'delayed', 'code-line', 'proxy', 'otp', 'address'],
    winforms: ['textbox', 'multiline', 'masked'],
};
const quickModes = ['keys', 'ime', 'typo', 'move', 'click', 'lines', 'unicode'];
const targets =
    option('target') ?? (quick ? Object.keys(quickCases) : ['chrome', 'firefox', 'winforms', 'wpf', 'notepad']);
const onlyCases = option('case');
const modes = option('mode')
    ?? (quick ? quickModes : null) ?? [
        'keys',
        'ime',
        'slow',
        'typo',
        'correct',
        'move',
        'reopen',
        'swipe',
        'unicode',
        'emoji',
        'lines',
        'paste',
        'click',
    ];
const marker = `rst${Math.random().toString(36).slice(2, 8)}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = (promise, ms, what) => {
    let timer;
    const expired = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`Timed out: ${what}`)), ms)));
    return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
};
const temp = (name) => mkdtemp(path.join(tmpdir(), `remote-smart-trackpad-${name}-`));

// Native fixtures: what is typed into each field and what it must hold then (tests/checks/typing-windows.ps1).
const nativeCases = {
    winforms: [
        { id: 'textbox', typed: 'hello world', expected: 'hello world', caret: true },
        { id: 'multiline', typed: 'hello world', expected: 'hello world', caret: true, lines: true },
        { id: 'upper', typed: 'hello', expected: 'HELLO' },
        { id: 'maxlength', typed: 'hello world', expected: 'hello' },
        { id: 'masked', typed: '02102026', expected: '02/10/2026' },
        { id: 'rich', typed: 'hello world', expected: 'hello world', caret: true, lines: true },
        { id: 'combo', typed: 'apple pie', expected: 'apple pie' },
    ],
    wpf: [
        { id: 'textbox', typed: 'hello world', expected: 'hello world', caret: true },
        { id: 'multiline', typed: 'hello world', expected: 'hello world', caret: true, lines: true },
        { id: 'upper', typed: 'hello', expected: 'HELLO' },
        { id: 'maxlength', typed: 'hello world', expected: 'hello' },
        { id: 'rich', typed: 'hello world', expected: 'hello world', caret: true, lines: true },
        { id: 'combo', typed: 'apple pie', expected: 'apple pie' },
    ],
};

// The browser's own address bar: a search, and an address it completes inline from its history (the fixture page's),
// which must start with exactly what was typed.
const addressCases = [
    { id: 'address', typed: 'hello world', expected: 'hello world', caret: true },
    { id: 'address-completion', typed: '127.0', expected: '127.0…', check: (value) => /^127\.0(\.0\.1|$)/.test(value) },
];

/** A JSON-lines child process: one request per line, answered in order. */
function lineProcess(command, args) {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    const waiting = [];
    let exited = null;
    readline.createInterface({ input: child.stdout }).on('line', (line) => waiting.shift()?.resolve(JSON.parse(line)));
    child.on('exit', (code) => {
        exited = new Error(`${path.basename(args.at(-1))} stopped (${code})`);
        for (const request of waiting.splice(0)) request.reject(exited);
    });
    return {
        async ask(request, ms = 30000) {
            const answer = await timeout(
                new Promise((resolve, reject) => {
                    if (exited) return reject(exited);
                    waiting.push({ resolve, reject });
                    child.stdin.write(JSON.stringify(request) + '\n');
                }),
                ms,
                JSON.stringify(request)
            );
            if (!answer.ok) throw new Error(answer.error);
            return answer.result;
        },
        stop: () => child.stdin.end(),
    };
}

/** Serves the fixture page, which asks for its next command each time it has run the previous one. */
async function startFixturePage() {
    const html = await readFile(path.join(root, 'tests/fixtures/typing.html'), 'utf8');
    let waiter = null,
        pending = null;
    const replies = [];
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/')
            return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
        if (url.pathname !== '/next') return response.writeHead(404).end();
        let body = '';
        for await (const chunk of request) body += chunk;
        pending = response;
        replies.push(JSON.parse(body));
        waiter?.();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const next = () =>
        timeout(
            new Promise((resolve) => {
                const check = () => (replies.length ? resolve(replies.shift()) : (waiter = check));
                check();
            }),
            20000,
            'fixture page'
        );
    return {
        url: `http://127.0.0.1:${server.address().port}/?harness=${marker}`,
        cases: () => next().then((reply) => reply.cases),
        /** Sends a command once the page waits for one, and resolves with the page's answer. */
        async command(command) {
            while (!pending) await wait(20);
            const response = pending;
            pending = null;
            response.end(JSON.stringify(command));
            return command.do === 'end' ? null : next();
        },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/** The test host, its bridge typing only into windows titled with the marker. */
async function startHost() {
    const reservation = createNetServer();
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const data = await temp('typing-host');
    const host = spawn(process.execPath, ['host/server.js'], {
        cwd: root,
        windowsHide: true,
        stdio: 'ignore',
        env: {
            ...process.env,
            REMOTE_SMART_TRACKPAD_PORT: String(port),
            REMOTE_SMART_TRACKPAD_DATA_DIRECTORY: data,
            REMOTE_SMART_TRACKPAD_OPEN_SETUP: '0',
            REMOTE_SMART_TRACKPAD_INPUT_GUARD: marker,
        },
    });
    const url = `http://127.0.0.1:${port}`;
    let setup;
    for (let attempt = 0; attempt < 100 && !setup; attempt++) {
        try {
            setup = await (await fetch(url + '/api/setup')).json();
        } catch {
            if (host.exitCode !== null) throw new Error(`Host exited: ${host.exitCode}`);
            await wait(100);
        }
    }
    if (!setup) throw new Error('The test host did not start');
    return {
        url,
        pairingCode: setup.pairingCode,
        async stop() {
            host.kill();
            await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        },
    };
}

/** The phone: the app in headless Chrome, paired with the test host, every message it exchanges logged. */
async function startPhone(host) {
    const profile = await temp('typing-phone');
    const chrome = spawn(
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        [
            '--headless=new',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--remote-debugging-port=0',
            `--user-data-dir=${profile}`,
            'about:blank',
        ],
        { windowsHide: true, stdio: 'ignore' }
    );
    let endpoint;
    for (let attempt = 0; attempt < 80 && !endpoint; attempt++) {
        try {
            const [port, url] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
                .trim()
                .split(/\r?\n/);
            endpoint = `ws://127.0.0.1:${port}${url}`;
        } catch {
            await wait(100);
        }
    }
    if (!endpoint) throw new Error('Headless Chrome did not start');
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown')
            exceptions.push(
                message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text
            );
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    };
    const send = (method, params = {}, sessionId) =>
        timeout(
            new Promise((resolve, reject) => {
                const next = ++id;
                pending.set(next, { resolve, reject });
                socket.send(JSON.stringify({ id: next, method, params, sessionId }));
            }),
            15000,
            method
        );
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
        const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const until = async (expression, ms = 10000) => {
        for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (await evaluate(expression)) return;
        throw new Error(`Phone condition did not become true: ${expression}`);
    };
    await page('Runtime.enable');
    await page('Page.enable');
    await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    await page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // A focused page, like the phone's browser in front: its text field keeps the focus and gets the keys.
    await page('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Every message to the PC and every answer, timed, for the report.
    await page('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
            const log = (window.__log = []);
            const send = WebSocket.prototype.send;
            WebSocket.prototype.send = function (raw) {
                if (!this.__logged) {
                    this.__logged = true;
                    this.addEventListener('message', (event) => {
                        const message = JSON.parse(event.data);
                        if (message.type === 'ack') log.push({ in: message.id, ok: message.ok, result: message.result, error: message.error, at: performance.now() });
                    });
                }
                const message = JSON.parse(raw);
                log.push({ out: message.id, action: message.action, data: message.data, at: performance.now() });
                // Mouse clicks and buttons never reach the PC: they would land wherever its pointer is, maybe on
                // another app. They are answered as done.
                if (message.action === 'click' || message.action === 'button') {
                    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ack', id: message.id, ok: true }) })));
                    return;
                }
                return send.call(this, raw);
            };
        })();`,
    });
    await page('Page.navigate', { url: host.url });
    await until("document.querySelector('#pair-form') && !document.querySelector('#pairing').hidden");
    await evaluate(
        `document.querySelector('#pair-name').value = 'Typing check'; document.querySelector('#pair-code').value = ${JSON.stringify(host.pairingCode)}; document.querySelector('#pair-form').requestSubmit();`
    );
    await until("document.querySelector('#connection').dataset.state === 'ready'");
    const editor = "document.querySelector('text-editor')";
    const anchor = String.fromCharCode(0x200b);
    return {
        exceptions,
        async open() {
            await evaluate('window.__log.length = 0; window.__renders = []');
            // Each state the editor is given, to trace what the phone showed.
            await evaluate(`(() => {
                const editor = document.querySelector('text-editor');
                if (editor.__traced) return;
                editor.__traced = true;
                const render = editor.render;
                editor.render = function (state) {
                    const { readable, blind, keep, field, text } = state;
                    window.__renders.push({ at: performance.now(), readable, blind, keep, field, text, composing: this.composing });
                    return render.call(this, state);
                };
            })()`);
            await evaluate("document.querySelector('#editor-open').click()");
            await until(`${editor}.view.open && !${editor}.view.reading`);
        },
        async close() {
            await evaluate(
                `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector('#editor-text').blur();`
            );
            await until(`!${editor}.view.open`);
        },
        /** keys: a hardware keyboard. ime: Gboard, composing each word and committing it, digits and spaces as is. */
        /**
         * keys: a hardware keyboard; typo: the same with a wrong key erased with Backspace after the third.
         * ime: Gboard, composing each word and committing it, digits and spaces as is; correct: Gboard composing
         * each word misspelled (its last two letters swapped) and its autocorrection committing it right.
         */
        async type(text, style, gap) {
            const key = async (name, character) => {
                const code = name === 'Backspace' ? { windowsVirtualKeyCode: 8, code: 'Backspace' } : {};
                const typed = character ? { text: character, unmodifiedText: character } : {};
                await page('Input.dispatchKeyEvent', { type: 'keyDown', key: name, ...code, ...typed });
                await page('Input.dispatchKeyEvent', { type: 'keyUp', key: name, ...code });
                await wait(gap);
            };
            if (style === 'keys' || style === 'typo') {
                for (const [index, character] of [...text].entries()) {
                    await key(character, character);
                    if (style === 'typo' && index === 2) {
                        await key(/[0-9]/.test(character) ? '9' : 'x', /[0-9]/.test(character) ? '9' : 'x');
                        await key('Backspace');
                    }
                }
                return;
            }
            for (const piece of text.match(/[A-Za-z]+|[^A-Za-z]/g)) {
                if (!/[A-Za-z]/.test(piece)) {
                    await page('Input.insertText', { text: piece });
                    await wait(gap);
                    continue;
                }
                const composed =
                    style === 'correct' && piece.length > 2 ? piece.slice(0, -2) + piece.at(-1) + piece.at(-2) : piece;
                for (let length = 1; length <= composed.length; length++) {
                    await page('Input.imeSetComposition', {
                        text: composed.slice(0, length),
                        selectionStart: length,
                        selectionEnd: length,
                    });
                    await wait(gap);
                }
                await page('Input.insertText', { text: piece });
                await wait(gap);
            }
        },
        /** Moves the keyboard's cursor by `steps` characters, one at a time, like a finger dragging on the space bar. */
        async moveCaret(steps, gap = 60) {
            for (let step = 0; step < Math.abs(steps); step++) {
                await evaluate(
                    `(() => { const field = document.querySelector('#editor-text'), at = field.selectionStart + ${Math.sign(steps)}; field.setSelectionRange(at, at); })()`
                );
                await wait(gap);
            }
        },
        /** Presses Backspace (lifting the finger after a Backspace swipe deletes what it selected) or Enter. */
        async press(name) {
            const key = { key: name, code: name, windowsVirtualKeyCode: name === 'Enter' ? 13 : 8 };
            if (name === 'Enter') Object.assign(key, { text: '\r', unmodifiedText: '\r' });
            await page('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
            await page('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
        },
        /** A click from the trackpad: the app hears it, the PC never gets it (the check's fake, see startPhone). */
        async click() {
            await evaluate(
                "document.dispatchEvent(new CustomEvent('command', { detail: { action: 'click', data: { button: 'left' } } }))"
            );
            await wait(400);
        },
        /** Commits text at once, as Gboard commits an emoji, a suggestion or its clipboard. */
        async insert(text) {
            await page('Input.insertText', { text });
            await wait(60);
        },
        /** Selects the `count` characters before the cursor, as Gboard's Backspace swipe does. */
        async selectBack(count) {
            await evaluate(
                `(() => { const field = document.querySelector('#editor-text'), end = field.selectionEnd; field.setSelectionRange(end - ${count}, end); })()`
            );
            await wait(100);
        },
        /** Resolves once the phone has sent nothing for `quiet` ms and every message has its answer. */
        async settle(quiet = 1500, ms = 20000) {
            for (const end = Date.now() + ms; Date.now() < end; await wait(100)) {
                const state = await evaluate(`(() => {
                    // Reads go on all the time: only what changes the PC (and its answer) counts.
                    const log = window.__log;
                    const typing = new Set(log.filter(entry => 'out' in entry && entry.action !== 'mirror-read').map(entry => entry.out));
                    const answered = new Set(log.filter(entry => 'in' in entry).map(entry => entry.in));
                    const last = Math.max(0, ...log.filter(entry => typing.has(entry.out ?? entry.in)).map(entry => entry.at));
                    return { open: [...typing].some(id => !answered.has(id)), idle: performance.now() - last };
                })()`);
                if (!state.open && state.idle > quiet) return;
            }
            throw new Error('The phone never settled');
        },
        state: () =>
            evaluate(
                `({ text: document.querySelector('#editor-text').value.replaceAll(${JSON.stringify(anchor)}, ''), blind: ${editor}.view.blind, readable: ${editor}.view.readable, log: window.__log, renders: window.__renders, now: performance.now() })`
            ),
        async stop() {
            socket.close();
            chrome.kill();
            await wait(300);
            await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
        },
    };
}

const typingModes = {
    keys: { style: 'keys', gap: 40 },
    ime: { style: 'ime', gap: 40 },
    slow: { style: 'ime', gap: 250 },
    typo: { style: 'typo', gap: 40 },
    correct: { style: 'correct', gap: 40 },
};
// Scenarios, each in the fields that need it (caret: one can move in it, lines: it holds several lines, text: it
// takes typed text, not only keys):
// - move, reopen, swipe: Gboard's cursor moves (dragging on the space bar, one step per character) and its
//   Backspace swipe (dragging left over Backspace selects words, lifting deletes them), within the text typed, and
//   past it once the editor was closed and opened again (the phone then knows nothing of the field's text blind).
// - unicode: accents and an emoji (two UTF-16 units), committed as Gboard commits them. emoji: Backspace on an emoji
//   with a skin tone (four units, one character): it goes whole. lines: Enter between two lines. paste: a long text
//   inserted at once (Gboard's clipboard).
const pasted = Array(7).fill('The quick brown fox jumps over the lazy dog.').join(' ');
const scenarios = {
    unicode: {
        needs: ['caret', 'text'],
        steps: [
            ['insert', 'café '],
            ['insert', '😀'],
            ['insert', ' ok'],
        ],
        expected: 'café 😀 ok',
    },
    emoji: {
        needs: ['caret', 'text'],
        steps: [
            ['insert', 'ok 👍🏽'],
            ['key', 'Backspace'],
        ],
        expected: 'ok ',
    },
    lines: {
        needs: 'lines',
        steps: [
            ['type', 'one'],
            ['key', 'Enter'],
            ['type', 'two'],
        ],
        expected: 'one\ntwo',
    },
    paste: { needs: 'caret', steps: [['insert', pasted]], expected: pasted },
    move: {
        needs: 'caret',
        steps: [
            ['type', 'hello world'],
            ['move', -6],
            ['type', ','],
        ],
        expected: 'hello, world',
    },
    reopen: {
        needs: 'caret',
        steps: [['type', 'hello world'], ['reopen'], ['move', -6], ['type', ',']],
        expected: 'hello, world',
    },
    // A click on the PC puts its caret after "hello": into the text typed blind (the phone follows) or somewhere it
    // cannot tell (the phone starts afresh); typing goes on at the PC's caret either way.
    click: {
        needs: 'pcCaret',
        steps: [['type', 'hello world'], ['pcCaret', 5], ['click'], ['type', ',']],
        expected: 'hello, world',
    },
    swipe: {
        needs: 'caret',
        steps: [
            ['type', 'hello big world'],
            ['select', 5],
            ['key', 'Backspace'],
            ['type', 'there'],
        ],
        expected: 'hello big there',
    },
};

/** How long the PC took to answer each message, by action, in ms. */
function latencies(log) {
    const sent = new Map(log.filter((entry) => 'out' in entry).map((entry) => [entry.out, entry]));
    const byAction = {};
    for (const answer of log.filter((entry) => 'in' in entry)) {
        const message = sent.get(answer.in);
        if (message) (byAction[message.action] ??= []).push(Math.round(answer.at - message.at));
    }
    return byAction;
}

/** What the phone sent, in short: typed text, keys, edits (with how the PC answered). */
function summarize(log) {
    const answers = new Map(log.filter((entry) => 'in' in entry).map((entry) => [entry.in, entry]));
    return log
        .filter((entry) => 'out' in entry && !['mirror-read', 'mirror-close', 'media-state'].includes(entry.action))
        .map((entry) => {
            const answer = answers.get(entry.out);
            const failed = answer && !answer.ok ? `!${answer.error}` : '';
            if (entry.action === 'text') {
                const { backspace, delete: forward, text } = entry.data;
                return `text(${backspace ? `⌫${backspace}` : ''}${forward ? `⌦${forward}` : ''}${JSON.stringify(text)})${failed}`;
            }
            if (entry.action === 'mirror-edit') {
                const accepted = answer?.result?.accepted;
                return `edit(${entry.data.start}-${entry.data.end}${JSON.stringify(entry.data.text)})${accepted ? '' : `✗${JSON.stringify(answer?.result?.snapshot?.text)}`}${failed}`;
            }
            return `${entry.action}(${JSON.stringify(entry.data?.key ?? entry.data)})${failed}`;
        })
        .join(' ');
}

const results = [];
async function runCase({
    target,
    entry,
    mode,
    focus,
    value,
    phone,
    windows,
    moveCaret = () => Promise.reject(new Error('No PC caret here')),
    title = `${marker} ${entry.id}`,
}) {
    const scenario = scenarios[mode];
    // text: fields take typed text, not only keys (all but the keys-only terminal).
    const has = (need) => (need === 'text' ? entry.text !== false : entry[need]);
    if (scenario && ![scenario.needs].flat().every(has)) return;
    await focus(entry.id);
    await windows.ask({ do: 'bring', title });
    // A window coming to the foreground can give the focus back to its first field (WinForms): focus again.
    await focus(entry.id);
    await wait(150);
    if (scenario)
        entry = {
            ...entry,
            typed: scenario.steps.find(([step]) => step === 'type' || step === 'insert')[1],
            expected: scenario.expected,
            check: null,
        };
    await phone.open();
    const started = performance.now();
    let phoneState,
        problem = '';
    try {
        if (!scenario) await phone.type(entry.typed, typingModes[mode].style, typingModes[mode].gap);
        for (const [step, value] of scenario?.steps ?? []) {
            if (step === 'type') await phone.type(value, 'keys', 40);
            else if (step === 'insert') await phone.insert(value);
            else if (step === 'pcCaret') await moveCaret(entry.id, value);
            else if (step === 'click') await phone.click();
            else if (step === 'move') await phone.moveCaret(value);
            else if (step === 'select') await phone.selectBack(value);
            else if (step === 'key') await phone.press(value);
            else if (step === 'reopen') {
                await phone.settle();
                await phone.close();
                await wait(300);
                await phone.open();
            }
            await phone.settle(400);
        }
        await phone.settle();
    } catch (error) {
        problem = error.message;
    }
    phoneState = await phone.state();
    await phone.close().catch(() => {});
    await wait(300);
    const got = await value(entry.id);
    const result = {
        target,
        id: entry.id,
        mode,
        // The phone shows the PC's text, or what was typed blind: all of it, or its end once the focus moved on.
        // Moving the caret or deleting leaves only part of the text on the phone: any part of the final text.
        echo:
            scenario ?
                entry.expected.includes(phoneState.text)
            :   (phoneState.blind ? entry.typed : got).endsWith(phoneState.text),
        pass: (entry.check ? entry.check(got) : got === entry.expected) && !problem,
        problem,
        got,
        expected: entry.expected,
        phone: phoneState.text,
        blind: phoneState.blind,
        sent: summarize(phoneState.log),
        latency: latencies(phoneState.log),
        // The PC's last answers to reads, for diagnosis (report only).
        reads: phoneState.log
            .filter((entry) => 'in' in entry && entry.result && 'readable' in entry.result)
            .slice(-4)
            .map((entry) => entry.result),
        errors: [...new Set(phoneState.log.filter((entry) => entry.error).map((entry) => entry.error))],
        ms: Math.round(performance.now() - started),
    };
    result.pass &&= result.echo;
    results.push(result);
    const mark = result.pass ? 'ok  ' : 'FAIL';
    console.log(
        `${mark} ${target.padEnd(8)} ${entry.id.padEnd(10)} ${mode.padEnd(5)} ${result.blind ? 'blind' : 'read '} ${JSON.stringify(got)}${result.pass ? '' : ` ≠ ${JSON.stringify(entry.expected)}`}  phone ${JSON.stringify(result.phone)}  ${result.ms}ms`
    );
    if (problem) console.log(`       ${problem}`);
    if (result.errors.length) console.log(`       PC errors: ${result.errors.join(' | ')}`);
    if (!result.pass || process.argv.includes('--verbose')) console.log(`       ${result.sent}`);
    // What the phone was shown, timed from the end of the run backwards.
    if (!result.echo || process.argv.includes('--trace'))
        for (const { at, ...render } of phoneState.renders)
            console.log(`         ${Math.round(at - phoneState.now)}ms ${JSON.stringify(render)}`);
}

await cleanupBrowsers();
const host = await startHost();
const windows = lineProcess('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'tests/checks/typing-windows.ps1'),
]);
let phone;
const cleanup = async () => {
    await windows.ask({ do: 'close' }).catch(() => {});
    windows.stop();
    await phone?.stop().catch(() => {});
    await host.stop();
    await cleanupBrowsers();
};
process.once('SIGINT', async () => {
    await cleanup();
    process.exit(130);
});
try {
    phone = await startPhone(host);
    const selected = (cases, target) =>
        cases.filter(
            (entry) =>
                (!onlyCases || onlyCases.includes(entry.id))
                && (!quick || option('case') || quickCases[target]?.includes(entry.id))
        );
    for (const target of targets) {
        // Windows' own Notepad, a fresh one for each run, on an empty test file named with the marker (its title).
        if (target === 'notepad') {
            const entry = { id: 'notepad', typed: 'hello world', expected: 'hello world', caret: true, lines: true };
            for (const mode of selected([entry], target).length ? modes : []) {
                const file = path.join(tmpdir(), `${marker}-notepad.txt`);
                await writeFile(file, '');
                const notepad = spawn('notepad.exe', [file], { stdio: 'ignore' });
                try {
                    await runCase({
                        target,
                        entry,
                        mode,
                        phone,
                        windows,
                        title: `${marker}-notepad`,
                        focus: () => wait(300),
                        value: () => windows.ask({ do: 'window-text', title: `${marker}-notepad` }),
                    });
                } finally {
                    notepad.kill();
                    await wait(200);
                    await rm(file, { force: true });
                }
            }
            continue;
        }
        if (target in nativeCases) {
            await windows.ask({ do: 'open', window: target, marker });
            for (const entry of selected(nativeCases[target], target))
                for (const mode of modes)
                    await runCase({
                        target,
                        entry,
                        mode,
                        phone,
                        windows,
                        focus: (id) => windows.ask({ do: 'focus', window: target, id }),
                        value: (id) => windows.ask({ do: 'value', window: target, id }),
                    });
            await windows.ask({ do: 'close' });
            continue;
        }
        if (!installed(target)) {
            console.log(`${target}: not installed, skipped`);
            continue;
        }
        const fixture = await startFixturePage();
        const browser = await openBrowser(target, fixture.url, { app: false });
        try {
            const cases = selected(await fixture.cases(), target);
            for (const entry of cases)
                for (const mode of modes)
                    await runCase({
                        target,
                        entry,
                        mode,
                        phone,
                        windows,
                        focus: (id) => fixture.command({ do: 'focus', id }),
                        value: (id) => fixture.command({ do: 'value', id }).then((reply) => reply.value),
                        moveCaret: (id, position) => fixture.command({ do: 'caret', id, position }),
                    });
            // Last: once the address bar has the focus, the page cannot take it back by itself.
            for (const entry of selected(addressCases, target))
                for (const mode of modes)
                    await runCase({
                        target,
                        entry,
                        mode,
                        phone,
                        windows,
                        title: marker,
                        focus: () => windows.ask({ do: 'address', title: marker, action: 'focus' }),
                        value: () => windows.ask({ do: 'address', title: marker, action: 'value' }),
                    });
            await fixture.command({ do: 'end' });
        } finally {
            await browser.close();
            await fixture.close();
        }
    }
} finally {
    if (phone?.exceptions.length) console.log('Phone exceptions:', phone.exceptions);
    await cleanup();
}
// The PC's answer times over the whole run, per target and action: median and slowest tenth.
const percentile = (values, share) =>
    values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * share))];
console.log('\nPC answer times (ms): median / 90th percentile / count');
for (const target of new Set(results.map((result) => result.target))) {
    const byAction = {};
    for (const result of results.filter((entry) => entry.target === target))
        for (const [action, values] of Object.entries(result.latency)) (byAction[action] ??= []).push(...values);
    const line = Object.entries(byAction)
        .map(([action, values]) => `${action} ${percentile(values, 0.5)}/${percentile(values, 0.9)}/${values.length}`)
        .join('  ');
    console.log(`  ${target.padEnd(8)} ${line}`);
}
const failures = results.filter((result) => !result.pass);
const report = path.join(tmpdir(), 'remote-smart-trackpad-typing-report.json');
await writeFile(report, JSON.stringify(results, null, 2));
console.log(
    `\n${failures.length ? `${failures.length} failed` : 'No failure'} in ${results.length} runs. Report: ${report}`
);
process.exitCode = failures.length ? 1 : 0;
