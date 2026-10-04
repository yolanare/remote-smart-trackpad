// The PC's paired devices (host/access.js), through its stored file: a device record lacking what pairing gives it is
// dropped, so its phone pairs again like any new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAccessStore, tokenHash } from '../../host/access.js';

async function storeWith(records) {
    const directory = await mkdtemp(path.join(tmpdir(), 'remote-smart-trackpad-access-'));
    const file = path.join(directory, 'tokens.json');
    await writeFile(file, JSON.stringify(records));
    return { file, directory, store: await openAccessStore(file) };
}

test('a stored device without everything pairing gives it is forgotten; its phone pairs again', async () => {
    const paired = {
        id: 'a1b2c3d4e5f60718',
        hash: tokenHash('paired-token'),
        name: 'Pixel',
        firstConnectedAt: '2026-09-01T10:00:00.000Z',
    };
    const { file, directory, store } = await storeWith([
        paired,
        // A hash-only token from an old version, and records missing a name or a first connection.
        tokenHash('old-token'),
        { ...paired, id: 'unnamed0unnamed0', hash: tokenHash('unnamed-token'), name: null },
        { ...paired, id: 'undated00undated', hash: tokenHash('undated-token'), firstConnectedAt: null },
    ]);
    try {
        for (const token of ['old-token', 'unnamed-token', 'undated-token']) assert.equal(store.find(token), undefined);
        assert.equal(store.find('paired-token')?.name, 'Pixel');
        // Forgotten on the PC too, not only while this server runs.
        assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [paired]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('a newly paired device is stored with its name and first connection', async () => {
    const { directory, store } = await storeWith([]);
    try {
        const token = await store.add('  Galaxy  ');
        const [device] = store.list();
        assert.equal(store.find(token)?.id, device.id);
        assert.equal(device.name, 'Galaxy');
        assert.ok(!Number.isNaN(Date.parse(device.firstConnectedAt)));
        await assert.rejects(store.add(''), /name/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
