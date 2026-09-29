import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';

// Keep Figma's PNG export intact: its baked effects are the source of every size.
const png = await readFile(new URL('../web/icon-512.png', import.meta.url));
const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
if (width !== 512 || height !== 512) throw new Error('icon-512.png must be 512 x 512');
const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><image width="${width}" height="${height}" xlink:href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
const render = (size) => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render();
await writeFile(new URL('../web/icon-192.png', import.meta.url), render(192).asPng());

// Small Windows icons need a DIB with alpha and an AND mask for native tray rendering.
function iconBitmap(size) {
    const pixels = render(size).pixels;
    const maskStride = Math.ceil(size / 32) * 4;
    const pixelBytes = size * size * 4;
    const bitmap = Buffer.alloc(40 + pixelBytes + maskStride * size);
    bitmap.writeUInt32LE(40, 0);
    bitmap.writeInt32LE(size, 4);
    bitmap.writeInt32LE(size * 2, 8);
    bitmap.writeUInt16LE(1, 12);
    bitmap.writeUInt16LE(32, 14);
    bitmap.writeUInt32LE(pixelBytes, 20);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const from = (y * size + x) * 4;
            const row = size - 1 - y;
            const to = 40 + (row * size + x) * 4;
            bitmap[to] = pixels[from + 2];
            bitmap[to + 1] = pixels[from + 1];
            bitmap[to + 2] = pixels[from];
            bitmap[to + 3] = pixels[from + 3];
            if (pixels[from + 3] === 0) {
                bitmap[40 + pixelBytes + row * maskStride + (x >> 3)] |= 0x80 >> (x % 8);
            }
        }
    }
    return bitmap;
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => (size === 256 ? render(size).asPng() : iconBitmap(size)));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
images.forEach((image, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = sizes[index] % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.length;
});
await writeFile(new URL('../web/icon.ico', import.meta.url), Buffer.concat([directory, ...images]));

const revision = createHash('sha256').update(png).digest('hex').slice(0, 12);
for (const file of ['index.html', 'setup.html', 'manifest.webmanifest']) {
    const url = new URL('../web/' + file, import.meta.url);
    const content = await readFile(url, 'utf8');
    await writeFile(url, content.replace(/(icon-\d+\.png\?v=)[a-zA-Z0-9-]+/g, '$1' + revision));
}
