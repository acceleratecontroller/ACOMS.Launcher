'use strict';

// Renderer for the picker window. Talks to the main process only through the
// safe `window.acoms` bridge defined in preload.js.

const listEl = document.getElementById('portal-list');

let portals = [];
let openIds = new Set();

function render() {
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

async function init() {
  const data = await window.acoms.getPortals();
  portals = data.portals || [];
  openIds = new Set(data.openIds || []);
  render();

  // Live-update the open indicators as portal windows open and close.
  window.acoms.onOpenStateChanged((ids) => {
    openIds = new Set(ids || []);
    render();
  });
}

init();
