'use strict';

// Renderer for the picker window. Talks to the main process only through the
// safe `window.acoms` bridge defined in preload.js.

const listEl = document.getElementById('portal-list');
const quickNoteSlot = document.getElementById('quicknote-slot');
const updateSlot = document.getElementById('update-slot');
const subtitleEl = document.getElementById('subtitle');
const settingsPanel = document.getElementById('settings-panel');
const settingsToggle = document.getElementById('settings-toggle');

let portals = [];
let quickNote = null;
let openIds = new Set();
let appVersion = '';
let update = null;
let notifications = {};
let settings = { muted: [], quietFrom: null, quietTo: null };

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

// What sits on the right of a portal card, if anything.
//   a count   — that many things are waiting on you
//   "Sign in" — the portal logged us out; say so rather than showing nothing,
//               because a silent zero is indistinguishable from "all clear"
//   "Muted"   — you turned this one off; the count is deliberately hidden
//   "?"       — unreachable; quiet, since it's usually just the network
function makeBadge(portal) {
  const n = notifications[portal.id];
  if (!n || n.state === 'off' || n.state === 'idle') return null;

  const el = document.createElement('span');

  if (settings.muted.includes(portal.id)) {
    el.className = 'badge badge--muted';
    el.textContent = 'Muted';
    el.title = `Notifications from ${portal.name} are muted`;
    return el;
  }

  if (n.state === 'signIn') {
    el.className = 'badge badge--signin';
    el.textContent = 'Sign in';
    el.title = `${portal.name} needs you to sign in again before it can tell you what's waiting`;
    return el;
  }

  if (n.state === 'error') {
    el.className = 'badge badge--error';
    el.textContent = '?';
    el.title = `Couldn't reach ${portal.name}${n.message ? ` (${n.message})` : ''}`;
    return el;
  }

  if (n.state === 'ok' && n.badge > 0) {
    el.className = 'badge';
    el.textContent = String(n.badge);
    el.title = n.summary || `${n.badge} waiting in ${portal.name}`;
    return el;
  }

  return null;
}

// The subtitle doubles as the one-line "what's waiting" line, so the answer is
// visible the moment the picker opens without expanding anything.
function renderSubtitle() {
  let total = 0;
  const bits = [];
  for (const portal of portals) {
    const n = notifications[portal.id];
    if (!n || n.state !== 'ok' || settings.muted.includes(portal.id)) continue;
    if (n.badge > 0) {
      total += n.badge;
      bits.push(`${n.badge} in ${portal.name.replace(/^ACOMS\./, '')}`);
    }
  }
  subtitleEl.textContent = total === 0 ? 'Pick a portal to open' : bits.join(' · ');
}

function renderSettings() {
  settingsPanel.innerHTML = '';

  const pollable = portals.filter((p) => {
    const n = notifications[p.id];
    return n && n.state !== 'off';
  });

  const h1 = document.createElement('p');
  h1.className = 'settings__heading';
  h1.textContent = 'Notify me about';
  settingsPanel.appendChild(h1);

  if (pollable.length === 0) {
    const note = document.createElement('p');
    note.className = 'settings__note';
    note.textContent = 'No portals report notifications yet.';
    settingsPanel.appendChild(note);
  }

  for (const portal of pollable) {
    const row = document.createElement('label');
    row.className = 'settings__row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !settings.muted.includes(portal.id);
    box.addEventListener('change', async () => {
      settings = await window.acoms.setMuted(portal.id, !box.checked);
      render();
    });

    const name = document.createElement('span');
    name.textContent = portal.name;

    row.appendChild(box);
    row.appendChild(name);
    settingsPanel.appendChild(row);
  }

  const h2 = document.createElement('p');
  h2.className = 'settings__heading';
  h2.textContent = 'Quiet hours';
  settingsPanel.appendChild(h2);

  const times = document.createElement('div');
  times.className = 'settings__times';

  const from = document.createElement('input');
  from.type = 'time';
  from.value = settings.quietFrom || '';
  const to = document.createElement('input');
  to.type = 'time';
  to.value = settings.quietTo || '';

  const apply = async () => {
    settings = await window.acoms.setQuietHours(from.value || null, to.value || null);
    renderSettings();
  };
  from.addEventListener('change', apply);
  to.addEventListener('change', apply);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear';
  clear.addEventListener('click', async () => {
    settings = await window.acoms.setQuietHours(null, null);
    renderSettings();
  });

  const dash = document.createElement('span');
  dash.textContent = 'to';

  times.appendChild(from);
  times.appendChild(dash);
  times.appendChild(to);
  times.appendChild(clear);
  settingsPanel.appendChild(times);

  const note = document.createElement('p');
  note.className = 'settings__note';
  note.textContent = settings.quietFrom
    ? 'No notifications during these hours. Counts still update, so nothing is lost — you just are not interrupted.'
    : 'Set both times to stop notifications overnight. A range may cross midnight.';
  settingsPanel.appendChild(note);
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

    const badge = makeBadge(portal);

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
    if (badge) card.appendChild(badge);
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

  if (status === 'checking') {
    label.textContent = 'Checking…';
  } else if (status === 'downloading') {
    label.textContent = update.message || 'Downloading update…';
  } else if (status === 'ready' || status === 'manual') {
    label.textContent = update.newVersion ? `v${update.newVersion} ready` : 'Update ready';
  } else if (status === 'error') {
    // Say what went wrong. A silent failure here is what made a stuck
    // update look like a broken button.
    label.textContent = update.message || 'Update failed';
  } else {
    label.textContent = appVersion ? `v${appVersion}` : '';
  }
  label.title = (update && update.message) || `ACOMS Launcher ${appVersion}`;
  updateSlot.appendChild(label);

  // There is ALWAYS a button. The first version rendered none while checking
  // or downloading, so a download stuck retrying left no way to do anything —
  // which reads as "the check button doesn't work".
  const btn = document.createElement('button');
  btn.type = 'button';

  if (status === 'ready' || status === 'manual') {
    btn.className = 'update__action';
    btn.textContent = status === 'ready' ? 'Restart' : 'Download';
    btn.title =
      status === 'ready'
        ? 'Restart the launcher to apply the update'
        : 'Open the releases page to download it yourself';
    btn.addEventListener('click', () => window.acoms.installUpdate());
  } else if (status === 'checking' || status === 'downloading') {
    btn.className = 'update__action update__action--quiet';
    btn.textContent = status === 'checking' ? 'Checking…' : `${update.percent || 0}%`;
    btn.disabled = true;
    btn.title = 'In progress — this gives up after 3 minutes rather than hanging';
  } else {
    btn.className = 'update__action update__action--quiet';
    btn.textContent = status === 'error' ? 'Retry' : 'Check';
    btn.title = status === 'error' ? 'Try checking again' : 'Check for updates';
    btn.addEventListener('click', () => window.acoms.checkForUpdates());
  }

  updateSlot.appendChild(btn);
}

function render() {
  renderQuickNote();
  renderPortals();
  renderUpdate();
  renderSubtitle();
  if (!settingsPanel.hidden) renderSettings();
}

async function init() {
  const data = await window.acoms.getPortals();
  portals = data.portals || [];
  quickNote = data.quickNote || null;
  openIds = new Set(data.openIds || []);

  const info = await window.acoms.getAppInfo();
  appVersion = info.version || '';
  update = info.update || null;

  settings = await window.acoms.getSettings();
  notifications = await window.acoms.getNotifications();

  settingsToggle.addEventListener('click', () => {
    const opening = settingsPanel.hidden;
    settingsPanel.hidden = !opening;
    settingsToggle.setAttribute('aria-expanded', String(opening));
    if (opening) renderSettings();
  });

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

  window.acoms.onNotificationsChanged((snapshot) => {
    notifications = snapshot || {};
    render();
  });

  // Opening the picker is a good moment to be current — you came here to look.
  window.acoms.refreshNotifications();
}

init();
