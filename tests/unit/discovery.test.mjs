import test from 'node:test';
import assert from 'node:assert/strict';
import { answersFor, discoveryHost, discoveryRecords } from '../../host/discovery.js';

test('mDNS resolves only the advertised private listener and publishes its HTTP port', () => {
    const records = discoveryRecords('192.168.1.42', 8765);
    const address = answersFor([{ name: discoveryHost, type: 'A' }], records);
    assert.deepEqual(
        address.answers.map((record) => record.data),
        ['192.168.1.42']
    );

    const service = answersFor([{ name: '_http._tcp.local', type: 'PTR' }], records);
    assert.equal(service.answers.length, 1);
    assert.equal(service.additionals.find((record) => record.type === 'SRV').data.port, 8765);
    assert.equal(service.additionals.find((record) => record.type === 'A').data, '192.168.1.42');
    assert.equal(answersFor([{ name: 'unrelated.local', type: 'A' }], records), null);

    const secureRecords = discoveryRecords('192.168.1.42', 8765, 'https');
    assert.equal(answersFor([{ name: '_https._tcp.local', type: 'PTR' }], secureRecords).answers.length, 1);
    assert.equal(answersFor([{ name: '_http._tcp.local', type: 'PTR' }], secureRecords), null);
});
