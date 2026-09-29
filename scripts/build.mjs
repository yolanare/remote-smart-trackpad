import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const result = await build({
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
});
await writeFile('web/dist/meta.json', JSON.stringify(result.metafile));
