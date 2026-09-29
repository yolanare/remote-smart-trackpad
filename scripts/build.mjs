import { build, context } from 'esbuild';
import { readFile, writeFile, rm } from 'node:fs/promises';
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
    banner:
        watching ?
            {
                js: `(() => {
        let revision;
        async function check() {
            try {
                const response = await fetch('/dev-build.json', { cache: 'no-store' });
                if (!response.ok) return;
                const next = (await response.json()).revision;
                if (revision && next && next !== revision) location.reload();
                revision = next;
            } catch {}
        }
        check();
        setInterval(check, 1000);
    })();`,
            }
        :   undefined,
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
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, async () => {
            await watcher.dispose();
            process.exit(0);
        });
} else {
    await build(options);
    await rm(revisionFile, { force: true });
}
