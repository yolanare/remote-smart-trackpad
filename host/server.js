import http from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.REMOTE_SMART_TRACKPAD_PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('REMOTE_SMART_TRACKPAD_PORT must be a valid TCP port');
const dataDirectory = path.join(root, '.data');
await mkdir(dataDirectory, { recursive: true });
const tokenFile = path.join(dataDirectory, 'tokens.json');
let tokens = new Set(JSON.parse(await readFile(tokenFile, 'utf8').catch(() => '[]')));
let pairingCode = String(randomInt(100000, 1000000));
let pairingExpires = Date.now() + 10 * 60_000;
function refreshPairingCode() {
  pairingCode = String(randomInt(100000, 1000000));
  pairingExpires = Date.now() + 10 * 60_000;
  console.log(`Pairing code: ${pairingCode} (10 minutes)`);
}
const pairingAttempts = new Map();
const clients = new Set();
let activeClient = null;
let sequence = 0;
const pending = new Map();

const bridge = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'host', 'windows-bridge.ps1')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
let bridgeBuffer = '';
bridge.stdout.setEncoding('utf8');
bridge.stdout.on('data', chunk => {
  bridgeBuffer += chunk;
  for (let end; (end = bridgeBuffer.indexOf('\n')) >= 0;) {
    const line = bridgeBuffer.slice(0, end).trim();
    bridgeBuffer = bridgeBuffer.slice(end + 1);
    if (!line) continue;
    try {
      const result = JSON.parse(line);
      const request = pending.get(result.id);
      if (request) { pending.delete(result.id); request.resolve(result); }
    } catch (error) { console.error('Bridge response error:', error.message); }
  }
});
bridge.on('exit', code => {
  console.error(`Windows bridge stopped (${code}). Restart the server.`);
  for (const request of pending.values()) request.reject(new Error('Windows bridge stopped'));
  pending.clear();
  for (const client of clients) client.send({ type: 'status', state: 'unavailable' });
});

function command(action, data = {}) {
  if (bridge.exitCode !== null) return Promise.reject(new Error('Windows bridge unavailable'));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Windows did not respond')); }, 5000);
    pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
    bridge.stdin.write(JSON.stringify({ id, action, ...data }) + '\n');
  });
}

function authorized(request) {
  const token = request.headers.authorization?.replace(/^Bearer /, '') || new URL(request.url, 'http://localhost').searchParams.get('token');
  return token && tokens.has(createHash('sha256').update(token).digest('hex'));
}
async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 65_536) throw new Error('Request too large');
  }
  return JSON.parse(body || '{}');
}
function json(response, code, value) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
const staticFiles = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']], ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']], ['/setup', ['setup.html', 'text/html']],
  ['/setup.js', ['setup.js', 'text/javascript']], ['/setup.css', ['setup.css', 'text/css']],
  ['/vendor/qrcode.min.js', ['vendor/qrcode.min.js', 'text/javascript']]
]);

const isLoopback = request => request.socket.remoteAddress === '127.0.0.1' || request.socket.remoteAddress === '::1' || request.socket.remoteAddress === '::ffff:127.0.0.1';
function privateUrls() {
  const urls = [];
  for (const entries of Object.values(networkInterfaces())) for (const address of entries || []) {
    const value = address.address;
    if (address.family === 'IPv4' && (/^10\./.test(value) || /^192\.168\./.test(value) || /^172\.(1[6-9]|2\d|3[01])\./.test(value))) urls.push(`http://${value}:${port}/`);
  }
  return [...new Set(urls)];
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/setup' || pathname === '/setup.js' || pathname === '/setup.css' || pathname === '/vendor/qrcode.min.js' || pathname.startsWith('/api/setup')) {
      if (!isLoopback(request)) return json(response, 403, { error: 'Setup is available on the PC only' });
    }
    if (request.method === 'GET' && pathname === '/api/setup') {
      return json(response, 200, { urls: privateUrls(), pairingCode: Date.now() < pairingExpires ? pairingCode : null, pairingExpires });
    }
    if (request.method === 'POST' && pathname === '/api/setup/refresh') {
      refreshPairingCode();
      return json(response, 200, { pairingCode, pairingExpires });
    }
    if (request.method === 'POST' && pathname === '/api/pair') {
      const address = request.socket.remoteAddress || 'unknown';
      const attempts = pairingAttempts.get(address) || { count: 0, until: Date.now() + 60_000 };
      if (Date.now() > attempts.until) { attempts.count = 0; attempts.until = Date.now() + 60_000; }
      if (++attempts.count > 8) return json(response, 429, { error: 'Too many attempts. Try again in one minute.' });
      pairingAttempts.set(address, attempts);
      const { code } = await readBody(request);
      if (Date.now() > pairingExpires || !timingSafeEqual(Buffer.from(String(code || '').padEnd(6).slice(0, 6)), Buffer.from(pairingCode))) return json(response, 403, { error: 'Pairing code expired or incorrect' });
      const token = randomBytes(32).toString('hex');
      tokens.add(createHash('sha256').update(token).digest('hex'));
      await writeFile(tokenFile, JSON.stringify([...tokens]), { mode: 0o600 });
      refreshPairingCode();
      pairingAttempts.delete(address);
      return json(response, 200, { token });
    }
    if (pathname === '/api/status') return json(response, authorized(request) ? 200 : 401, authorized(request) ? { state: bridge.exitCode === null ? 'ready' : 'unavailable' } : { error: 'Pairing required' });
    if (request.method === 'GET' && staticFiles.has(pathname)) {
      const [name, contentType] = staticFiles.get(pathname);
      const file = await readFile(path.join(root, 'web', name));
      response.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws:; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'" });
      return response.end(file);
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) { json(response, 400, { error: error.message }); }
});

server.on('upgrade', (request, socket) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const origin = request.headers.origin;
  if (pathname !== '/socket' || !authorized(request) || !origin || new URL(origin).host !== request.headers.host || request.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
  const key = request.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const client = {
    socket, buffer: Buffer.alloc(0), chain: Promise.resolve(), lastId: 0,
    send(value) {
      if (socket.destroyed) return;
      const payload = Buffer.from(JSON.stringify(value));
      const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
      socket.write(Buffer.concat([header, payload]));
    }
  };
  clients.add(client);
  if (activeClient && activeClient !== client) activeClient.send({ type: 'status', state: 'another-device' });
  activeClient = client;
  client.send({ type: 'status', state: 'ready' });
  socket.on('data', data => {
    client.buffer = Buffer.concat([client.buffer, data]);
    while (client.buffer.length >= 2) {
      const opcode = client.buffer[0] & 15;
      const final = Boolean(client.buffer[0] & 128);
      const second = client.buffer[1];
      const lengthCode = second & 127;
      if (!(second & 128) || lengthCode === 127 || !final) return socket.destroy();
      const headerLength = lengthCode === 126 ? 4 : 2;
      if (client.buffer.length < headerLength + 4) break;
      const length = lengthCode === 126 ? client.buffer.readUInt16BE(2) : lengthCode;
      if (length > 65_536) return socket.destroy();
      if (client.buffer.length < headerLength + 4 + length) break;
      const mask = client.buffer.subarray(headerLength, headerLength + 4);
      const payload = Buffer.from(client.buffer.subarray(headerLength + 4, headerLength + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
      client.buffer = client.buffer.subarray(headerLength + 4 + length);
      if (opcode === 8) return socket.end(Buffer.from([0x88, 0x00]));
      if (opcode === 9) { socket.write(Buffer.from([0x8a, payload.length, ...payload])); continue; }
      if (opcode !== 1) return socket.destroy();
      let message;
      try { message = JSON.parse(payload.toString('utf8')); } catch { continue; }
      client.chain = client.chain.then(async () => {
        if (client !== activeClient) return client.send({ type: 'ack', id: message.id, ok: false, error: 'Another device is active' });
        if (!Number.isSafeInteger(message.id) || message.id <= client.lastId) return;
        client.lastId = message.id;
        const allowed = new Set(['move', 'click', 'button', 'scroll', 'key', 'open', 'edit', 'close', 'release']);
        if (!allowed.has(message.action)) return client.send({ type: 'ack', id: message.id, ok: false, error: 'Unknown command' });
        try {
          const result = await command(message.action, { data: message.data || {} });
          client.send({ type: 'ack', id: message.id, ok: result.ok, result: result.result, error: result.error });
        } catch (error) { client.send({ type: 'ack', id: message.id, ok: false, error: error.message }); }
      }).catch(error => console.error(error));
    }
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clients.delete(client);
    if (activeClient === client) { activeClient = null; command('release').catch(() => {}); }
  };
  socket.on('close', release);
  socket.on('error', release);
});

const localAddresses = ['127.0.0.1', ...privateUrls().map(url => new URL(url).hostname)];
for (const address of [...new Set(localAddresses)]) {
  const listener = address === localAddresses[0] ? server : http.createServer(server.listeners('request')[0]);
  if (listener !== server) listener.on('upgrade', server.listeners('upgrade')[0]);
  listener.listen(port, address, () => {
    console.log(`Open http://${address}:${port}/`);
    if (address === '127.0.0.1' && process.env.REMOTE_SMART_TRACKPAD_OPEN_SETUP === '1') {
      const browser = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process 'http://127.0.0.1:${port}/setup'`], { stdio: 'ignore', windowsHide: true });
      browser.on('error', error => console.error(`Could not open setup page: ${error.message}`));
    }
  });
  listener.on('error', error => console.error(`Cannot listen on ${address}:${port}: ${error.message}`));
}
console.log(`Pairing code: ${pairingCode} (10 minutes)`);
