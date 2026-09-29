import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
await mkdir('.data', { recursive: true });
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const hostData = await mkdtemp(path.resolve('.data/browser-host-'));
const host = spawn(process.execPath, ['host/server.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, REMOTE_SMART_TRACKPAD_PORT: String(port), REMOTE_SMART_TRACKPAD_DATA_DIRECTORY: hostData, REMOTE_SMART_TRACKPAD_OPEN_SETUP: '0' } });
const url = 'http://127.0.0.1:' + port;
const profile = await mkdtemp(path.resolve('.data/chrome-probe-'));
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let errors = '';
child.stderr.on('data', chunk => { errors += chunk; });
let socket;
const exceptions = [];
try {
  let setup;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { setup = await (await fetch(url + '/api/setup')).json(); break; } catch {}
    if (host.exitCode !== null) throw new Error('Host exited: ' + host.exitCode);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(setup?.app, 'remote-smart-trackpad');
  let endpoint;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const [port, url] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); endpoint = 'ws://127.0.0.1:' + port + url; break; } catch {}
    if (child.exitCode !== null) throw new Error('Chrome exited: ' + child.exitCode + '\n' + errors.slice(-1600));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!endpoint) throw new Error('Chrome debugger unavailable\n' + errors.slice(-1600));
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text); const request = pending.get(message.id); if (request) { pending.delete(message.id); clearTimeout(request.timeout); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const next = ++id; const timeout = setTimeout(() => { pending.delete(next); reject(new Error('Timed out: ' + method)); }, 15000); pending.set(next, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: next, method, params, sessionId })); });
  console.log(JSON.stringify(await send('Browser.getVersion')));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page('Runtime.enable');
  await page('Page.enable');
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Page condition did not become true: ' + expression);
  };
  await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 711, deviceScaleFactor: 1, mobile: true });
  await page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page('Page.navigate', { url });
  await waitFor("document.querySelector('key-rows button') && !document.querySelector('#pairing').hidden");
  await evaluate("document.querySelector('#pair-name').value = 'Browser test'; document.querySelector('#pair-code').value = " + JSON.stringify(setup.pairingCode) + "; document.querySelector('#pair-form').requestSubmit();");
  await waitFor("document.querySelector('#connection').dataset.state === 'ready'");
  await evaluate('document.fonts.ready.then(() => true)');
  const typography = await evaluate("({ loaded: document.fonts.check('400 14px Inter') && document.fonts.check('500 12px Inter'), weight: getComputedStyle(document.querySelector('textarea')).fontWeight })");
  assert.equal(typography.loaded, true);
  assert.equal(typography.weight, '400');
  const report = [];
  await evaluate("document.querySelectorAll('#options input').forEach(input => { if (['functions','media'].includes(input.name)) { input.checked = true; input.dispatchEvent(new Event('change')); } });");
  for (const [name, width, height] of [['figma-main',375,711], ['landscape',844,390]]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    const dimensions = await evaluate('({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, keys: document.querySelectorAll("key-rows button").length, padHeight: document.querySelector(".trackpad").getBoundingClientRect().height })');
    assert.ok(dimensions.scrollWidth <= dimensions.width, 'Page overflow in ' + name);
    assert.ok(dimensions.padHeight > 0);
    const screenshot = await page('Page.captureScreenshot', { format: 'png' });
    await writeFile('.data/browser-' + name + '.png', Buffer.from(screenshot.data, 'base64'));
    report.push({ name, ...dimensions });
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 711, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelectorAll('#options input').forEach(input => { if (['functions','media'].includes(input.name)) { input.checked = false; input.dispatchEvent(new Event('change')); } }); document.querySelector('#options-toggle').click();");
  await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
  await writeFile('.data/browser-menu.png', Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate("document.querySelector('#options-toggle').click(); document.querySelector('#editor-open').click();");
  await waitFor("document.querySelector('.app').classList.contains('editing')");
  await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 405, deviceScaleFactor: 1, mobile: true });
  await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
  const bounds = await evaluate('(() => { const close = document.querySelector("#editor-close").getBoundingClientRect(); const keys = document.querySelector("key-rows").getBoundingClientRect(); return { closeTop: close.top, closeBottom: close.bottom, keysBottom: keys.bottom, height: innerHeight, rows: [...document.querySelectorAll(".key-row")].filter(row => !row.hidden).map(row => row.dataset.row) }; })()');
  assert.deepEqual(bounds.rows, ['modifiers']);
  assert.ok(bounds.closeTop >= 0 && bounds.closeBottom <= bounds.height);
  assert.ok(bounds.keysBottom <= bounds.height);
  const modifier = await evaluate(`(() => {
    const rows = document.querySelector('key-rows'), commands = [];
    const capture = event => { event.stopPropagation(); commands.push(event.detail); };
    rows.addEventListener('command', capture);
    const control = rows.querySelector('[data-key=Control]');
    control.click(); const pressed = control.getAttribute('aria-pressed');
    rows.querySelector('[data-key=Tab]').click();
    rows.removeEventListener('command', capture);
    return { pressed, released: control.getAttribute('aria-pressed'), actions: commands.map(command => command.action), shortcut: commands[1].data };
  })()`);
  assert.deepEqual(modifier, { pressed: 'true', released: 'false', actions: ['key', 'shortcut', 'key'], shortcut: { key: 'Tab', modifiers: ['Control'] } });
  await evaluate("document.querySelector('text-editor').render({ available: true, text: 'Ceci est un texte écrit ou récupéré depuis l’ordinateur. '.repeat(16), selectionStart: 0, selectionEnd: 0 }); document.querySelector('#connection-label').textContent = ''; document.querySelector('#connection').dataset.state = 'ready';");
  await writeFile('.data/browser-editor.png', Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate("document.querySelector('#editor-close').click()");
  assert.equal(await evaluate("document.querySelector('text-editor').hidden"), true);
  await evaluate("const input = document.querySelector('[name=modifiers]'); input.checked = false; input.dispatchEvent(new Event('change')); document.querySelector('#editor-open').click()");
  assert.equal(await evaluate("[...document.querySelectorAll('.key-row')].filter(row => !row.hidden).length"), 0);
  const scroll = await evaluate("(() => { const rail = document.querySelector('scroll-rail[axis=y] .rail-viewport'); const before = rail.scrollTop; rail.scrollTop += 300; return { before, after: rail.scrollTop, native: getComputedStyle(rail).overflowY }; })()");
  assert.equal(scroll.after - scroll.before, 300); assert.equal(scroll.native, 'scroll');
  assert.ok(scroll.before > 65536, 'Native rails must start away from either edge');
  assert.deepEqual(exceptions, []);
  report.push({ name: 'editor-reduced-viewport', ...bounds }, { name: 'native-scroll', ...scroll });
  await writeFile('.data/browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await send('Browser.close');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { socket?.close(); if (child.exitCode === null) child.kill(); host.kill(); }
