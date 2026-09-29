import { createHash } from 'node:crypto';

export function createTransport({ authorized, hasAccess, command }) {
    const clients = new Set();
    let activeClient = null;
    function handleUpgrade(request, socket) {
        let pathname;
        let sameOrigin = false;
        try {
            pathname = new URL(request.url, 'http://localhost').pathname;
            const origin = new URL(request.headers.origin);
            sameOrigin =
                origin.host === request.headers.host
                && origin.protocol === (request.socket.encrypted ? 'https:' : 'http:');
        } catch {
            return socket.destroy();
        }
        if (
            pathname !== '/socket'
            || !sameOrigin
            || !authorized(request)
            || request.headers.upgrade?.toLowerCase() !== 'websocket'
        )
            return socket.destroy();
        const key = request.headers['sec-websocket-key'];
        if (!key) return socket.destroy();
        const accept = createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64');
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '
                + accept
                + '\r\n\r\n'
        );
        const client = {
            accessId: authorized(request).id,
            socket,
            buffer: Buffer.alloc(0),
            chain: Promise.resolve(),
            lastId: 0,
            queued: 0,
            lastPong: Date.now(),
            send(value) {
                if (socket.destroyed) return;
                const payload = Buffer.from(JSON.stringify(value));
                if (socket.writableLength > 2_000_000) return socket.destroy();
                let header;
                if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
                else if (payload.length <= 65_535)
                    header = Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
                else {
                    header = Buffer.alloc(10);
                    header[0] = 0x81;
                    header[1] = 127;
                    header.writeBigUInt64BE(BigInt(payload.length), 2);
                }
                socket.write(Buffer.concat([header, payload]));
            },
        };
        clients.add(client);
        if (activeClient && activeClient !== client) {
            activeClient.send({ type: 'status', state: 'another-device' });
            command('release').catch((error) =>
                console.error(`Could not release previous device input: ${error.message}`)
            );
        }
        activeClient = client;
        client.send({ type: 'status', state: 'ready' });
        const heartbeat = setInterval(() => {
            if (socket.destroyed) return;
            if (Date.now() - client.lastPong > 15_000) return socket.destroy();
            socket.write(Buffer.from([0x89, 0x00]));
        }, 5_000);
        socket.on('data', (data) => {
            client.buffer = Buffer.concat([client.buffer, data]);
            if (client.buffer.length > 2_000_000) return socket.destroy();
            while (client.buffer.length >= 2) {
                const opcode = client.buffer[0] & 15;
                const final = Boolean(client.buffer[0] & 128);
                const second = client.buffer[1];
                const lengthCode = second & 127;
                if (!(second & 128) || !final) return socket.destroy();
                const headerLength =
                    lengthCode === 127 ? 10
                    : lengthCode === 126 ? 4
                    : 2;
                if (client.buffer.length < headerLength + 4) break;
                const length =
                    lengthCode === 127 ? Number(client.buffer.readBigUInt64BE(2))
                    : lengthCode === 126 ? client.buffer.readUInt16BE(2)
                    : lengthCode;
                if (!Number.isSafeInteger(length) || length > 1_100_000) return socket.destroy();
                if (client.buffer.length < headerLength + 4 + length) break;
                const mask = client.buffer.subarray(headerLength, headerLength + 4);
                const payload = Buffer.from(client.buffer.subarray(headerLength + 4, headerLength + 4 + length));
                for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
                client.buffer = client.buffer.subarray(headerLength + 4 + length);
                if (opcode >= 8 && length > 125) return socket.destroy();
                if (opcode === 8) return socket.end(Buffer.from([0x88, 0x00]));
                if (opcode === 9) {
                    socket.write(Buffer.from([0x8a, payload.length, ...payload]));
                    continue;
                }
                if (opcode === 10) {
                    client.lastPong = Date.now();
                    continue;
                }
                if (opcode !== 1) return socket.destroy();
                let message;
                try {
                    message = JSON.parse(payload.toString('utf8'));
                } catch {
                    continue;
                }
                if (++client.queued > 64) return socket.destroy();
                client.chain = client.chain
                    .then(async () => {
                        if (!hasAccess(client.accessId)) return socket.destroy();
                        if (client !== activeClient)
                            return client.send({
                                type: 'ack',
                                id: message.id,
                                ok: false,
                                error: 'Another device is active',
                            });
                        if (!Number.isSafeInteger(message.id) || message.id <= client.lastId) return;
                        client.lastId = message.id;
                        const allowed = new Set([
                            'move',
                            'click',
                            'button',
                            'scroll',
                            'key',
                            'shortcut',
                            'release',
                            'mirror-read',
                            'mirror-edit',
                            'mirror-close',
                        ]);
                        if (!allowed.has(message.action))
                            return client.send({ type: 'ack', id: message.id, ok: false, error: 'Unknown command' });
                        try {
                            const result = await command(message.action, { data: message.data || {} });
                            client.send({
                                type: 'ack',
                                id: message.id,
                                ok: result.ok,
                                result: result.result,
                                error: result.error,
                                code: result.code,
                            });
                        } catch (error) {
                            client.send({ type: 'ack', id: message.id, ok: false, error: error.message });
                        }
                    })
                    .catch((error) => console.error(error))
                    .finally(() => {
                        client.queued--;
                    });
            }
        });
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            clearInterval(heartbeat);
            clients.delete(client);
            if (activeClient === client) {
                activeClient = null;
                command('mirror-close').catch(() => {});
            }
        };
        socket.on('close', release);
        socket.on('error', release);
    }
    return {
        handleUpgrade,
        notify(state) {
            for (const client of clients) client.send({ type: 'status', state });
        },
        revoke(id) {
            for (const client of clients) if (client.accessId === id) client.socket.destroy();
        },
        close() {
            for (const client of clients) client.socket.destroy();
        },
    };
}
