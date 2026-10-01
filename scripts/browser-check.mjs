import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
// Everything this check produces lives in the system temp folder, cleaned up by the OS: the throwaway host data and
// Chrome profile are removed at the end, the screenshots and report stay in `output` for inspection.
const temp = (name) => mkdtemp(path.join(tmpdir(), `remote-smart-trackpad-${name}-`));
const output = await temp('browser-check');
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const hostData = await temp('browser-host');
const host = spawn(process.execPath, ['host/server.js'], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
        ...process.env,
        REMOTE_SMART_TRACKPAD_PORT: String(port),
        REMOTE_SMART_TRACKPAD_DATA_DIRECTORY: hostData,
        REMOTE_SMART_TRACKPAD_OPEN_SETUP: '0',
    },
});
const url = 'http://127.0.0.1:' + port;
const profile = await temp('chrome-profile');
const child = spawn(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        '--user-data-dir=' + profile,
        'about:blank',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
);
let errors = '';
child.stderr.on('data', (chunk) => {
    errors += chunk;
});
let socket;
const exceptions = [];
try {
    let setup;
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            setup = await (await fetch(url + '/api/setup')).json();
            break;
        } catch {}
        if (host.exitCode !== null) throw new Error('Host exited: ' + host.exitCode);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(setup?.app, 'remote-smart-trackpad');
    let endpoint;
    for (let attempt = 0; attempt < 80; attempt++) {
        try {
            const [port, url] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
                .trim()
                .split(/\r?\n/);
            endpoint = 'ws://127.0.0.1:' + port + url;
            break;
        } catch {}
        if (child.exitCode !== null) throw new Error('Chrome exited: ' + child.exitCode + '\n' + errors.slice(-1600));
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!endpoint) throw new Error('Chrome debugger unavailable\n' + errors.slice(-1600));
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
            const details = message.params.exceptionDetails;
            exceptions.push(details.exception?.description ?? details.text);
        }
        const request = pending.get(message.id);
        if (request) {
            pending.delete(message.id);
            clearTimeout(request.timeout);
            message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
        }
    };
    const send = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
            const next = ++id;
            const timeout = setTimeout(() => {
                pending.delete(next);
                reject(new Error('Timed out: ' + method));
            }, 15000);
            pending.set(next, { resolve, reject, timeout });
            socket.send(JSON.stringify({ id: next, method, params, sessionId }));
        });
    console.log(JSON.stringify(await send('Browser.getVersion')));
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    await page('Runtime.enable');
    await page('Page.enable');
    const evaluate = async (expression) => {
        const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const waitFor = async (expression) => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (await evaluate(expression)) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Page condition did not become true: ' + expression);
    };
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 711, deviceScaleFactor: 1, mobile: true });
    await page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // The test page is paired with the real host: only reads reach the PC, so it never types, clicks or scrolls there.
    await page('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
            const allowed = new Set(['mirror-read', 'mirror-close', 'media-state', 'release']);
            const send = WebSocket.prototype.send;
            WebSocket.prototype.send = function (raw) {
                const message = JSON.parse(raw);
                (window.__sent ??= []).push({ action: message.action, at: performance.now() });
                if (allowed.has(message.action)) return send.call(this, raw);
                (window.__blocked ??= []).push(message);
                const reply = message.action === 'mirror-edit' ? { ok: false, error: 'Blocked by the browser check' } : { ok: true, result: {} };
                queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, ...reply }) })));
            };
        })();`,
    });
    await page('Page.navigate', { url });
    await waitFor("document.querySelector('key-rows button') && !document.querySelector('#pairing').hidden");
    await evaluate(
        "document.querySelector('#pair-name').value = 'Browser test'; document.querySelector('#pair-code').value = "
            + JSON.stringify(setup.pairingCode)
            + "; document.querySelector('#pair-form').requestSubmit();"
    );
    await waitFor("document.querySelector('#connection').dataset.state === 'ready'");
    await evaluate('document.fonts.ready.then(() => true)');
    const typography = await evaluate(
        "({ loaded: document.fonts.check('400 14px Inter') && document.fonts.check('500 12px Inter'), weight: getComputedStyle(document.querySelector('textarea')).fontWeight })"
    );
    assert.equal(typography.loaded, true);
    assert.equal(typography.weight, '400');
    const report = [];
    // The key rows' switches start from the defaults declared in key-rows.js.
    assert.deepEqual(
        await evaluate(
            "Object.fromEntries(['functions', 'media', 'characters', 'edit', 'modifiers'].map((name) => [name, document.querySelector('[name=' + name + ']').checked]))"
        ),
        { functions: false, media: true, characters: true, edit: true, modifiers: true }
    );
    await evaluate(
        "document.querySelectorAll('#options input').forEach(input => { if (['functions','media','characters'].includes(input.name)) { input.checked = true; input.dispatchEvent(new Event('change')); } });"
    );
    for (const [name, width, height] of [
        ['figma-main', 375, 711],
        ['landscape', 844, 390],
    ]) {
        await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
        const dimensions = await evaluate(
            '({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, keys: document.querySelectorAll("key-rows button").length, padHeight: document.querySelector(".trackpad").getBoundingClientRect().height })'
        );
        assert.ok(dimensions.scrollWidth <= dimensions.width, 'Page overflow in ' + name);
        // Every row shown still leaves a usable trackpad (5rem); the key rows scroll instead.
        assert.ok(dimensions.padHeight >= 79, 'Trackpad too small in ' + name + ': ' + dimensions.padHeight);
        const screenshot = await page('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(output, 'browser-' + name + '.png'), Buffer.from(screenshot.data, 'base64'));
        report.push({ name, ...dimensions });
    }
    // Auto-repeat: a held repeating key (Volume up) is sent again until released; a plain key (Escape) once.
    const holdKey = async (key, duration) => {
        const box = await evaluate(`(() => {
            window.__blocked = [];
            // The key rows scroll when they do not fit (landscape): bring the key into view first.
            const button = document.querySelector('key-rows [data-key="${key}"]');
            button.scrollIntoView({ block: 'nearest' });
            const rect = button.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [box] });
        await evaluate(`new Promise(resolve => setTimeout(resolve, ${duration}))`);
        await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const sent = () =>
            evaluate(
                `window.__blocked.filter(message => message.action === 'shortcut' && message.data?.key === '${key}').length`
            );
        const released = await sent();
        await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
        assert.equal(await sent(), released, key + ' must stop repeating once released');
        return released;
    };
    const repeated = await holdKey('VolumeUp', 1500);
    assert.ok(repeated >= 3, 'A held Volume up must repeat, sent ' + repeated);
    assert.equal(await holdKey('Escape', 1500), 1, 'A held Escape must be sent once');
    report.push({ name: 'auto-repeat', volumeUpHeld1500ms: repeated, escapeHeld1500ms: 1 });
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 711, deviceScaleFactor: 1, mobile: true });
    await evaluate(
        "document.querySelectorAll('#options input').forEach(input => { if (['functions','media','characters'].includes(input.name)) { input.checked = false; input.dispatchEvent(new Event('change')); } }); document.querySelector('#options-toggle').click();"
    );
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    await writeFile(
        path.join(output, 'browser-menu.png'),
        Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    );
    await evaluate("document.querySelector('.options').scrollTop = 1e6");
    await writeFile(
        path.join(output, 'browser-menu-end.png'),
        Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    );
    await evaluate("document.querySelector('.options').scrollTop = 0");
    // Longer text (larger type, or translations later) wraps inside the menu instead of overflowing it.
    const overflowing = await evaluate(`(() => {
        const menu = document.querySelector('.options');
        menu.style.fontSize = '1.2rem';
        const rows = [...menu.querySelectorAll('label, .axis-setting, .stepper-setting, .choice-setting, .speed-setting, .options-action')];
        const wide = rows.filter((row) => row.getClientRects().length && row.getBoundingClientRect().right > menu.getBoundingClientRect().right + 1).map((row) => row.textContent.trim().slice(0, 30));
        const scrolls = menu.scrollWidth > menu.clientWidth;
        menu.scrollTop = 330;
        return { wide, scrolls };
    })()`);
    await writeFile(
        path.join(output, 'browser-menu-large-text.png'),
        Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    );
    await evaluate(
        "document.querySelector('.options').style.fontSize = ''; document.querySelector('.options').scrollTop = 0"
    );
    assert.deepEqual(overflowing, { wide: [], scrolls: false }, 'Options must wrap long text');
    // Interface scale: the stepper stays at the same height in the menu, ready for the next tap.
    const scaleStepper = 'document.querySelector(\'.stepper[data-setting="uiScale"]\')';
    const scaleTop = () => evaluate(scaleStepper + '.getBoundingClientRect().top');
    await evaluate(scaleStepper + ".scrollIntoView({ block: 'center' })");
    for (const step of ['1', '1', '-1', '-1']) {
        const before = await scaleTop();
        await evaluate(scaleStepper + `.querySelector('[data-step="${step}"]').click()`);
        await evaluate(
            'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))))'
        );
        const after = await scaleTop();
        assert.ok(Math.abs(after - before) <= 2, `Scale stepper moved from ${before} to ${after}`);
    }
    report.push({ name: 'scale-keeps-stepper', top: await scaleTop() });
    await evaluate("document.querySelector('.options').scrollTop = 0");
    const slider = await evaluate(`(() => {
        const input = document.querySelector('#mouse-speed'), rect = input.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width, height: rect.height, fraction: (input.valueAsNumber - Number(input.min)) / (Number(input.max) - Number(input.min)) };
    })()`);
    assert.ok(slider.height >= 44, 'Slider needs a touch-sized interaction area');
    await page('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: slider.x + 9 + (slider.width - 18) * slider.fraction, y: slider.y }],
    });
    await page('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: slider.x + slider.width * 0.75, y: slider.y }],
    });
    await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(
        await evaluate("document.querySelector('#mouse-speed').valueAsNumber > 1"),
        'Touch drag must change speed'
    );
    await evaluate(`for (const [id, value] of [['mouse-speed', 8], ['scroll-speed', 24]]) {
        const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }`);
    await page('Page.reload');
    await waitFor("document.querySelector('#connection').dataset.state === 'ready'");
    assert.deepEqual(
        await evaluate(
            "[document.querySelector('#mouse-speed').valueAsNumber, document.querySelector('#scroll-speed').valueAsNumber]"
        ),
        [8, 24]
    );
    await evaluate(`for (const [id, value] of [['mouse-acceleration', 0], ['scroll-acceleration', 0], ['mouse-speed', 2], ['scroll-speed', 0.5]]) {
        const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }`);
    const scaledMotion = await evaluate(`(async () => {
        const sent = [], original = WebSocket.prototype.send;
        WebSocket.prototype.send = function(raw) {
            const message = JSON.parse(raw);
            if (!['move', 'scroll'].includes(message.action)) return original.call(this, raw);
            sent.push({ action: message.action, ...message.data });
            queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, ok: true }) })));
        };
        try {
            document.dispatchEvent(new CustomEvent('motion', { detail: { action: 'move', dx: 10, dy: -5 } }));
            document.dispatchEvent(new CustomEvent('motion', { detail: { action: 'scroll', dx: 10, dy: -6 } }));
            await new Promise(resolve => setTimeout(resolve, 100));
            return sent;
        } finally { WebSocket.prototype.send = original; }
    })()`);
    assert.deepEqual(scaledMotion, [
        { action: 'move', dx: 20, dy: -10 },
        { action: 'scroll', dx: 5, dy: -3 },
    ]);
    await evaluate("document.querySelector('#options-toggle').click(); document.querySelector('#mouse-speed').focus()");
    await page('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
    });
    await page('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
    });
    assert.equal(
        await evaluate("document.querySelector('#mouse-speed').valueAsNumber"),
        2 + (await evaluate("Number(document.querySelector('#mouse-speed').step)"))
    );
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate('document.activeElement.id'), 'options-toggle');
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate("document.querySelector('#options-toggle').click()");
    assert.equal(await evaluate("document.querySelector('#options').getAnimations().length"), 0);
    for (const [width, height] of [
        [320, 568],
        [844, 390],
    ]) {
        await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
        assert.ok(
            await evaluate(`(() => { const menu = document.querySelector('#options'), rect = menu.getBoundingClientRect();
            menu.scrollTop = menu.scrollHeight; const last = menu.querySelector('[name=sticky]').getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && last.bottom <= rect.bottom;
        })()`),
            'Options must fit the viewport and allow access to the last setting'
        );
    }
    await evaluate("document.querySelector('#options-dismiss').click()");
    assert.equal(await evaluate("document.querySelector('#options').hidden"), true);
    await page('Emulation.setEmulatedMedia', { features: [] });
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 711, deviceScaleFactor: 1, mobile: true });
    await evaluate(
        "document.querySelector('#options-toggle').click(); document.querySelector('#options-toggle').click(); document.querySelector('#options-toggle').click()"
    );
    await evaluate('new Promise(resolve => setTimeout(resolve, 200))');
    assert.equal(await evaluate("document.querySelector('#options').hidden"), false);
    report.push({
        name: 'speed-controls',
        touch: true,
        keyboard: true,
        persisted: true,
        scaledMotion,
        reducedMotion: true,
    });
    // The editor reads the PC's real focused field; its tests answer reads themselves, so whatever the PC shows
    // (text, changes) does not matter: an empty readable field, or window.__readAnswer when a test sets it. The page
    // reload after these tests restores the real reads.
    await evaluate(`(() => {
        const send = WebSocket.prototype.send;
        const empty = { available: true, session: 'check', revision: 0, text: '', selectionStart: 0, selectionEnd: 0 };
        WebSocket.prototype.send = function (raw) {
            const message = JSON.parse(raw);
            if (message.action !== 'mirror-read') return send.call(this, raw);
            window.__sent.push({ action: message.action, at: performance.now() });
            const result = window.__readAnswer ?? empty;
            queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, ok: true, result }) })));
        };
    })()`);
    await evaluate(
        "document.querySelector('#options-toggle').click(); document.querySelector('#editor-open').click();"
    );
    await waitFor("document.querySelector('.app').classList.contains('editing')");
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 405, deviceScaleFactor: 1, mobile: true });
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    // Editing keeps every enabled row (compact), the options button, and a usable trackpad above the field.
    const editingLayout = `(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        return {
            rows: [...document.querySelectorAll('.key-row')].filter((row) => !row.hidden).map((row) => row.dataset.row),
            optionsVisible: !document.querySelector('#options-toggle').hidden && box('#options-toggle').top >= 0,
            trackpad: Math.round(box('.trackpad').height),
            field: Math.round(box('textarea').height),
            fieldBottom: Math.round(box('textarea').bottom),
            height: innerHeight,
        };
    })()`;
    const settled = () =>
        waitFor("!document.querySelector('.input-dock').classList.contains('is-morphing')").then(() =>
            evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        );
    await settled();
    const bounds = await evaluate(editingLayout);
    assert.deepEqual(bounds.rows, ['edit', 'modifiers']);
    assert.equal(bounds.optionsVisible, true);
    assert.ok(bounds.fieldBottom <= bounds.height, 'The text field must stay on screen: ' + JSON.stringify(bounds));
    assert.ok(bounds.field < 45, 'An empty field shows one line: ' + bounds.field);
    // A long text grows the field while room is left, and shrinks it back to one line before the pad gets smaller.
    await evaluate(
        "document.querySelector('text-editor').render({ available: true, text: 'line\\n'.repeat(12), selectionStart: 0, selectionEnd: 0 })"
    );
    await settled();
    const tall = await evaluate(editingLayout);
    assert.ok(tall.field > bounds.field, 'A long text must grow the field: ' + JSON.stringify(tall));
    assert.ok(tall.trackpad >= 79, 'The trackpad keeps its minimum: ' + JSON.stringify(tall));
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 300, deviceScaleFactor: 1, mobile: true });
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    await settled();
    const squeezed = await evaluate(editingLayout);
    assert.ok(squeezed.trackpad >= 79, 'The trackpad keeps its minimum: ' + JSON.stringify(squeezed));
    assert.ok(squeezed.field < 45, 'The field gives way first, down to one line: ' + JSON.stringify(squeezed));
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 405, deviceScaleFactor: 1, mobile: true });
    await evaluate(
        "document.querySelector('text-editor').render({ available: true, text: '', selectionStart: 0, selectionEnd: 0 })"
    );
    const modifier = await evaluate(`(() => {
    const rows = document.querySelector('key-rows'), commands = [];
    const capture = event => { event.stopPropagation(); commands.push(event.detail); };
    rows.addEventListener('command', capture);
    const control = rows.querySelector('[data-key=Control]');
    // A tap activates Control; the next key uses it and releases it.
    control.click();
    const pressed = control.getAttribute('aria-pressed');
    rows.querySelector('[data-key=Tab]').click();
    rows.removeEventListener('command', capture);
    return { pressed, released: control.getAttribute('aria-pressed'), actions: commands.map(command => command.action), shortcut: commands[1].data };
  })()`);
    assert.deepEqual(modifier, {
        pressed: 'true',
        released: 'false',
        actions: ['key', 'shortcut', 'key'],
        shortcut: { key: 'Tab', modifiers: ['Control'] },
    });
    // Editing commands send their key with Control; the characters row sends plain letters.
    const shortcuts = await evaluate(`(() => {
        const rows = document.querySelector('key-rows'), sent = [];
        const capture = (event) => { event.stopPropagation(); sent.push(event.detail.data); };
        rows.addEventListener('command', capture);
        for (const key of ['Undo', 'Redo', 'Paste', 'Z']) rows.querySelector('[data-key=' + key + ']').click();
        rows.removeEventListener('command', capture);
        return sent;
    })()`);
    assert.deepEqual(shortcuts, [
        { key: 'Z', modifiers: ['Control'] },
        { key: 'Y', modifiers: ['Control'] },
        { key: 'V', modifiers: ['Control'] },
        { key: 'Z', modifiers: [] },
    ]);
    await evaluate(
        "document.querySelector('text-editor').render({ available: true, text: 'Ceci est un texte écrit ou récupéré depuis l’ordinateur. '.repeat(16), selectionStart: 0, selectionEnd: 0 }); document.querySelector('#connection-label').textContent = ''; document.querySelector('#connection').dataset.state = 'ready';"
    );
    await writeFile(
        path.join(output, 'browser-editor.png'),
        Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    );
    // Mirror polling: every 200 ms right after activity, slower once quiet, full speed again after a key. Reads
    // answer "unchanged", as a field nobody touches would.
    await evaluate('window.__readAnswer = { unchanged: true }');
    const readGaps = (since) =>
        evaluate(`(() => {
            const reads = window.__sent.filter(entry => entry.action === 'mirror-read' && entry.at >= ${since}).map(entry => entry.at);
            return reads.slice(1).map((at, index) => Math.round(at - reads[index]));
        })()`);
    await evaluate("document.dispatchEvent(new CustomEvent('text-key', { detail: { key: 'Escape' } }))");
    const activeFrom = await evaluate('performance.now()');
    await evaluate('new Promise(resolve => setTimeout(resolve, 1500))');
    const activeGaps = await readGaps(activeFrom);
    await evaluate('new Promise(resolve => setTimeout(resolve, 2500))');
    const quietFrom = await evaluate('performance.now()');
    await evaluate('new Promise(resolve => setTimeout(resolve, 2000))');
    const quietGaps = await readGaps(quietFrom);
    await evaluate("document.dispatchEvent(new CustomEvent('text-key', { detail: { key: 'Escape' } }))");
    const wokenFrom = await evaluate('performance.now()');
    await evaluate('new Promise(resolve => setTimeout(resolve, 1000))');
    const wokenGaps = await readGaps(wokenFrom);
    const median = (gaps) => [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    assert.ok(median(activeGaps) < 320, 'Active polling should run about every 200 ms: ' + activeGaps);
    assert.ok(median(quietGaps) >= 450, 'Quiet polling should slow down: ' + quietGaps);
    assert.ok(median(wokenGaps) < 320, 'Activity should restore fast polling: ' + wokenGaps);
    await evaluate('window.__readAnswer = null');
    report.push({ name: 'adaptive-polling', activeGaps, quietGaps, wokenGaps });
    // The blind-typing hint sits on the textarea's first line, while editing.
    const hint = await evaluate(`(() => {
        const editor = document.querySelector('text-editor');
        editor.classList.add('show-hint');
        const box = editor.querySelector('textarea').getBoundingClientRect(), text = editor.querySelector('.editor-hint').getBoundingClientRect();
        editor.classList.remove('show-hint');
        return { inside: text.top >= box.top && text.bottom <= box.bottom && text.left >= box.left && text.right <= box.right };
    })()`);
    assert.deepEqual(hint, { inside: true }, 'Editor hint must sit inside the textarea');
    // Editing follows the field's focus: controls keep it, a tap on the background lets it go and ends editing.
    const focusRules = await evaluate(`(async () => {
        const field = document.querySelector('textarea');
        // Only the page-wide listener's verdict matters: the control's own handler (pointer capture, gestures) would
        // fail on a synthetic pointer, so the event stops at the target.
        const tap = (element) => {
            const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
            element.addEventListener('pointerdown', (stop) => stop.stopImmediatePropagation(), { capture: true, once: true });
            element.dispatchEvent(event);
            return event.defaultPrevented;
        };
        const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
        const keyKeeps = tap(document.querySelector('key-rows [data-key=Tab]'));
        const padKeeps = tap(document.querySelector('.trackpad'));
        const optionsKeep = tap(document.querySelector('#options-toggle'));
        // A label toggles its checkbox without taking the focus from the field.
        const sticky = document.querySelector('[name=sticky]'), before = sticky.checked;
        sticky.closest('label').click();
        const labelToggles = sticky.checked !== before && document.activeElement === field;
        sticky.closest('label').click();
        // The focus taken by something else (not a background tap) comes back to the field.
        tap(document.querySelector('key-rows [data-key=Tab]'));
        field.blur();
        await tick();
        const refocused = document.activeElement === field && document.querySelector('.app').classList.contains('editing');
        const backgroundKeeps = tap(document.querySelector('.topbar'));
        field.blur();
        await tick();
        return { keyKeeps, padKeeps, optionsKeep, labelToggles, refocused, backgroundKeeps };
    })()`);
    assert.deepEqual(focusRules, {
        keyKeeps: true,
        padKeeps: true,
        optionsKeep: true,
        labelToggles: true,
        refocused: true,
        backgroundKeeps: false,
    });
    await waitFor("document.querySelector('text-editor').hidden");
    await evaluate(
        "const input = document.querySelector('[name=modifiers]'); input.checked = false; input.dispatchEvent(new Event('change')); document.querySelector('#editor-open').click()"
    );
    await waitFor("document.querySelector('.app').classList.contains('editing')");
    assert.deepEqual(
        await evaluate(
            "[...document.querySelectorAll('.key-row')].filter(row => !row.hidden).map(row => row.dataset.row)"
        ),
        ['edit']
    );
    const scroll = await evaluate(
        "(() => { const rail = document.querySelector('scroll-rail[axis=y] .rail-viewport'); const before = rail.scrollTop; rail.scrollTop += 300; return { before, after: rail.scrollTop, native: getComputedStyle(rail).overflowY }; })()"
    );
    assert.equal(scroll.after - scroll.before, 300);
    assert.equal(scroll.native, 'scroll');
    assert.ok(scroll.before > 65536, 'Native rails must start away from either edge');
    await evaluate(
        "document.querySelector('.topbar').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.activeElement.blur(); const sliding = document.querySelector('[name=mouseSliding]'); sliding.checked = true; sliding.dispatchEvent(new Event('change'));"
    );
    await page('Page.reload');
    await waitFor("document.querySelector('#connection').dataset.state === 'ready'");
    assert.equal(await evaluate("document.querySelector('[name=mouseSliding]').checked"), true);
    await evaluate(`window.padMoves = [];
        const pad = document.querySelector('pointer-pad');
        pad.addEventListener('motion', event => { event.stopPropagation(); window.padMoves.push(event.detail); });
        pad.addEventListener('command', event => event.stopPropagation());`);
    const padPoint = await evaluate(
        `(() => { const r = document.querySelector('.trackpad').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`
    );
    const swipe = async () => {
        await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [padPoint] });
        for (let step = 1; step <= 4; step++) {
            await new Promise((resolve) => setTimeout(resolve, 16));
            await page('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: padPoint.x + step * 15, y: padPoint.y }],
            });
        }
        await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe();
    const lifted = await evaluate('window.padMoves.length');
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
    assert.ok(
        (await evaluate('window.padMoves.length')) > lifted,
        'Enabled sliding must continue after finger release'
    );
    await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [padPoint] });
    const stopped = await evaluate('window.padMoves.length');
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
    assert.equal(await evaluate('window.padMoves.length'), stopped, 'New touch must stop the glide');
    await page('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await evaluate(
        "const sliding = document.querySelector('[name=mouseSliding]'); sliding.checked = false; sliding.dispatchEvent(new Event('change'));"
    );
    await swipe();
    const disabled = await evaluate('window.padMoves.length');
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
    assert.equal(await evaluate('window.padMoves.length'), disabled, 'Disabled sliding must stop at finger release');
    report.push({ name: 'mouse-sliding', persisted: true, glide: true, touchStops: true, disabledStops: true });
    assert.deepEqual(exceptions, []);
    report.push({ name: 'editor-reduced-viewport', ...bounds }, { name: 'native-scroll', ...scroll });
    await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    console.log('Screenshots and report: ' + output);
    await send('Browser.close');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    socket?.close();
    if (child.exitCode === null) child.kill();
    host.kill();
    // Chrome and the host release their files a moment after exiting.
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const directory of [hostData, profile])
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
