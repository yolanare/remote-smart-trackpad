import http from 'node:http';
import https from 'node:https';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { discoveryHost, startDiscovery } from './discovery.js';
import { openAccessStore } from './access.js';
import { startBridge } from './bridge.js';
import { createTransport } from './transport.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.REMOTE_SMART_TRACKPAD_PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('REMOTE_SMART_TRACKPAD_PORT must be a valid TCP port');
const dataDirectory = process.env.REMOTE_SMART_TRACKPAD_DATA_DIRECTORY || path.join(root, '.data');
await mkdir(dataDirectory, { recursive: true });
const certificate = await readFile(path.join(dataDirectory, 'tls', 'cert.pem')).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
});
const privateKey = await readFile(path.join(dataDirectory, 'tls', 'key.pem')).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
});
if (Boolean(certificate) !== Boolean(privateKey))
    throw new Error('Both tls/cert.pem and tls/key.pem are required for HTTPS');
const tlsOptions = certificate ? { cert: certificate, key: privateKey } : null;
const privateProtocol = tlsOptions ? 'https' : 'http';
const tokenFile = path.join(dataDirectory, 'tokens.json');
const access = await openAccessStore(tokenFile);
let pairingCode = String(randomInt(100000, 1000000));
let pairingExpires = Date.now() + 10 * 60_000;
function refreshPairingCode() {
    pairingCode = String(randomInt(100000, 1000000));
    pairingExpires = Date.now() + 10 * 60_000;
    console.log(`Pairing code: ${pairingCode} (10 minutes)`);
}
const pairingAttempts = new Map();
const bridge = startBridge(path.join(root, 'host', 'windows-bridge.ps1'), (error) => {
    console.error(error.message);
    transport.notify('unavailable');
});
const command = (action, data) => bridge.command(action, data);

function authorized(request) {
    const token =
        request.headers.authorization?.replace(/^Bearer /, '')
        || new URL(request.url, 'http://localhost').searchParams.get('token');
    return access.find(token);
}
async function readBody(request) {
    request.setEncoding('utf8');
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
    ['/', ['index.html', 'text/html']],
    ['/app.js', ['dist/app.js', 'text/javascript']],
    ['/style.css', ['dist/app.css', 'text/css']],
    ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
    ['/setup', ['setup.html', 'text/html']],
    ['/icon-192.png', ['icon-192.png', 'image/png']],
    ['/icon-512.png', ['icon-512.png', 'image/png']],
    ['/setup.js', ['setup.js', 'text/javascript']],
    ['/setup.css', ['setup.css', 'text/css']],
    ['/vendor/qrcode.min.js', ['vendor/qrcode.min.js', 'text/javascript']],
]);

const isLoopback = (request) =>
    request.socket.remoteAddress === '127.0.0.1'
    || request.socket.remoteAddress === '::1'
    || request.socket.remoteAddress === '::ffff:127.0.0.1';
const listeningAddresses = new Set();
const discoveryStops = new Map();
const discoveryReady = new Set();
const discoveryRetryAt = new Map();
function privateAddresses() {
    const addresses = [];
    for (const entries of Object.values(networkInterfaces()))
        for (const address of entries || []) {
            const value = address.address;
            if (
                address.family === 'IPv4'
                && (/^10\./.test(value) || /^192\.168\./.test(value) || /^172\.(1[6-9]|2\d|3[01])\./.test(value))
            )
                addresses.push(value);
        }
    return [...new Set(addresses)];
}
function privateUrls() {
    return [...listeningAddresses]
        .filter((address) => address !== '127.0.0.1')
        .map((address) => privateProtocol + '://' + address + ':' + port + '/');
}

function discoveryUrl() {
    return discoveryReady.size ? privateProtocol + '://' + discoveryHost + ':' + port + '/' : null;
}

const server = http.createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (
            pathname === '/setup'
            || pathname === '/setup.js'
            || pathname === '/setup.css'
            || pathname === '/vendor/qrcode.min.js'
            || pathname.startsWith('/api/setup')
        ) {
            if (!isLoopback(request)) return json(response, 403, { error: 'Setup is available on the PC only' });
        }
        if (pathname === '/api/setup/tokens') {
            if (request.method === 'GET') return json(response, 200, access.list());
            if (request.method !== 'DELETE' || request.headers['x-trackpad-local'] !== '1' || request.headers.origin)
                return json(response, 403, { error: 'Use the local token manager' });
            const { id } = await readBody(request);
            await access.remove(id);
            transport.revoke(id);
            return json(response, 200, access.list());
        }
        if (request.method === 'POST' && pathname === '/api/profile') {
            const record = authorized(request);
            if (!record) return json(response, 401, { error: 'Pairing required' });
            await access.identify(record.id, (await readBody(request)).name);
            return json(response, 200, { ok: true });
        }
        if (request.method === 'GET' && pathname === '/api/setup') {
            return json(response, 200, {
                app: 'remote-smart-trackpad',
                urls: privateUrls(),
                discoveryUrl: discoveryUrl(),
                pairingCode: Date.now() < pairingExpires ? pairingCode : null,
                pairingExpires,
            });
        }
        if (request.method === 'POST' && pathname === '/api/setup/refresh') {
            refreshPairingCode();
            return json(response, 200, { pairingCode, pairingExpires });
        }
        if (request.method === 'POST' && pathname === '/api/pair') {
            const address = request.socket.remoteAddress || 'unknown';
            const attempts = pairingAttempts.get(address) || { count: 0, until: Date.now() + 60_000 };
            if (Date.now() > attempts.until) {
                attempts.count = 0;
                attempts.until = Date.now() + 60_000;
            }
            if (++attempts.count > 8)
                return json(response, 429, { error: 'Too many attempts. Try again in one minute.' });
            pairingAttempts.set(address, attempts);
            const { code, name } = await readBody(request);
            if (
                Date.now() > pairingExpires
                || !/^[0-9]{6}$/.test(String(code))
                || !timingSafeEqual(Buffer.from(String(code)), Buffer.from(pairingCode))
            )
                return json(response, 403, { error: 'Pairing code expired or incorrect' });
            const token = await access.add(name);
            refreshPairingCode();
            pairingAttempts.delete(address);
            return json(response, 200, { token });
        }
        if (pathname === '/api/status')
            return json(
                response,
                authorized(request) ? 200 : 401,
                authorized(request) ?
                    { state: bridge.available ? 'ready' : 'unavailable', needsName: !authorized(request).name }
                :   { error: 'Pairing required' }
            );
        if (request.method === 'GET' && /^\/assets\/[a-zA-Z0-9_.-]+\.woff2?$/.test(pathname)) {
            const file = await readFile(path.join(root, 'web', 'dist', pathname));
            response.writeHead(200, {
                'Content-Type': pathname.endsWith('.woff2') ? 'font/woff2' : 'font/woff',
                'Cache-Control': 'public, max-age=86400',
            });
            return response.end(file);
        }
        if (request.method === 'GET' && staticFiles.has(pathname)) {
            const [name, contentType] = staticFiles.get(pathname);
            const file = await readFile(path.join(root, 'web', name));
            response.writeHead(200, {
                'Content-Type': contentType.startsWith('image/') ? contentType : contentType + '; charset=utf-8',
                'Cache-Control': 'no-cache',
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy':
                    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
            });
            return response.end(file);
        }
        json(response, 404, { error: 'Not found' });
    } catch (error) {
        json(response, 400, { error: error.message });
    }
});

const transport = createTransport({
    authorized,
    hasAccess: (id) => access.list().some((record) => record.id === id),
    command,
});
server.on('upgrade', transport.handleUpgrade);

const listeners = new Map();
function stopDiscovery(address) {
    discoveryReady.delete(address);
    const stop = discoveryStops.get(address);
    discoveryStops.delete(address);
    stop?.();
}
function ensureDiscovery(address) {
    if (address === '127.0.0.1' || discoveryStops.has(address) || Date.now() < (discoveryRetryAt.get(address) || 0))
        return;
    try {
        const stop = startDiscovery(
            address,
            port,
            privateProtocol,
            () => {
                if (listeningAddresses.has(address) && discoveryStops.has(address)) {
                    discoveryReady.add(address);
                    console.log('mDNS: ' + discoveryUrl());
                }
            },
            (error) => {
                console.warn('mDNS unavailable on ' + address + ': ' + error.message);
                discoveryRetryAt.set(address, Date.now() + 60_000);
                stopDiscovery(address);
            }
        );
        discoveryStops.set(address, stop);
    } catch (error) {
        console.warn('mDNS unavailable on ' + address + ': ' + error.message);
        discoveryRetryAt.set(address, Date.now() + 60_000);
    }
}
function startListener(address) {
    if (listeners.has(address)) return;
    const listener =
        address === '127.0.0.1' ? server
        : tlsOptions ? https.createServer(tlsOptions, server.listeners('request')[0])
        : http.createServer(server.listeners('request')[0]);
    listeners.set(address, listener);
    if (listener !== server) listener.on('upgrade', server.listeners('upgrade')[0]);
    listener.listen(port, address, () => {
        listeningAddresses.add(address);
        ensureDiscovery(address);
        console.log(
            'Open ' + (address === '127.0.0.1' ? 'http' : privateProtocol) + '://' + address + ':' + port + '/'
        );
        if (address === '127.0.0.1' && process.env.REMOTE_SMART_TRACKPAD_OPEN_SETUP === '1') {
            const browser = spawn(
                'powershell.exe',
                ['-NoProfile', '-Command', `Start-Process 'http://127.0.0.1:${port}/setup'`],
                { stdio: 'ignore', windowsHide: true }
            );
            browser.on('error', (error) => console.error(`Could not open setup page: ${error.message}`));
        }
    });
    listener.on('error', (error) => {
        listeners.delete(address);
        listeningAddresses.delete(address);
        stopDiscovery(address);
        console.error(`Cannot listen on ${address}:${port}: ${error.message}`);
        if (address === '127.0.0.1') {
            bridge.stop();
            process.exit(1);
        }
    });
}
function syncListeners() {
    const desired = new Set(['127.0.0.1', ...privateAddresses()]);
    for (const address of desired) startListener(address);
    for (const address of listeningAddresses) ensureDiscovery(address);
    for (const [address, listener] of listeners)
        if (!desired.has(address)) {
            listeningAddresses.delete(address);
            listeners.delete(address);
            stopDiscovery(address);
            listener.close();
        }
}
syncListeners();
const listenerTimer = setInterval(syncListeners, 10_000);
console.log(`Pairing code: ${pairingCode} (10 minutes)`);
let stopping = false;
async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(listenerTimer);
    transport.close();
    for (const stop of discoveryStops.values()) stop();
    for (const listener of listeners.values()) listener.close();
    await command('mirror-close').catch(() => {});
    bridge.stop();
    process.exit(0);
}
createInterface({ input: process.stdin }).on('line', (line) => {
    if (line === 'shutdown') shutdown();
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
