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
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
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
    await evaluate(
        "document.querySelectorAll('#options input').forEach(input => { if (['functions','media'].includes(input.name)) { input.checked = true; input.dispatchEvent(new Event('change')); } });"
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
        assert.ok(dimensions.padHeight > 0);
        const screenshot = await page('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(output, 'browser-' + name + '.png'), Buffer.from(screenshot.data, 'base64'));
        report.push({ name, ...dimensions });
    }
    // Auto-repeat: a held repeating key (Volume up) is sent again until released; a plain key (Escape) once.
    const holdKey = async (key, duration) => {
        const box = await evaluate(`(() => {
            window.__blocked = [];
            const rect = document.querySelector('key-rows [data-key="${key}"]').getBoundingClientRect();
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
    const repeated = await holdKey('VolumeUp', 900);
    assert.ok(repeated >= 4, 'A held Volume up must repeat, sent ' + repeated);
    assert.equal(await holdKey('Escape', 900), 1, 'A held Escape must be sent once');
    report.push({ name: 'auto-repeat', volumeUpHeld900ms: repeated, escapeHeld900ms: 1 });
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 711, deviceScaleFactor: 1, mobile: true });
    await evaluate(
        "document.querySelectorAll('#options input').forEach(input => { if (['functions','media'].includes(input.name)) { input.checked = false; input.dispatchEvent(new Event('change')); } }); document.querySelector('#options-toggle').click();"
    );
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    await writeFile(
        path.join(output, 'browser-menu.png'),
        Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    );
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
    await evaluate(
        "document.querySelector('#options-toggle').click(); document.querySelector('#editor-open').click();"
    );
    await waitFor("document.querySelector('.app').classList.contains('editing')");
    await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 405, deviceScaleFactor: 1, mobile: true });
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    const bounds = await evaluate(
        '(() => { const close = document.querySelector("#editor-close").getBoundingClientRect(); const keys = document.querySelector("key-rows").getBoundingClientRect(); return { closeTop: close.top, closeBottom: close.bottom, keysBottom: keys.bottom, height: innerHeight, rows: [...document.querySelectorAll(".key-row")].filter(row => !row.hidden).map(row => row.dataset.row) }; })()'
    );
    assert.deepEqual(bounds.rows, ['modifiers']);
    assert.ok(bounds.closeTop >= 0 && bounds.closeBottom <= bounds.height);
    assert.ok(bounds.keysBottom <= bounds.height);
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
    await evaluate(
        "document.querySelector('text-editor').render({ available: true, text: 'Ceci est un texte écrit ou récupéré depuis l’ordinateur. '.repeat(16), selectionStart: 0, selectionEnd: 0 }); document.querySelector('#connection-label').textContent = ''; document.querySelector('#connection').dataset.state = 'ready';"
    );
    await writeFile(
        path.join(output, 'browser-editor.png'),
        Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    );
    await evaluate("document.querySelector('#editor-close').click()");
    await waitFor("document.querySelector('text-editor').hidden");
    await evaluate(
        "const input = document.querySelector('[name=modifiers]'); input.checked = false; input.dispatchEvent(new Event('change')); document.querySelector('#editor-open').click()"
    );
    await waitFor("document.querySelector('.app').classList.contains('editing')");
    assert.equal(await evaluate("[...document.querySelectorAll('.key-row')].filter(row => !row.hidden).length"), 0);
    const scroll = await evaluate(
        "(() => { const rail = document.querySelector('scroll-rail[axis=y] .rail-viewport'); const before = rail.scrollTop; rail.scrollTop += 300; return { before, after: rail.scrollTop, native: getComputedStyle(rail).overflowY }; })()"
    );
    assert.equal(scroll.after - scroll.before, 300);
    assert.equal(scroll.native, 'scroll');
    assert.ok(scroll.before > 65536, 'Native rails must start away from either edge');
    await evaluate(
        "document.querySelector('#editor-close').click(); const sliding = document.querySelector('[name=mouseSliding]'); sliding.checked = true; sliding.dispatchEvent(new Event('change'));"
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
