import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'vendor') continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(file);
    else if (/\.(m?js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
      if (result.status) process.exitCode = 1;
    }
  }
}
await Promise.all(['host', 'web', 'scripts'].map(check));
