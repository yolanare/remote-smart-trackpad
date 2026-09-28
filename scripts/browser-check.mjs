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
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page('Page.navigate', { url });
  await waitFor("document.querySelector('#pair-form') && document.querySelector('#key-grid').children.length > 0");
  await evaluate("document.querySelector('#pair-code').value = " + JSON.stringify(setup.pairingCode) + "; document.querySelector('#pair-form').requestSubmit();");
  await waitFor("document.querySelector('#connection').classList.contains('ready')");
  const report = [];
  for (const [name, width, height] of [['portrait',390,844], ['landscape',844,390]]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const dimensions = await evaluate('({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, keys: document.querySelector("#key-grid").children.length })');
    assert.ok(dimensions.scrollWidth <= dimensions.width, 'Page overflow in ' + name);
    const screenshot = await page('Page.captureScreenshot', { format: 'png' });
    await writeFile('.data/browser-' + name + '.png', Buffer.from(screenshot.data, 'base64'));
    report.push({ name, ...dimensions });
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 420, deviceScaleFactor: 1, mobile: true });
  await evaluate('document.querySelector("#editor-open").click()');
  await waitFor('!document.querySelector("#editor").classList.contains("hidden")');
  await waitFor('document.querySelector("#editor-status").textContent !== "Vérification du champ PC…"');
  const modifierState = await evaluate(`(() => {
    const editor = document.querySelector('#editor-text');
    const control = document.querySelector('[data-editor-key="Control"]');
    editor.focus(); control.click();
    const armed = control.classList.contains('armed') && control.getAttribute('aria-pressed') === 'true';
    control.click();
    const locked = control.classList.contains('locked');
    control.click();
    return { armed, locked, released: control.getAttribute('aria-pressed') === 'false', focused: document.activeElement === editor };
  })()`);
  assert.deepEqual(modifierState, { armed: true, locked: true, released: true, focused: true });
  const editorBounds = await evaluate('(() => { const close = document.querySelector("#editor-close").getBoundingClientRect(); const tools = document.querySelector(".editor-tools").getBoundingClientRect(); return { closeTop: close.top, closeBottom: close.bottom, toolsBottom: tools.bottom, height: innerHeight }; })()');
  assert.ok(editorBounds.closeTop >= 0 && editorBounds.closeBottom <= editorBounds.height);
  assert.ok(editorBounds.toolsBottom <= editorBounds.height, 'Editor tools hidden below viewport');
  const screenshot = await page('Page.captureScreenshot', { format: 'png' });
  await writeFile('.data/browser-editor.png', Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(exceptions, []);
  report.push({ name: 'editor-reduced-viewport', ...editorBounds });
  await writeFile('.data/browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await send('Browser.close');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { socket?.close(); if (child.exitCode === null) child.kill(); host.kill(); }
