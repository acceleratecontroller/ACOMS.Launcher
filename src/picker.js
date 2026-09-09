'use strict';

// Renderer for the picker window. Talks to the main process only through the
// safe `window.acoms` bridge defined in preload.js.

const listEl = document.getElementById('portal-list');
const quickNoteSlot = document.getElementById('quicknote-slot');
const updateSlot = document.getElementById('update-slot');

let portals = [];
let quickNote = null;
let openIds = new Set();
let appVersion = '';
let update = null;

function makeQuickNoteHalf(icon, label, action) {
  const btn = document.createElement('button');
  btn.className = `quicknote__half quicknote__half--${action}`;
  btn.type = 'button';
  btn.title = label;

  const iconEl = document.createElement('span');
  iconEl.className = 'quicknote__icon';
  iconEl.textContent = icon;

  const labelEl = document.createElement('span');
  labelEl.className = 'quicknote__label';
  labelEl.textContent = label;

  btn.appendChild(iconEl);
  btn.appendChild(labelEl);

  btn.addEventListener('click', () => {
    window.acoms.openQuickNote(action);
  });
  return btn;
}

function renderQuickNote() {
  quickNoteSlot.innerHTML = '';
  if (!quickNote) return;

  const strip = document.createElement('div');
  strip.className = 'quicknote';

  if (quickNote.hasNew) {
    strip.appendChild(makeQuickNoteHalf('📝', quickNote.newLabel || 'New Note', 'new'));
  }
  if (quickNote.hasView) {
    strip.appendChild(makeQuickNoteHalf('🗂️', quickNote.viewLabel || 'View Notes', 'view'));
  }

  quickNoteSlot.appendChild(strip);
}

function renderPortals() {
  listEl.innerHTML = '';

  if (portals.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      'No portals found. Check portals.json in the project folder.';
    listEl.appendChild(empty);
    return;
  }

  for (const portal of portals) {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';

    const isOpen = openIds.has(portal.id);
    card.title = isOpen
      ? `${portal.name} is open — bring it to the front`
      : `Open ${portal.name}`;

    const dot = document.createElement('span');
    dot.className = isOpen ? 'dot dot--open' : 'dot';

    const text = document.createElement('span');
    text.className = 'card__text';

    const name = document.createElement('span');
    name.className = 'card__name';
    name.textContent = portal.name || portal.id;

    const tagline = document.createElement('span');
    tagline.className = 'card__tagline';
    tagline.textContent = portal.tagline || '';

    text.appendChild(name);
    text.appendChild(tagline);

    card.appendChild(text);
    card.appendChild(dot);

    card.addEventListener('click', () => {
      window.acoms.openPortal(portal.id);
    });

    listEl.appendChild(card);
  }
}

// The footer shows the version at all times and an action only when there is
// something to act on. An update that can't be applied (unsigned macOS) still
// gets a button — it opens the download page rather than restarting.
function renderUpdate() {
  updateSlot.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'update__label';
  const status = update ? update.status : 'idle';

  if (status === 'downloading') {
    label.textContent = update.message || 'Downloading update…';
  } else if (status === 'ready' || status === 'manual') {
    label.textContent = update.newVersion ? `v${update.newVersion} ready` : 'Update ready';
  } else {
    label.textContent = appVersion ? `v${appVersion}` : '';
  }
  label.title = (update && update.message) || `ACOMS Launcher ${appVersion}`;
  updateSlot.appendChild(label);

  if (status === 'ready' || status === 'manual') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'update__action';
    btn.textContent = status === 'ready' ? 'Restart' : 'Download';
    btn.title =
      status === 'ready'
        ? 'Restart the launcher to apply the update'
        : 'Open the releases page to download the update';
    btn.addEventListener('click', () => window.acoms.installUpdate());
    updateSlot.appendChild(btn);
  } else if (status !== 'downloading' && status !== 'checking') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'update__action update__action--quiet';
    btn.textContent = 'Check';
    btn.title = 'Check for updates';
    btn.addEventListener('click', () => window.acoms.checkForUpdates());
    updateSlot.appendChild(btn);
  }
}

function render() {
  renderQuickNote();
  renderPortals();
  renderUpdate();
}

async function init() {
  const data = await window.acoms.getPortals();
  portals = data.portals || [];
  quickNote = data.quickNote || null;
  openIds = new Set(data.openIds || []);

  const info = await window.acoms.getAppInfo();
  appVersion = info.version || '';
  update = info.update || null;

  render();

  // Live-update the open indicators as portal / quick-note windows open and close.
  window.acoms.onOpenStateChanged((ids) => {
    openIds = new Set(ids || []);
    render();
  });

  window.acoms.onUpdateChanged((snapshot) => {
    update = snapshot || null;
    renderUpdate();
  });
}

init();
