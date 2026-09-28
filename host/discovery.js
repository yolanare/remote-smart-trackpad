import multicastDns from 'multicast-dns';
import { hostname } from 'node:os';

const machineLabel = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32).replace(/^-+|-+$/g, '') || 'windows';
export const discoveryHost = 'remote-smart-trackpad-' + machineLabel + '.local';

export function discoveryRecords(address, port, protocol = 'http', ttl = 120) {
  const serviceType = '_' + protocol + '._tcp.local';
  const instance = 'Remote Smart Trackpad (' + machineLabel + ').' + serviceType;
  return [
    { name: '_services._dns-sd._udp.local', type: 'PTR', ttl, data: serviceType },
    { name: serviceType, type: 'PTR', ttl, data: instance },
    { name: instance, type: 'SRV', ttl, flush: true, data: { port, target: discoveryHost } },
    { name: instance, type: 'TXT', ttl, flush: true, data: ['app=remote-smart-trackpad'] },
    { name: discoveryHost, type: 'A', ttl, flush: true, data: address }
  ];
}

export function answersFor(questions, records) {
  const serviceType = records[0].data;
  const instance = records[1].data;
  const requested = questions.flatMap(question => records.filter(record =>
    record.name.toLowerCase() === question.name.replace(/\.$/, '').toLowerCase() &&
    (question.type === 'ANY' || question.type === record.type)
  ));
  if (!requested.length) return null;
  const needsService = requested.some(record => record.type === 'PTR' && record.name === serviceType);
  const needsAddress = needsService || requested.some(record => record.type === 'SRV');
  return {
    answers: requested,
    additionals: records.filter(record =>
      (needsService && record.name === instance && (record.type === 'SRV' || record.type === 'TXT')) ||
      (needsAddress && record.name === discoveryHost && record.type === 'A')
    )
  };
}

export function startDiscovery(address, port, protocol, onReady, onError) {
  const mdns = multicastDns({ interface: address, reuseAddr: true });
  let closed = false;
  let ready = false;
  let joined = false;
  const records = discoveryRecords(address, port, protocol);
  mdns.on('networkInterface', () => { joined = true; });
  mdns.on('query', (query, remote) => {
    const response = answersFor(query.questions || [], records);
    if (!response) return;
    if (remote.port !== 5353) {
      mdns.respond({
        id: query.id,
        questions: query.questions,
        answers: response.answers.map(record => ({ ...record, ttl: 10, flush: false })),
        additionals: response.additionals.map(record => ({ ...record, ttl: 10, flush: false }))
      }, remote, error => { if (error) onError(error); });
    } else {
      mdns.respond(response, error => { if (error) onError(error); });
    }
  });
  mdns.on('error', onError);
  mdns.on('warning', error => console.warn('mDNS warning on ' + address + ': ' + error.message));
  mdns.once('ready', () => {
    if (closed) return;
    if (!joined) return onError(new Error('Could not join the multicast network'));
    ready = true;
    mdns.respond({ answers: records }, error => {
      if (error) onError(error);
      else onReady();
    });
    setTimeout(() => { if (!closed) mdns.respond({ answers: records }, () => {}); }, 1000).unref();
  });
  return () => {
    if (closed) return;
    closed = true;
    if (!ready) return mdns.destroy();
    mdns.respond({ answers: discoveryRecords(address, port, protocol, 0) }, () => mdns.destroy());
    setTimeout(() => mdns.destroy(), 500).unref();
  };
}
