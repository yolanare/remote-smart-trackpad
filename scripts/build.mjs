import { build, context } from 'esbuild';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
const watching = process.argv.includes('--watch');
const revisionFile = 'web/dist/dev-build.json';
const options = {
    entryPoints: ['web/app.js'],
    bundle: true,
    format: 'esm',
    outdir: 'web/dist',
    assetNames: 'assets/[name]-[hash]',
    loader: { '.woff2': 'file', '.woff': 'file' },
    minify: true,
    lineLimit: 1000,
    target: ['chrome110', 'safari16'],
    metafile: true,
    logLevel: 'info',
    // Development builds reload open pages when a newer bundle exists (see devReload in web/app.js).
    define: { __DEV_RELOAD__: String(watching) },
    plugins: [
        {
            name: 'build-metadata',
            setup(build) {
                if (watching)
                    build.onLoad({ filter: /[\\/]web[\\/]app\.js$/ }, async ({ path }) => ({
                        contents: await readFile(path, 'utf8'),
                        loader: 'js',
                        watchFiles: ['web/index.html', 'web/manifest.webmanifest'],
                    }));
                build.onEnd(async (result) => {
                    if (result.errors.length) return;
                    await writeFile('web/dist/meta.json', JSON.stringify(result.metafile));
                    if (watching) await writeFile(revisionFile, JSON.stringify({ revision: crypto.randomUUID() }));
                });
            },
        },
    ],
};
// One watcher per checkout: it listens on a local channel (a named pipe on Windows), so a second `npm run watch`
// finds it and either asks it to stop and takes over, or cancels.
const checkout = createHash('sha1').update(path.resolve('.').toLowerCase()).digest('hex').slice(0, 12);
const channel =
    process.platform === 'win32' ?
        `\\\\.\\pipe\\remote-smart-trackpad-watch-${checkout}`
    :   path.join(tmpdir(), `remote-smart-trackpad-watch-${checkout}.sock`);
const connect = () =>
    new Promise((resolve) => {
        const socket = net.connect(channel);
        socket.once('connect', () => resolve(socket));
        socket.once('error', () => resolve(null));
    });
const ask = async (question) => {
    if (!process.stdin.isTTY) return false;
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const cancelled = new Promise((resolve) => prompt.once('SIGINT', () => resolve('')));
    const answer = await Promise.race([prompt.question(question), cancelled]);
    prompt.close();
    return /^y(es)?$/i.test(answer.trim());
};
const claimWatch = async () => {
    const other = await connect();
    if (other) {
        const takeOver = await ask(
            'Another watcher is already running (npm run watch). Stop it and continue in this terminal? [y/N] '
        );
        if (!takeOver) {
            other.destroy();
            console.log('Cancelled: the other watcher keeps running.');
            process.exit(1);
        }
        const closed = new Promise((resolve) => other.once('close', resolve));
        other.end('stop');
        await closed;
    } else if (process.platform !== 'win32') await rm(channel, { force: true });
    const server = net.createServer();
    // The other watcher may need a moment to release the channel after it exits.
    for (let attempt = 0; ; attempt++) {
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(channel, resolve);
            });
            return server;
        } catch (error) {
            if (error.code !== 'EADDRINUSE' || attempt >= 20) throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
};
if (watching) {
    const server = await claimWatch();
    const watcher = await context(options);
    await watcher.watch();
    // esbuild only watches files the bundle imports, and polls them; every save anywhere in web/ (HTML, setup and
    // trust pages, service worker, manifest…) must rebuild too, so open pages reload through dev-build.json.
    let pending;
    const files = watch('web', { recursive: true }, (event, name) => {
        if (!name || /^dist([\\/]|$)/.test(name)) return;
        clearTimeout(pending);
        pending = setTimeout(() => watcher.rebuild().catch(() => {}), 80);
    });
    const stop = async () => {
        files.close();
        await watcher.dispose();
        server.close();
        process.exit(0);
    };
    server.on('connection', (socket) => {
        socket.on('error', () => {});
        socket.on('data', (data) => {
            if (String(data).trim() !== 'stop') return;
            console.log('Stopped: a watcher started in another terminal took over.');
            stop();
        });
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
} else {
    await build(options);
    await rm(revisionFile, { force: true });
}
