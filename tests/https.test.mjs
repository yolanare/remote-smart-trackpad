import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const privateAddress = Object.values(networkInterfaces())
    .flat()
    .find(
        (entry) => entry?.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)
    )?.address;

async function availablePort() {
    const listener = createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    return port;
}
const plain = (url) =>
    new Promise((resolve, reject) =>
        httpGet(url, (response) => {
            let body = '';
            response.on('data', (chunk) => (body += chunk));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        }).on('error', reject)
    );
const secure = (url, ca) =>
    new Promise((resolve, reject) =>
        httpsRequest(url, { ca }, (response) => {
            let body = '';
            response.on('data', (chunk) => (body += chunk));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        })
            .on('error', reject)
            .end()
    );

test(
    'the private network serves trusted HTTPS, redirects HTTP and hands out the local CA',
    { skip: !privateAddress && 'no private IPv4 address' },
    async (t) => {
        const directory = await mkdtemp(path.join(tmpdir(), 'remote-smart-trackpad-'));
        const port = await availablePort();
        const host = spawn(process.execPath, ['host/server.js'], {
            cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
            env: {
                ...process.env,
                REMOTE_SMART_TRACKPAD_PORT: String(port),
                REMOTE_SMART_TRACKPAD_DATA_DIRECTORY: directory,
            },
            stdio: 'ignore',
            windowsHide: true,
        });
        t.after(async () => {
            host.kill();
            await rm(directory, { recursive: true, force: true });
        });
        const base = `${privateAddress}:${port}`;
        let trust;
        for (let attempt = 0; attempt < 80 && !trust; attempt++) {
            trust = await plain(`http://${base}/trust`).catch(() => null);
            if (!trust) await new Promise((resolve) => setTimeout(resolve, 150));
        }
        assert.equal(trust?.status, 200);
        const redirect = await plain(`http://${base}/pair?x=1`);
        assert.equal(redirect.status, 308);
        assert.equal(redirect.headers.location, `https://${base}/pair?x=1`);
        const certificate = await plain(`http://${base}/remote-smart-trackpad-ca.crt`);
        assert.match(certificate.body, /BEGIN CERTIFICATE/);
        assert.equal(certificate.body, await readFile(path.join(directory, 'tls', 'ca.pem'), 'utf8'));
        // Validates against the local CA only (Node rejects untrusted certificates).
        const page = await secure(`https://${base}/`, certificate.body);
        assert.equal(page.status, 200);
        assert.match(page.body, /Remote Smart Trackpad/);
        assert.equal((await secure(`https://${base}/sw.js`, certificate.body)).status, 200);
        const names = await new Promise((resolve, reject) => {
            const socket = connect({ host: privateAddress, port, ca: certificate.body }, () => {
                resolve(socket.getPeerCertificate().subjectaltname);
                socket.end();
            }).on('error', reject);
        });
        assert.match(names, new RegExp(`IP Address:${privateAddress.replaceAll('.', '\\.')}`));
        assert.match(names, /DNS:remote-smart-trackpad-.*\.local/);
    // Browsers reject negative serial numbers (high bit of the first byte set).
    for (const file of ['ca.pem', 'cert.pem']) {
        const serial = new X509Certificate(await readFile(path.join(directory, 'tls', file))).serialNumber;
        assert.ok(serial.length % 2 === 0 && parseInt(serial.slice(0, 2), 16) < 0x80, `${file} serial ${serial}`);
    }
        const loopback = await plain(`http://127.0.0.1:${port}/api/setup`);
        assert.deepEqual(JSON.parse(loopback.body).trustUrls.includes(`http://${base}/trust`), true);
    }
);
