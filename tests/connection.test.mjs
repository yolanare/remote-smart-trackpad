import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function availablePort() {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function waitForServer(url, process) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (process.exitCode !== null) throw new Error(`Host exited with ${process.exitCode}`);
    try {
      const response = await fetch(`${url}/api/setup`);
      if (response.ok) return response.json();
    } catch { /* The listener has not started yet. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Host did not start');
}

function openSocket(url, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url.replace('http', 'ws') + `/socket?token=${token}`, { headers: { Origin: url } });
    socket.onerror = reject;
    socket.onmessage = event => {
      const status = JSON.parse(event.data);
      if (status.type === 'status' && status.state === 'ready') resolve(socket);
    };
  });
}

function exchange(socket, command) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No command acknowledgement')), 10_000);
    socket.onmessage = event => {
      const response = JSON.parse(event.data);
      if (response.type === 'ack' && response.id === command.id) {
        clearTimeout(timeout);
        resolve(response);
      }
    };
    socket.send(JSON.stringify(command));
  });
}

test('a paired phone can reconnect and receives command acknowledgements', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'remote-smart-trackpad-'));
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const host = spawn(process.execPath, ['host/server.js'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, REMOTE_SMART_TRACKPAD_PORT: String(port), REMOTE_SMART_TRACKPAD_DATA_DIRECTORY: directory },
    stdio: 'ignore', windowsHide: true
  });
  t.after(async () => {
    host.kill();
    await rm(directory, { recursive: true, force: true });
  });
  const setup = await waitForServer(url, host);
  assert.equal(setup.app, 'remote-smart-trackpad');
  const invalid = await fetch(`${url}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: setup.pairingCode + '9' }) });
  assert.equal(invalid.status, 403);
  const paired = await fetch(`${url}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: setup.pairingCode }) });
  assert.equal(paired.status, 200);
  const { token } = await paired.json();
  const authorized = await fetch(`${url}/api/status`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(authorized.status, 200);
  await new Promise((resolve, reject) => {
    const invalidOrigin = new WebSocket(url.replace('http', 'ws') + `/socket?token=${token}`, { headers: { Origin: 'invalid-origin' } });
    const timeout = setTimeout(() => reject(new Error('Invalid origin was not rejected')), 2000);
    invalidOrigin.onopen = () => { clearTimeout(timeout); reject(new Error('Invalid origin was accepted')); };
    invalidOrigin.onerror = () => { clearTimeout(timeout); resolve(); };
  });
  assert.equal((await fetch(`${url}/api/status`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  const socket = await openSocket(url, token);
  assert.equal((await exchange(socket, { id: 1, action: 'release', data: {} })).ok, true);
  const large = await exchange(socket, { id: 2, action: 'invalid', data: { content: 'x'.repeat(70_000) } });
  assert.equal(large.ok, false);
  const invalidShortcut = await exchange(socket, { id: 3, action: 'shortcut', data: { key: 'Tab', modifiers: ['not-a-modifier'] } });
  assert.equal(invalidShortcut.ok, false);
  assert.equal(invalidShortcut.error, 'Unsupported shortcut modifier');
  assert.equal((await exchange(socket, { id: 4, action: 'release', data: {} })).ok, true);
  socket.close();
  const reconnected = await openSocket(url, token);
  assert.equal((await exchange(reconnected, { id: 1, action: 'release', data: {} })).ok, true);
  reconnected.close();
});
