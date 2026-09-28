import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const source = await readFile(new URL('../web/icon.svg', import.meta.url));
for (const size of [192, 512]) {
  const image = new Resvg(source, { fitTo: { mode: 'width', value: size } });
  await writeFile(new URL('../web/icon-' + size + '.png', import.meta.url), image.render().asPng());
}
