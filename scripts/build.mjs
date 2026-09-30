import { build, context } from 'esbuild';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
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
if (watching) {
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
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, async () => {
            files.close();
            await watcher.dispose();
            process.exit(0);
        });
} else {
    await build(options);
    await rm(revisionFile, { force: true });
}
