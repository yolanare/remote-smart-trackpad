const $ = selector => document.querySelector(selector);
const storagePrefix = 'remote-smart-trackpad';
const previousStoragePrefix = ['phone', 'text', 'remote'].join('-');
function storageKey(storage, suffix) {
  const key = `${storagePrefix}-${suffix}`;
  const previousKey = `${previousStoragePrefix}-${suffix}`;
  if (storage.getItem(key) === null && storage.getItem(previousKey) !== null) {
    storage.setItem(key, storage.getItem(previousKey));
    storage.removeItem(previousKey);
  }
  return key;
}
const tokenKey = storageKey(localStorage, 'token');
const keysKey = storageKey(localStorage, 'keys');
const draftKey = storageKey(sessionStorage, 'draft');
let token = localStorage.getItem(tokenKey);
let socket;
let nextId = 0;
let reconnectDelay = 500;
const pending = new Map();
let editorOpen = false;
let editorConfirmed = '';
let editorSessionReady = false;
let largeSelectionPending = false;
let composing = false;
let editQueued = false;
const modifiers = new Map();
const quickKeys = ['Escape', 'Tab', 'Control', 'Shift', 'Alt', 'AltGr', 'Win', 'Fn', 'Left', 'Up', 'Right', 'Down', 'Delete', 'Backspace'];
const keyGroups = {
  'Édition': ['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Enter'],
  'Fonctions': Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  'Média': ['VolumeDown', 'VolumeUp', 'VolumeMute', 'PlayPause']
};
const labels = { Escape: 'Échap', Control: 'Ctrl', Shift: 'Shift', Backspace: '⌫', Delete: 'Suppr', Left: '←', Right: '→', Up: '↑', Down: '↓', PageUp: 'Page ↑', PageDown: 'Page ↓', PlayPause: 'Lecture', VolumeDown: 'Vol −', VolumeUp: 'Vol +', VolumeMute: 'Muet' };
const modifierNames = new Set(['Control', 'Shift', 'Alt', 'AltGr', 'Win']);

function setConnection(state, label) {
  $('#connection').className = `connection ${state}`;
  $('#connection').lastElementChild.textContent = label;
}
function notice(message) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('hidden', !message);
}
function editorStatus(message, error = false) {
  $('#editor-status').textContent = message;
  $('#editor-status').classList.toggle('error', error);
}
function send(action, data = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('PC déconnecté. La commande n’a pas été appliquée.'));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Aucune confirmation du PC. Résultat incertain.')); }, 7000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, action, data }));
  });
}
function sendAction(action, data) { send(action, data).catch(error => notice(error.message)); }
function connect() {
  if (!token) { $('#pairing').classList.remove('hidden'); $('#controls').classList.add('hidden'); setConnection('error', 'Appairage requis'); return; }
  $('#pairing').classList.add('hidden'); $('#controls').classList.remove('hidden');
  setConnection('', 'Connexion…');
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket?token=${encodeURIComponent(token)}`);
  socket.onopen = () => { reconnectDelay = 500; setConnection('ready', 'Connecté'); notice(''); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'status') {
      if (message.state !== 'ready') { setConnection('error', message.state === 'another-device' ? 'Autre appareil actif' : 'PC indisponible'); notice('Les commandes ne peuvent pas être appliquées actuellement.'); }
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || 'Commande refusée par Windows'));
  };
  socket.onclose = () => {
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Connexion perdue. Résultat de la commande incertain.')); }
    pending.clear();
    setConnection('error', 'Déconnecté');
    if (editorOpen) editorStatus('Connexion perdue. Texte conservé sur ce téléphone.', true);
    notice('Connexion perdue. Les appuis sont relâchés sur le PC.');
    modifiers.clear(); renderKeys();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.7, 5000);
  };
}
$('#pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#pair-error').textContent = '';
  try {
    const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('#pair-code').value.replace(/\s/g, '') }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    token = data.token; localStorage.setItem(tokenKey, token); connect();
  } catch (error) { $('#pair-error').textContent = error.message; }
});
$('#disconnect').addEventListener('click', () => { localStorage.removeItem(tokenKey); token = null; socket?.close(); connect(); });

const pad = $('#trackpad');
const fingers = new Map();
let gestureStart = 0, gestureMoved = false, gestureMaximum = 0, longPressTimer, dragging = false, previousTap = 0, tapTimer;
let movement = { dx: 0, dy: 0 }, movementFrame = 0;
function queueMovement(dx, dy) {
  movement.dx += dx; movement.dy += dy;
  if (movementFrame) return;
  movementFrame = requestAnimationFrame(() => {
    const delta = movement; movement = { dx: 0, dy: 0 }; movementFrame = 0;
    if (delta.dx || delta.dy) sendAction('move', { dx: Math.round(delta.dx * 1.3), dy: Math.round(delta.dy * 1.3) });
  });
}
pad.addEventListener('pointerdown', event => {
  event.preventDefault(); pad.setPointerCapture(event.pointerId);
  fingers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
  gestureMaximum = Math.max(gestureMaximum, fingers.size);
  if (fingers.size === 1) {
    gestureStart = performance.now(); gestureMoved = false; gestureMaximum = 1;
    longPressTimer = setTimeout(() => { if (!gestureMoved && fingers.size === 1) { dragging = true; gestureMoved = true; sendAction('button', { button: 'left', down: true }); } }, 420);
  } else clearTimeout(longPressTimer);
});
pad.addEventListener('pointermove', event => {
  const finger = fingers.get(event.pointerId);
  if (!finger) return;
  const dx = event.clientX - finger.x, dy = event.clientY - finger.y;
  finger.x = event.clientX; finger.y = event.clientY;
  if (Math.hypot(finger.x - finger.startX, finger.y - finger.startY) > 9) { gestureMoved = true; clearTimeout(longPressTimer); }
  if (fingers.size === 1) queueMovement(dx, dy);
  else if (fingers.size === 2) sendAction('scroll', { dx: Math.round(dx * 3), dy: Math.round(dy * 3) });
});
function finishPointer(event, cancelled = false) {
  if (!fingers.has(event.pointerId)) return;
  fingers.delete(event.pointerId); clearTimeout(longPressTimer);
  if (dragging) { dragging = false; sendAction('button', { button: 'left', down: false }); }
  if (fingers.size) return;
  if (!cancelled && !gestureMoved && performance.now() - gestureStart < 350) {
    if (gestureMaximum === 2) sendAction('click', { button: 'right' });
    else if (gestureMaximum >= 3) sendAction('click', { button: 'middle' });
    else {
      const now = performance.now();
      if (now - previousTap < 320) { clearTimeout(tapTimer); sendAction('click', { button: 'left', double: true }); previousTap = 0; }
      else { previousTap = now; tapTimer = setTimeout(() => { sendAction('click', { button: 'left' }); previousTap = 0; }, 320); }
    }
  }
  gestureMaximum = 0;
}
pad.addEventListener('pointerup', event => finishPointer(event));
pad.addEventListener('pointercancel', event => finishPointer(event, true));
window.addEventListener('blur', () => { fingers.clear(); clearTimeout(longPressTimer); clearTimeout(tapTimer); if (dragging) { dragging = false; sendAction('release'); } });
document.querySelectorAll('[data-click]').forEach(button => button.addEventListener('click', () => sendAction('click', { button: button.dataset.click })));

let keyOrder = JSON.parse(localStorage.getItem(keysKey) || 'null') || quickKeys;
let organizing = false;
let selectedKey = null;
function renderKeys() {
  const grid = $('#key-grid'); grid.replaceChildren();
  for (const name of keyOrder) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = labels[name] || name;
    if (modifierNames.has(name)) { button.className = `modifier ${modifiers.get(name) || ''}`; button.setAttribute('aria-pressed', modifiers.has(name)); }
    button.addEventListener('pointerdown', event => { if (editorOpen) event.preventDefault(); });
    button.addEventListener('click', () => {
      if (!organizing) return pressKey(name);
      if (!selectedKey) { selectedKey = name; button.classList.add('selected'); notice(`Touchez la position à échanger avec ${labels[name] || name}.`); return; }
      const first = keyOrder.indexOf(selectedKey), second = keyOrder.indexOf(name);
      [keyOrder[first], keyOrder[second]] = [keyOrder[second], keyOrder[first]];
      localStorage.setItem(keysKey, JSON.stringify(keyOrder));
      selectedKey = null; renderKeys(); notice('Position enregistrée. Touchez une autre touche pour continuer.');
    }); grid.append(button);
  }
}
for (const [heading, names] of Object.entries(keyGroups)) {
  const group = document.createElement('section'); group.className = 'key-group';
  const title = document.createElement('h3'); title.textContent = heading; group.append(title);
  const keys = document.createElement('div'); keys.className = 'key-group-grid';
  for (const name of names) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = labels[name] || name;
    button.addEventListener('click', () => {
      if (organizing) {
        if (!keyOrder.includes(name)) { keyOrder.push(name); localStorage.setItem(keysKey, JSON.stringify(keyOrder)); renderKeys(); notice(`${labels[name] || name} ajouté aux touches rapides.`); }
      } else pressKey(name);
    }); keys.append(button);
  }
  group.append(keys); $('#extra-keys').append(group);
}
const customGroup = document.createElement('section'); customGroup.className = 'key-group';
const customTitle = document.createElement('h3'); customTitle.textContent = 'Touches personnalisées'; customGroup.append(customTitle);
const customPicker = document.createElement('div'); customPicker.className = 'custom-picker';
const customSelect = document.createElement('select'); customSelect.setAttribute('aria-label', 'Touche à ajouter');
for (const name of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { const option = document.createElement('option'); option.value = name; option.textContent = name; customSelect.append(option); }
const customAdd = document.createElement('button'); customAdd.type = 'button'; customAdd.textContent = 'Ajouter';
customAdd.addEventListener('click', () => {
  if (!keyOrder.includes(customSelect.value)) { keyOrder.push(customSelect.value); localStorage.setItem(keysKey, JSON.stringify(keyOrder)); renderKeys(); notice(`${customSelect.value} ajouté aux touches rapides.`); }
});
customPicker.append(customSelect, customAdd); customGroup.append(customPicker); $('#extra-keys').append(customGroup);
let modifierTap = new Map();
async function pressKey(name) {
  if (name === 'Fn') { $('.more-keys').open = !$('.more-keys').open; return; }
  if (modifierNames.has(name)) {
    const now = performance.now();
    const state = modifiers.get(name);
    if (state === 'locked') modifiers.delete(name);
    else if (state === 'armed' && now - (modifierTap.get(name) || 0) < 360) modifiers.set(name, 'locked');
    else if (state === 'armed') modifiers.delete(name);
    else modifiers.set(name, 'armed');
    modifierTap.set(name, now); renderKeys(); return;
  }
  const active = [...modifiers.keys()];
  try {
    for (const modifier of active) await send('key', { key: modifier, down: true });
    await send('key', { key: name });
  } catch (error) { notice(error.message); }
  finally {
    for (const modifier of [...active].reverse()) await send('key', { key: modifier, down: false }).catch(() => {});
    for (const modifier of active) if (modifiers.get(modifier) === 'armed') modifiers.delete(modifier);
    renderKeys();
  }
}
renderKeys();
$('#edit-keys').addEventListener('click', () => {
  organizing = !organizing; selectedKey = null;
  $('#edit-keys').textContent = organizing ? 'Terminer' : 'Organiser';
  notice(organizing ? 'Touchez deux touches rapides pour échanger leurs positions.' : '');
  renderKeys();
});

async function openEditorSession(allowLarge = false) {
  editorSessionReady = false;
  largeSelectionPending = false;
  $('#editor-reopen').classList.add('hidden');
  editorStatus('Vérification du champ PC…');
  try {
    const result = await send('open', { allowLarge });
    if (result.requiresConfirmation) {
      largeSelectionPending = true;
      editorStatus('La sélection du PC dépasse 4096 caractères. Confirmez son transfert vers ce téléphone.');
      $('#editor-reopen').textContent = 'Transférer cette sélection';
      $('#editor-reopen').classList.remove('hidden');
      return;
    }
    $('#editor-text').value = result.text; editorConfirmed = result.text; editorSessionReady = true;
    sessionStorage.removeItem(draftKey);
    $('#editor-reopen').textContent = 'Ouvrir une nouvelle session sur le PC';
    editorStatus(result.mode === 'selection' ? 'Sélection du PC chargée. Les modifications seront appliquées à cette plage.' : 'Insertion au curseur PC. Le texte précédent reste hors du buffer.');
    $('#editor-text').focus();
  } catch (error) { editorStatus(error.message, true); $('#editor-reopen').textContent = 'Ouvrir une nouvelle session sur le PC'; $('#editor-reopen').classList.remove('hidden'); }
}
$('#editor-open').addEventListener('click', async () => {
  $('#editor').classList.remove('hidden'); editorOpen = true;
  const saved = sessionStorage.getItem(draftKey);
  if (saved) { $('#editor-text').value = saved; editorSessionReady = false; editorStatus('Brouillon conservé. Copiez-le si nécessaire avant d’ouvrir une nouvelle session : cette action remplacera le buffer.', true); $('#editor-reopen').classList.remove('hidden'); return; }
  await openEditorSession();
});
$('#editor-reopen').addEventListener('click', () => openEditorSession(largeSelectionPending));
$('#editor-close').addEventListener('click', async () => {
  if (editQueued || !editorSessionReady || $('#editor-text').value !== editorConfirmed) {
    sessionStorage.setItem(draftKey, $('#editor-text').value);
    notice('Un brouillon reste enregistré sur ce téléphone. Son application au PC est incertaine.');
  }
  if (editorSessionReady) await send('close').catch(() => {});
  $('#editor').classList.add('hidden'); editorOpen = false; editorSessionReady = false;
});
$('#editor-text').addEventListener('compositionstart', () => { composing = true; });
$('#editor-text').addEventListener('compositionend', () => { composing = false; queueEdit(); });
$('#editor-text').addEventListener('input', () => { if (!composing) queueEdit(); });
async function queueEdit() {
  if (!editorSessionReady) { sessionStorage.setItem(draftKey, $('#editor-text').value); return; }
  if (editQueued || composing) return;
  editQueued = true;
  while ($('#editor-text').value !== editorConfirmed && !composing) {
    const text = $('#editor-text').value;
    const position = $('#editor-text').selectionStart;
    sessionStorage.setItem(draftKey, text);
    editorStatus('Application sur le PC…');
    try {
      await send('edit', { text, position });
      editorConfirmed = text;
      if ($('#editor-text').value === text) sessionStorage.removeItem(draftKey);
      editorStatus('Texte appliqué sur le PC');
    } catch (error) { editorSessionReady = false; $('#editor-reopen').classList.remove('hidden'); editorStatus(error.message + ' Texte mobile conservé.', true); break; }
  }
  editQueued = false;
}
document.querySelectorAll('[data-editor-key]').forEach(button => {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => { pressKey(button.dataset.editorKey); $('#editor-text').focus(); });
});
connect();
