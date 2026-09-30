const $ = (selector) => document.querySelector(selector);
let expiresAt = 0,
    addresses = [],
    selected = null;

function qr(target, url) {
    if (target.dataset.url === url) return;
    target.dataset.url = url;
    target.replaceChildren(QRCode({ msg: url, dim: 220, pad: 2, ecl: 'M', pal: ['#000000', '#ffffff'] }));
}
function showCode(code, expiry) {
    expiresAt = expiry;
    $('#pairing-code').textContent = code ? `${code.slice(0, 3)} ${code.slice(3)}` : 'Expiré';
    updateCountdown();
}
function updateCountdown() {
    const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    $('#pairing-code').classList.toggle('expired', !seconds);
    if (!seconds) {
        $('#pairing-code').textContent = 'Expiré';
        $('#code-expiry').textContent = 'Générez un nouveau code.';
        return;
    }
    $('#code-expiry').textContent = `Expire dans ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
// One QR code at a time: the stable .local address first, other addresses one tap away.
function renderAddresses(urls, discoveryUrl) {
    addresses = [
        ...(discoveryUrl ? [{ url: discoveryUrl, label: 'Adresse .local' }] : []),
        ...urls.map((url) => ({ url, label: new URL(url).hostname })),
    ];
    $('#scan').hidden = !addresses.length;
    $('#scan-empty').hidden = Boolean(addresses.length);
    if (!addresses.length) return;
    if (!addresses.some((address) => address.url === selected)) selected = addresses[0].url;
    const group = $('#addresses');
    group.hidden = addresses.length < 2;
    group.replaceChildren(
        ...addresses.map((address) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = address.label;
            button.setAttribute('aria-pressed', String(address.url === selected));
            button.addEventListener('click', () => {
                selected = address.url;
                renderAddresses(urls, discoveryUrl);
            });
            return button;
        })
    );
    qr($('#scan-qr'), selected);
    $('#scan-link').href = selected;
    $('#scan-link').textContent = selected.replace(/\/$/, '');
}
function renderTrust(urls) {
    $('#trust-section').hidden = !urls?.length;
    if (urls?.length) qr($('#trust-qr'), urls[0]);
}
async function loadSetup() {
    try {
        const response = await fetch('/api/setup', { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const setup = await response.json();
        showCode(setup.pairingCode, setup.pairingExpires);
        renderAddresses(setup.urls, setup.discoveryUrl);
        renderTrust(setup.trustUrls);
    } catch {
        $('#code-expiry').textContent = 'Serveur injoignable. Relancez Remote Smart Trackpad.';
    }
}
$('#refresh-code').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/setup/refresh', { method: 'POST' });
        if (!response.ok) throw new Error();
        const setup = await response.json();
        showCode(setup.pairingCode, setup.pairingExpires);
    } catch {
        $('#code-expiry').textContent = 'Impossible de générer un code.';
    }
});
setInterval(updateCountdown, 1000);
setInterval(loadSetup, 10000);
loadSetup();
