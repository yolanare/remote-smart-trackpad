import { build, context } from 'esbuild';
import { writeFile } from 'node:fs/promises';
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
    plugins: [
        {
            name: 'build-metadata',
            setup(build) {
                build.onEnd(async (result) => {
                    if (!result.errors.length) await writeFile('web/dist/meta.json', JSON.stringify(result.metafile));
                });
            },
        },
    ],
};
if (process.argv.includes('--watch')) {
    const watcher = await context(options);
    await watcher.watch();
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, async () => {
            await watcher.dispose();
            process.exit(0);
        });
} else {
    await build(options);
}
