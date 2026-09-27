const codeElement = document.querySelector('#pairing-code');
const expiryElement = document.querySelector('#code-expiry');
const qrList = document.querySelector('#qr-list');
let expiresAt = 0;

function showCode(code, expiry) {
  expiresAt = expiry;
  codeElement.textContent = code ? `${code.slice(0, 3)} ${code.slice(3)}` : 'Expiré';
  updateCountdown();
}
function updateCountdown() {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  if (!seconds) { codeElement.textContent = 'Expiré'; expiryElement.textContent = 'Générez un nouveau code pour appairer un téléphone.'; return; }
  expiryElement.textContent = `Valable encore ${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}
function renderUrls(urls) {
  qrList.replaceChildren();
  if (!urls.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = 'Aucune adresse réseau privée disponible. Connectez le PC au Wi-Fi, puis relancez le serveur.';
    qrList.append(empty); return;
  }
  for (const [index, url] of urls.entries()) {
    const card = document.createElement('article'); card.className = 'qr-card';
    const image = document.createElement('div'); image.className = 'qr-image';
    image.append(QRCode({ msg: url, dim: 220, pad: 4, ecl: 'M', pal: ['#111827', '#ffffff'] }));
    const title = document.createElement('h3'); title.textContent = urls.length === 1 ? 'Adresse du téléphone' : `Adresse réseau ${index + 1}`;
    const link = document.createElement('a'); link.href = url; link.textContent = url;
    card.append(image, title, link); qrList.append(card);
  }
}
async function loadSetup() {
  try {
    const response = await fetch('/api/setup', { cache: 'no-store' });
    if (!response.ok) throw new Error('La page de connexion est indisponible.');
    const setup = await response.json();
    showCode(setup.pairingCode, setup.pairingExpires);
    renderUrls(setup.urls);
  } catch (error) { qrList.textContent = error.message; }
}
document.querySelector('#refresh-code').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/setup/refresh', { method: 'POST' });
    if (!response.ok) throw new Error('Impossible de générer un code.');
    const setup = await response.json(); showCode(setup.pairingCode, setup.pairingExpires);
  } catch (error) { expiryElement.textContent = error.message; }
});
setInterval(updateCountdown, 1000);
setInterval(loadSetup, 10000);
loadSetup();
