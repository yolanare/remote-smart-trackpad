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
    $('#pairing-code').textContent = code ? `${code.slice(0, 3)} ${code.slice(3)}` : 'Expired';
    updateCountdown();
}
function updateCountdown() {
    const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    $('#pairing-code').classList.toggle('expired', !seconds);
    if (!seconds) {
        $('#pairing-code').textContent = 'Expired';
        $('#code-expiry').textContent = 'Select New code to continue.';
        return;
    }
    $('#code-expiry').textContent = `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
// One QR code at a time: the stable .local address first, other addresses one tap away.
function renderAddresses(urls, discoveryUrl) {
    // Demo discovery URL for screenshots
    // discoveryUrl = discoveryUrl?.replace(/\/\/[^/:]+\.local/, '//remote-smart-trackpad-your-pc.local');
    addresses = [
        ...(discoveryUrl ? [{ url: discoveryUrl, label: '.local address' }] : []),
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
        $('#code-expiry').textContent = 'Cannot connect to Remote Smart Trackpad. Restart it on this PC.';
    }
}
$('#refresh-code').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/setup/refresh', { method: 'POST' });
        if (!response.ok) throw new Error();
        const setup = await response.json();
        showCode(setup.pairingCode, setup.pairingExpires);
    } catch {
        $('#code-expiry').textContent = 'Could not create a code. Try again.';
    }
});
setInterval(updateCountdown, 1000);
setInterval(loadSetup, 10000);
loadSetup();
