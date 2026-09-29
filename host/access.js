import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';

export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }

export async function openAccessStore(file) {
  let records;
  try { records = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; records = []; }
  if (!Array.isArray(records)) throw new Error('Invalid token store');
  records = records.map(record => typeof record === 'string'
    ? { id: randomBytes(8).toString('hex'), hash: record, name: null, firstConnectedAt: null }
    : record);
  let writing = Promise.resolve();
  function change(update) {
    const operation = writing.then(async () => {
      const next = update(records);
      await writeFile(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(file + '.tmp', file);
      records = next;
    });
    writing = operation.catch(() => {});
    return operation;
  }
  await change(current => current);
  return {
    find(token) { return typeof token === 'string' ? records.find(record => record.hash === tokenHash(token)) : undefined; },
    list() { return records.map(({ hash, ...record }) => record); },
    async add(name) {
      name = validateName(name);
      const token = randomBytes(32).toString('hex');
      await change(current => [...current, { id: randomBytes(8).toString('hex'), hash: tokenHash(token), name, firstConnectedAt: new Date().toISOString() }]);
      return token;
    },
    async identify(id, name) {
      name = validateName(name);
      await change(current => current.map(record => record.id === id ? { ...record, name, firstConnectedAt: record.firstConnectedAt ?? new Date().toISOString() } : record));
    },
    async remove(id) { await change(current => current.filter(record => record.id !== id)); }
  };
}

function validateName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Enter a name between 1 and 80 characters');
  return value.trim();
}
