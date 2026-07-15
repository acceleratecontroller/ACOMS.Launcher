'use strict';

// Renderer for the picker window. Talks to the main process only through the
// safe `window.acoms` bridge defined in preload.js.

const listEl = document.getElementById('portal-list');
const quickNoteSlot = document.getElementById('quicknote-slot');

let portals = [];
let quickNote = null;
let quickNoteId = '__quicknote__';
let openIds = new Set();

function renderQuickNote() {
  quickNoteSlot.innerHTML = '';
  if (!quickNote) return;

  const isOpen = openIds.has(quickNoteId);

  const btn = document.createElement('button');
  btn.className = 'quicknote';
  btn.type = 'button';
  btn.title = isOpen
    ? `${quickNote.name} is open — bring it to the front`
    : quickNote.name;

  const icon = document.createElement('span');
  icon.className = 'quicknote__icon';
  icon.textContent = '📝';

  const text = document.createElement('span');
  text.className = 'quicknote__text';

  const name = document.createElement('span');
  name.className = 'quicknote__name';
  name.textContent = quickNote.name;

  const tagline = document.createElement('span');
  tagline.className = 'quicknote__tagline';
  tagline.textContent = quickNote.tagline || '';

  text.appendChild(name);
  text.appendChild(tagline);

  const dot = document.createElement('span');
  dot.className = isOpen ? 'dot dot--open' : 'dot';

  btn.appendChild(icon);
  btn.appendChild(text);
  btn.appendChild(dot);

  btn.addEventListener('click', () => {
    window.acoms.openQuickNote();
  });

  quickNoteSlot.appendChild(btn);
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

function render() {
  renderQuickNote();
  renderPortals();
}

async function init() {
  const data = await window.acoms.getPortals();
  portals = data.portals || [];
  quickNote = data.quickNote || null;
  if (data.quickNoteId) quickNoteId = data.quickNoteId;
  openIds = new Set(data.openIds || []);
  render();

  // Live-update the open indicators as portal / quick-note windows open and close.
  window.acoms.onOpenStateChanged((ids) => {
    openIds = new Set(ids || []);
    render();
  });
}

init();
