import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import forge from 'node-forge';

const day = 24 * 60 * 60 * 1000;
const read = (file) =>
    readFile(file, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });

function createKey() {
    return generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
}

function createCertificate({ subject, issuer, publicKey, signingKey, days, extensions }) {
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = forge.pki.publicKeyFromPem(publicKey);
    // RFC 5280 requires a positive serial in minimal DER: the first byte stays within 0x40–0x7f.
    const serial = randomBytes(16);
    serial[0] = (serial[0] & 0x3f) | 0x40;
    certificate.serialNumber = serial.toString('hex');
    certificate.validity.notBefore = new Date(Date.now() - day);
    certificate.validity.notAfter = new Date(Date.now() + days * day);
    certificate.setSubject(subject);
    certificate.setIssuer(issuer);
    certificate.setExtensions(extensions);
    certificate.sign(forge.pki.privateKeyFromPem(signingKey), forge.md.sha256.create());
    return forge.pki.certificateToPem(certificate);
}

/**
 * HTTPS for the private network, needed for the PWA (service workers require a secure context). A local
 * certificate authority is created once; the phone trusts it once (see /trust) and every later server certificate,
 * reissued whenever the PC's addresses change, is trusted with it. User-provided tls/cert.pem and tls/key.pem
 * without tls/generated.json are used as is.
 */
export async function openCertificates(dataDirectory) {
    const directory = path.join(dataDirectory, 'tls');
    const files = {
        cert: path.join(directory, 'cert.pem'),
        key: path.join(directory, 'key.pem'),
        ca: path.join(directory, 'ca.pem'),
        caKey: path.join(directory, 'ca-key.pem'),
        generated: path.join(directory, 'generated.json'),
    };
    await mkdir(directory, { recursive: true });
    const [cert, key, generated] = await Promise.all([read(files.cert), read(files.key), read(files.generated)]);
    if (Boolean(cert) !== Boolean(key)) throw new Error('Both tls/cert.pem and tls/key.pem are required for HTTPS');
    if (cert && !generated) return { managed: false, cert, key, ca: null, ensure: async () => false };

    let ca = await read(files.ca),
        caKey = await read(files.caKey);
    if (!ca || !caKey) {
        const pair = createKey();
        const subject = [{ name: 'commonName', value: `Remote Smart Trackpad local CA (${hostname()})` }];
        ca = createCertificate({
            subject,
            issuer: subject,
            publicKey: pair.publicKey,
            signingKey: pair.privateKey,
            days: 3650,
            extensions: [
                { name: 'basicConstraints', cA: true, critical: true },
                { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
                { name: 'subjectKeyIdentifier' },
            ],
        });
        caKey = pair.privateKey;
        await writeFile(files.caKey, caKey, { mode: 0o600 });
        await writeFile(files.ca, ca);
    }
    const state = { managed: true, cert, key, ca };
    let hosts = generated ? JSON.parse(generated).hosts : [];
    let expires = cert ? forge.pki.certificateFromPem(cert).validity.notAfter.getTime() : 0;
    /** Reissues the server certificate when a host is missing or expiry is near; resolves true if it changed. */
    state.ensure = async (wanted) => {
        const names = [...new Set(['localhost', '127.0.0.1', ...wanted])];
        if (state.cert && names.every((name) => hosts.includes(name)) && expires - Date.now() > 30 * day) return false;
        const pair = createKey();
        const caCertificate = forge.pki.certificateFromPem(ca);
        state.cert = createCertificate({
            subject: [{ name: 'commonName', value: names.find((name) => name.endsWith('.local')) || names[0] }],
            issuer: caCertificate.subject.attributes,
            publicKey: pair.publicKey,
            signingKey: caKey,
            // Apple platforms reject server certificates valid for more than 825 days.
            days: 820,
            extensions: [
                { name: 'basicConstraints', cA: false },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
                { name: 'extKeyUsage', serverAuth: true },
                {
                    name: 'authorityKeyIdentifier',
                    keyIdentifier: caCertificate.generateSubjectKeyIdentifier().getBytes(),
                },
                {
                    name: 'subjectAltName',
                    altNames: names.map((name) =>
                        /^\d+\.\d+\.\d+\.\d+$/.test(name) ? { type: 7, ip: name } : { type: 2, value: name }
                    ),
                },
            ],
        });
        state.key = pair.privateKey;
        hosts = names;
        expires = Date.now() + 820 * day;
        await writeFile(files.key, state.key, { mode: 0o600 });
        await writeFile(files.cert, state.cert);
        await writeFile(files.generated, JSON.stringify({ hosts }));
        return true;
    };
    return state;
}
