import { nextReplacementStep } from './text-operations.js';

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
const draftKey = `${storagePrefix}-draft`;
const editorStateKey = `${storagePrefix}-editor-state`;
const previousDraftKey = storageKey(sessionStorage, 'draft');
const previousDraft = sessionStorage.getItem(previousDraftKey);
if (previousDraft !== null) {
  try {
    if (localStorage.getItem(draftKey) === null) localStorage.setItem(draftKey, previousDraft);
    sessionStorage.removeItem(previousDraftKey);
  } catch { /* Keep the existing session draft if persistent storage is full. */ }
}
let token = localStorage.getItem(tokenKey);
let socket;
let socketGeneration = 0;
let nextId = 0;
let reconnectDelay = 500;
const pending = new Map();
let editorOpen = false;
let editorTouched = false;
let editorRevision = 0;
let openingEditor = false;
let closingEditor = false;
let editorConfirmed = '';
let editorSessionReady = false;
let editorSessionId = null;
let outstandingEdit = null;
let observing = false;
let recovering = false;
let recoveryAvailable = false;
let draftStorageAvailable = true;
let largeSelectionPending = false;
let composing = false;
let editQueued = false;
const modifiers = new Map();
const quickKeys = ['Escape', 'Fn', 'Tab', 'AltGr', 'Control', 'Home', 'Shift', 'End', 'Alt', 'Delete', 'Win', 'PageUp', 'Left', 'PageDown', 'Up', 'Insert', 'Down', 'Backspace', 'Right', 'Enter'];
const keyGroups = {
  'Navigation': ['Left', 'Up', 'Down', 'Right', 'Home', 'End', 'PageUp', 'PageDown'],
  'Édition': ['Insert', 'Delete', 'Backspace', 'Enter', 'Tab', 'C', 'V', 'X', 'A'],
  'Fonctions': Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  'F13–F24': Array.from({ length: 12 }, (_, index) => `F${index + 13}`),
  'Système': ['Win', 'PrintScreen', 'ScrollLock', 'Pause', 'ContextMenu'],
  'Média': ['VolumeDown', 'VolumeUp', 'VolumeMute', 'PlayPause']
};
const labels = { Escape: 'Échap', Control: 'Ctrl', Shift: 'Shift', Backspace: '⌫', Delete: 'Suppr', Left: '←', Right: '→', Up: '↑', Down: '↓', PageUp: 'Page ↑', PageDown: 'Page ↓', PlayPause: 'Lecture', VolumeDown: 'Vol −', VolumeUp: 'Vol +', VolumeMute: 'Muet' };
const modifierNames = new Set(['Control', 'Shift', 'Alt', 'AltGr', 'Win', 'Fn']);
const fnMappingsKey = `${storagePrefix}-fn-mappings`;
const fnMappings = { Left: 'Home', Right: 'End', Up: 'PageUp', Down: 'PageDown', F1: 'PlayPause', ...JSON.parse(localStorage.getItem(fnMappingsKey) || '{}') };

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
function preserveDraft() {
  try { localStorage.setItem(draftKey, $('#editor-text').value); draftStorageAvailable = true; return true; }
  catch { draftStorageAvailable = false; editorStatus('Stockage du téléphone saturé. Gardez cette page ouverte et copiez votre texte.', true); return false; }
}
function tactileFeedback() { navigator.vibrate?.(8); }
function send(action, data = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('PC déconnecté. La commande n’a pas été appliquée.'));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Aucune confirmation du PC. Résultat incertain.')); }, action === 'edit' ? 35_000 : action === 'open' || action === 'inspect' ? 15_000 : 7000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, action, data }));
  });
}
function sendAction(action, data) { send(action, data).catch(error => notice(error.message)); }
function connect() {
  const generation = ++socketGeneration;
  if (!token) { $('#pairing').classList.remove('hidden'); $('#controls').classList.add('hidden'); setConnection('error', 'Appairage requis'); return; }
  $('#pairing').classList.add('hidden'); $('#controls').classList.remove('hidden');
  setConnection('', 'Connexion…');
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket?token=${encodeURIComponent(token)}`);
  let connected = false;
  socket.onopen = () => {
    if (generation !== socketGeneration) return socket.close();
    connected = true;
    reconnectDelay = 500; setConnection('ready', 'Connecté');
    notice(localStorage.getItem(draftKey) !== null ? 'Un brouillon mobile attend une vérification. Ouvrez l’éditeur.' : '');
    if (editorOpen && editorSessionId) recoverEditorSession();
  };
  socket.onmessage = event => {
    if (generation !== socketGeneration) return;
    const message = JSON.parse(event.data);
    if (message.type === 'status') {
      if (message.state !== 'ready') { setConnection('error', message.state === 'another-device' ? 'Autre appareil actif' : 'PC indisponible'); notice('Les commandes ne peuvent pas être appliquées actuellement.'); }
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else { const error = new Error(message.error || 'Commande refusée par Windows'); error.code = message.code; request.reject(error); }
  };
  socket.onclose = async () => {
    if (generation !== socketGeneration) return;
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Connexion perdue. Résultat de la commande incertain.')); }
    pending.clear();
    interruptInput();
    setConnection('error', 'Déconnecté');
    editorSessionReady = false;
    if (editorOpen) editorStatus('Connexion perdue. Texte conservé sur ce téléphone.', true);
    notice('Connexion perdue. Les appuis sont relâchés sur le PC.');
    modifiers.clear(); renderKeys();
    if (!connected) {
      const status = await fetch('/api/status', { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      if (generation !== socketGeneration) return;
      if (status?.status === 401) {
        localStorage.removeItem(tokenKey); token = null; connect(); return;
      }
    }
    setTimeout(() => { if (generation === socketGeneration) connect(); }, reconnectDelay);
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
$('#disconnect').addEventListener('click', () => { interruptInput(); localStorage.removeItem(tokenKey); token = null; socketGeneration++; socket?.close(); connect(); });

const pad = $('#trackpad');
const fingers = new Map();
let gestureStart = 0, gestureMoved = false, gestureMaximum = 0, longPressTimer, dragging = false, previousTap = 0, tapTimer;
let movement = { dx: 0, dy: 0 }, movementFrame = 0;
let finishingDrag = false;
let inputGeneration = 0;
const pendingMotion = { move: { dx: 0, dy: 0 }, scroll: { dx: 0, dy: 0 } };
const motionTasks = { move: null, scroll: null };
function sendMotion(action, dx, dy) {
  pendingMotion[action].dx += dx;
  pendingMotion[action].dy += dy;
  if (motionTasks[action]) return motionTasks[action];
  motionTasks[action] = (async () => {
    try {
      while (pendingMotion[action].dx || pendingMotion[action].dy) {
        const delta = { ...pendingMotion[action] };
        pendingMotion[action] = { dx: 0, dy: 0 };
        await send(action, delta);
      }
    } catch (error) { pendingMotion[action] = { dx: 0, dy: 0 }; notice(error.message); }
    finally { motionTasks[action] = null; }
  })();
  return motionTasks[action];
}
function queueMovement(dx, dy) {
  movement.dx += dx; movement.dy += dy;
  if (movementFrame) return;
  movementFrame = requestAnimationFrame(flushMovement);
}
function flushMovement() {
  if (movementFrame) cancelAnimationFrame(movementFrame);
  const delta = movement; movement = { dx: 0, dy: 0 }; movementFrame = 0;
  if (delta.dx || delta.dy) return sendMotion('move', Math.round(delta.dx * 1.3), Math.round(delta.dy * 1.3));
  return motionTasks.move;
}
pad.addEventListener('pointerdown', event => {
  if (finishingDrag) return;
  event.preventDefault(); pad.setPointerCapture(event.pointerId);
  fingers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
  gestureMaximum = Math.max(gestureMaximum, fingers.size);
  if (fingers.size === 1) {
    gestureStart = performance.now(); gestureMoved = false; gestureMaximum = 1;
    longPressTimer = setTimeout(() => { if (!gestureMoved && fingers.size === 1) { dragging = true; gestureMoved = true; tactileFeedback(); sendAction('button', { button: 'left', down: true }); } }, 420);
  } else clearTimeout(longPressTimer);
});
pad.addEventListener('pointermove', event => {
  const finger = fingers.get(event.pointerId);
  if (!finger) return;
  const dx = event.clientX - finger.x, dy = event.clientY - finger.y;
  finger.x = event.clientX; finger.y = event.clientY;
  if (Math.hypot(finger.x - finger.startX, finger.y - finger.startY) > 9) { gestureMoved = true; clearTimeout(longPressTimer); }
  if (fingers.size === 1 && gestureMaximum === 1) queueMovement(dx, dy);
  else if (fingers.size === 2 && gestureMaximum === 2 && !dragging) sendMotion('scroll', Math.round(dx * 3), Math.round(dy * 3));
});
async function finishPointer(event, cancelled = false) {
  if (!fingers.has(event.pointerId)) return;
  if (cancelled) { interruptInput(); return; }
  fingers.delete(event.pointerId); clearTimeout(longPressTimer);
  if (dragging) {
    const generation = inputGeneration;
    dragging = false;
    finishingDrag = true;
    try {
      await flushMovement();
      if (generation === inputGeneration) sendAction('button', { button: 'left', down: false });
    } finally { finishingDrag = false; }
    if (generation !== inputGeneration) return;
  }
  if (fingers.size) return;
  if (!cancelled && !gestureMoved && performance.now() - gestureStart < 350) {
    tactileFeedback();
    if (gestureMaximum === 2) sendAction('click', { button: 'right' });
    else if (gestureMaximum >= 3) sendAction('click', { button: 'middle' });
    else {
      const now = performance.now();
      if (previousTap && now - previousTap < 320) { clearTimeout(tapTimer); sendAction('click', { button: 'left', double: true }); previousTap = 0; }
      else { previousTap = now; tapTimer = setTimeout(() => { sendAction('click', { button: 'left' }); previousTap = 0; }, 320); }
    }
  }
  gestureMaximum = 0;
}
pad.addEventListener('pointerup', event => finishPointer(event));
pad.addEventListener('pointercancel', event => finishPointer(event, true));
pad.addEventListener('lostpointercapture', event => { if (fingers.has(event.pointerId)) interruptInput(); });
function interruptInput() {
  inputGeneration++;
  fingers.clear(); clearTimeout(longPressTimer); clearTimeout(tapTimer);
  previousTap = 0; gestureMaximum = 0;
  if (movementFrame) cancelAnimationFrame(movementFrame);
  movementFrame = 0;
  dragging = false; movement = { dx: 0, dy: 0 };
  pendingMotion.move = { dx: 0, dy: 0 }; pendingMotion.scroll = { dx: 0, dy: 0 };
  modifiers.clear(); renderKeys();
  if (socket?.readyState === WebSocket.OPEN) sendAction('release');
}
window.addEventListener('blur', interruptInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) interruptInput(); });
document.querySelectorAll('[data-click]').forEach(button => button.addEventListener('click', () => { tactileFeedback(); sendAction('click', { button: button.dataset.click }); }));

const savedKeyOrder = JSON.parse(localStorage.getItem(keysKey) || 'null');
let keyOrder = Array.isArray(savedKeyOrder) ? [...new Set([...savedKeyOrder, ...quickKeys])] : [...quickKeys];
let organizing = false;
let selectedKey = null;
function renderKeys() {
  document.querySelectorAll('[data-editor-key]').forEach(button => {
    const name = button.dataset.editorKey;
    if (!modifierNames.has(name)) return;
    button.classList.toggle('armed', modifiers.get(name) === 'armed');
    button.classList.toggle('locked', modifiers.get(name) === 'locked');
    button.setAttribute('aria-pressed', modifiers.has(name));
  });
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
const functionGroup = document.createElement('section'); functionGroup.className = 'key-group';
const functionTitle = document.createElement('h3'); functionTitle.textContent = 'Raccourcis Fn'; functionGroup.append(functionTitle);
const functionPicker = document.createElement('div'); functionPicker.className = 'function-picker';
const functionSource = document.createElement('select'); functionSource.setAttribute('aria-label', 'Touche après Fn');
const functionTarget = document.createElement('select'); functionTarget.setAttribute('aria-label', 'Action Fn');
for (const name of [...new Set([...quickKeys, ...Object.values(keyGroups).flat(), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'])].filter(name => name !== 'Fn')) {
  for (const select of [functionSource, functionTarget]) {
    const option = document.createElement('option'); option.value = name; option.textContent = labels[name] || name; select.append(option);
  }
}
const functionSave = document.createElement('button'); functionSave.type = 'button'; functionSave.textContent = 'Associer';
functionSave.addEventListener('click', () => {
  fnMappings[functionSource.value] = functionTarget.value;
  localStorage.setItem(fnMappingsKey, JSON.stringify(fnMappings));
  notice(`Fn + ${labels[functionSource.value] || functionSource.value} → ${labels[functionTarget.value] || functionTarget.value}`);
});
functionPicker.append(functionSource, functionTarget, functionSave); functionGroup.append(functionPicker); $('#extra-keys').append(functionGroup);
let modifierTap = new Map();
async function pressKey(name) {
  tactileFeedback();
  if (modifierNames.has(name)) {
    const now = performance.now();
    const state = modifiers.get(name);
    if (state === 'locked') modifiers.delete(name);
    else if (state === 'armed' && now - (modifierTap.get(name) || 0) < 360) modifiers.set(name, 'locked');
    else if (state === 'armed') modifiers.delete(name);
    else modifiers.set(name, 'armed');
    modifierTap.set(name, now); renderKeys(); return;
  }
  const active = [...modifiers.keys()].filter(modifier => modifier !== 'Fn');
  const resolvedName = modifiers.has('Fn') ? (fnMappings[name] || name) : name;
  for (const modifier of modifiers.keys()) if (modifiers.get(modifier) === 'armed') modifiers.delete(modifier);
  renderKeys();
  try { await send('shortcut', { key: resolvedName, modifiers: active }); }
  catch (error) { notice(error.message); }
}
renderKeys();
$('#edit-keys').addEventListener('click', () => {
  organizing = !organizing; selectedKey = null;
  $('#edit-keys').textContent = organizing ? 'Terminer' : 'Organiser';
  notice(organizing ? 'Touchez deux touches rapides pour échanger leurs positions.' : '');
  renderKeys();
});

async function openEditorSession(allowLarge = false) {
  if (openingEditor || recovering || editQueued) return;
  openingEditor = true;
  const revision = editorRevision;
  editorSessionReady = false;
  largeSelectionPending = false;
  recoveryAvailable = false;
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
    editorConfirmed = result.text; editorSessionId = result.session;
    if (editorRevision !== revision || composing) {
      outstandingEdit = null;
      saveEditorState();
      preserveDraft();
      recoveryAvailable = true;
      editorStatus('Texte mobile conservé pendant l’ouverture. Vérifiez la session PC avant de l’appliquer.');
      $('#editor-reopen').textContent = 'Vérifier la session PC';
      $('#editor-reopen').classList.remove('hidden');
      return;
    }
    $('#editor-text').value = result.text;
    editorTouched = false;
    outstandingEdit = null; editorSessionReady = saveEditorState();
    if (!editorSessionReady) return;
    localStorage.removeItem(draftKey);
    $('#editor-reopen').textContent = 'Ouvrir une nouvelle session sur le PC';
    editorStatus(result.mode === 'selection' ? 'Sélection du PC chargée. Les modifications seront appliquées à cette plage.' : 'Insertion au curseur PC. Le texte précédent reste hors du buffer.');
    $('#editor-text').focus();
  } catch (error) { editorStatus(error.message, true); $('#editor-reopen').textContent = 'Ouvrir une nouvelle session sur le PC'; $('#editor-reopen').classList.remove('hidden'); }
  finally { openingEditor = false; }
}
$('#editor-open').addEventListener('click', async () => {
  if (closingEditor) return;
  $('#editor').classList.remove('hidden'); editorOpen = true;
  editorTouched = false;
  const previousState = JSON.parse(localStorage.getItem(editorStateKey) || 'null');
  const saved = localStorage.getItem(draftKey);
  if (saved !== null || previousState) {
    editorSessionId = previousState?.session || null;
    editorConfirmed = previousState?.confirmed ?? null;
    outstandingEdit = previousState?.outstanding || null;
    $('#editor-text').value = saved ?? editorConfirmed ?? '';
    editorSessionReady = false;
    editorStatus('Vérification de la dernière opération et du champ PC…');
    recoveryAvailable = Boolean(editorSessionId);
    $('#editor-reopen').textContent = recoveryAvailable ? 'Vérifier la session PC' : 'Ouvrir une nouvelle session sur le PC';
    $('#editor-reopen').classList.remove('hidden');
    if (editorSessionId && socket?.readyState === WebSocket.OPEN) await recoverEditorSession();
    else editorStatus('Brouillon conservé. Copiez-le avant d’ouvrir une nouvelle session.', true);
    return;
  }
  await openEditorSession();
});
$('#editor-reopen').addEventListener('click', () => {
  if (recoveryAvailable) return recoverEditorSession();
  if (localStorage.getItem(draftKey) !== null &&
      !confirm('Ouvrir une nouvelle session remplacera le brouillon conservé sur ce téléphone. Copiez-le avant de continuer.')) return;
  openEditorSession(largeSelectionPending);
});
$('#editor-close').addEventListener('click', async () => {
  if (closingEditor) return;
  const unconfirmedInput = editQueued || outstandingEdit || localStorage.getItem(draftKey) !== null ||
    (editorConfirmed === null ? editorTouched : $('#editor-text').value !== editorConfirmed);
  if (unconfirmedInput && !preserveDraft()) return;
  const closeSession = !unconfirmedInput && editorSessionReady;
  $('#editor').classList.add('hidden'); editorOpen = false; editorSessionReady = false;
  if (unconfirmedInput) {
    notice('Un brouillon reste enregistré sur ce téléphone. Son application au PC est incertaine.');
  } else if (closeSession) {
    closingEditor = true;
    try {
      await send('close');
      editorSessionId = null; outstandingEdit = null;
      localStorage.removeItem(editorStateKey);
    } catch {
      notice('Fermeture PC non confirmée. Le texte reste conservé pour la prochaine ouverture.');
    } finally { closingEditor = false; }
  } else {
    notice('Session PC à vérifier. Rouvrez l’éditeur pour retrouver son texte.');
  }
});
$('#editor-text').addEventListener('compositionstart', () => { composing = true; editorTouched = true; editorRevision++; });
$('#editor-text').addEventListener('compositionend', () => { composing = false; editorTouched = true; preserveDraft(); queueEdit(); });
$('#editor-text').addEventListener('input', () => { editorTouched = true; editorRevision++; preserveDraft(); if (!composing) queueEdit(); });
async function queueEdit() {
  if (!draftStorageAvailable) return;
  if (!editorSessionReady) { preserveDraft(); return; }
  if (editQueued || composing) return;
  editQueued = true;
  while (editorOpen && editorSessionReady && $('#editor-text').value !== editorConfirmed && !composing) {
    const text = $('#editor-text').value;
    const position = $('#editor-text').selectionStart;
    try {
      const operationId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      outstandingEdit = { operationId, ...nextReplacementStep(editorConfirmed, text, position) };
    }
    catch (error) { editorSessionReady = false; preserveDraft(); editorStatus(error.message + ' Texte mobile conservé.', true); break; }
    if (!preserveDraft()) { outstandingEdit = null; break; }
    if (!saveEditorState()) { outstandingEdit = null; break; }
    editorStatus('Application sur le PC…');
    try {
      const { resultText, ...operation } = outstandingEdit;
      await send('edit', { session: editorSessionId, ...operation });
      editorConfirmed = resultText;
      outstandingEdit = null;
      if (!saveEditorState()) { editorSessionReady = false; break; }
      if ($('#editor-text').value === resultText) { localStorage.removeItem(draftKey); editorTouched = false; notice(''); }
      editorStatus('Texte appliqué sur le PC');
    } catch (error) {
      editorSessionReady = false; recoveryAvailable = true;
      $('#editor-reopen').textContent = 'Vérifier la dernière opération';
      $('#editor-reopen').classList.remove('hidden');
      editorStatus(error.message + ' Texte mobile conservé.', true); break;
    }
  }
  editQueued = false;
}
function saveEditorState() {
  if (!editorSessionId) return false;
  const outstanding = outstandingEdit && (({ operationId, start, end, text, position }) => ({ operationId, start, end, text, position }))(outstandingEdit);
  try { localStorage.setItem(editorStateKey, JSON.stringify({ session: editorSessionId, confirmed: editorConfirmed, outstanding })); return true; }
  catch { draftStorageAvailable = false; editorStatus('Stockage du téléphone saturé. Gardez cette page ouverte et copiez votre texte.', true); return false; }
}
async function recoverEditorSession() {
  if (!editorSessionId || !editorOpen || editQueued || recovering) return;
  recovering = true;
  let definitiveFailure = false;
  try {
    const includeText = editorConfirmed === null || (outstandingEdit && !outstandingEdit.resultText);
    const result = await send('inspect', { session: editorSessionId, operationId: outstandingEdit?.operationId || '', includeText });
    if (!editorOpen) return;
    if (result.state === 'uncertain' || result.state === 'context-changed') {
      definitiveFailure = true;
      throw new Error('Le résultat PC est incertain ou le contexte a changé. Copiez votre brouillon avant une nouvelle session.');
    }
    if (includeText) {
      if (typeof result.text !== 'string') throw new Error('Le PC n’a pas confirmé le texte de la session.');
      editorConfirmed = result.text;
    }
    if (outstandingEdit) {
      if (result.state === 'not-applied') {
        if (!Number.isInteger(outstandingEdit.start) || !Number.isInteger(outstandingEdit.end)) {
          definitiveFailure = true;
          throw new Error('Ancienne opération incompatible. Copiez votre brouillon avant une nouvelle session.');
        }
        const { resultText, ...operation } = outstandingEdit;
        await send('edit', { session: editorSessionId, ...operation });
        editorConfirmed = resultText ?? (editorConfirmed.slice(0, operation.start) + operation.text + editorConfirmed.slice(operation.end));
      } else {
        editorConfirmed = result.text ?? outstandingEdit.resultText;
      }
      outstandingEdit = null; saveEditorState();
    }
    if (draftStorageAvailable && localStorage.getItem(draftKey) === null && $('#editor-text').value === '') {
      $('#editor-text').value = editorConfirmed;
      editorTouched = false;
    }
    editorSessionReady = true;
    recoveryAvailable = false;
    if ($('#editor-text').value === editorConfirmed) {
      localStorage.removeItem(draftKey); editorTouched = false; notice('');
      editorStatus('Session PC retrouvée. Texte synchronisé.');
    } else {
      editorStatus('Session PC retrouvée. Application des modifications conservées…');
      queueEdit();
    }
    $('#editor-reopen').classList.add('hidden');
  } catch (error) {
    editorSessionReady = false;
    if (error.code === 'session_gone' || error.code === 'invalid_operation') definitiveFailure = true;
    recoveryAvailable = !definitiveFailure;
    $('#editor-reopen').textContent = recoveryAvailable ? 'Vérifier la session PC' : 'Ouvrir une nouvelle session sur le PC';
    editorStatus(`${error.message} Texte mobile conservé.`, true);
    $('#editor-reopen').classList.remove('hidden');
  } finally { recovering = false; }
}
let observationIndex = 0;
setInterval(async () => {
  if (!editorOpen || !editorSessionReady || !editorSessionId || outstandingEdit || editQueued || composing || observing || socket?.readyState !== WebSocket.OPEN) return;
  observing = true;
  const revision = editorRevision;
  const observedSession = editorSessionId;
  try {
    const verify = editorConfirmed.length <= 65_536 || ++observationIndex % 4 === 0;
    const result = await send('observe', { session: editorSessionId, verify });
    if (!editorOpen || editorSessionId !== observedSession) return;
    if (result.state === 'same') return;
    editorSessionReady = false;
    if (result.state === 'selection-changed' && editorRevision === revision && !composing && !editQueued && !outstandingEdit && $('#editor-text').value === editorConfirmed) {
      editorStatus('Nouvelle sélection sur le PC. Chargement de cette sélection…');
      await openEditorSession();
    } else {
      preserveDraft();
      editorStatus(`Contexte PC modifié (${result.state}). Texte mobile conservé ; vérifiez-le avant une nouvelle session.`, true);
      $('#editor-reopen').classList.remove('hidden');
    }
  } catch (error) {
    if (!editorOpen || editorSessionId !== observedSession) return;
    editorSessionReady = false;
    preserveDraft();
    editorStatus(`${error.message} Texte mobile conservé.`, true);
    $('#editor-reopen').classList.remove('hidden');
  } finally { observing = false; }
}, 750);
document.querySelectorAll('[data-editor-key]').forEach(button => {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    const name = button.dataset.editorKey;
    const editor = $('#editor-text');
    if (name === 'Enter' || name === 'Tab') {
      if (composing) { editorStatus('Terminez la composition du clavier avant cette touche.', true); return; }
      if (modifiers.size) { editorStatus('Désactivez les modificateurs avant de saisir Entrée ou Tab.', true); return; }
      editor.setRangeText(name === 'Enter' ? '\n' : '\t', editor.selectionStart, editor.selectionEnd, 'end');
      editorTouched = true;
      editorRevision++;
      preserveDraft(); queueEdit();
    } else pressKey(name);
    editor.focus();
  });
});
connect();
