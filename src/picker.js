'use strict';

// Renderer for the picker window. Talks to the main process only through the
// safe `window.acoms` bridge defined in preload.js.

const listEl = document.getElementById('portal-list');
const leaveSlot = document.getElementById('leave-slot');
const leavePanel = document.getElementById('leave-panel');
const keyDatesEl = document.getElementById('key-dates');
const leavePanelList = document.getElementById('leave-panel-list');
const updateSlot = document.getElementById('update-slot');
const subtitleEl = document.getElementById('subtitle');
const settingsPanel = document.getElementById('settings-panel');
const settingsToggle = document.getElementById('settings-toggle');

let portals = [];
let upcomingLeave = { status: 'off', lines: [], more: '', all: [] };
let openIds = new Set();
let appVersion = '';
let update = null;
let notifications = {};
let settings = { muted: [], quietFrom: null, quietTo: null };

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

  renderJobFolders();
}

// Job folders: where this computer's synced ACOMS SharePoint folder is, so
// "Open folder" on a chat job card can open the job's folder (job-folder.js).
async function renderJobFolders() {
  const section = document.createElement('div');
  settingsPanel.appendChild(section);

  const draw = (jobs) => {
    section.innerHTML = '';
    const h = document.createElement('p');
    h.className = 'settings__heading';
    h.textContent = 'Job folders';
    section.appendChild(h);

    const where = document.createElement('p');
    where.className = 'settings__note settings__path';
    where.textContent = jobs.root
      ? `${jobs.root}${jobs.chosen ? '' : ' (found automatically)'}`
      : 'Not set';
    section.appendChild(where);

    const buttons = document.createElement('div');
    buttons.className = 'settings__times settings__buttons';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = jobs.root ? 'Change…' : 'Choose…';
    choose.addEventListener('click', async () => draw(await window.acoms.chooseJobsRoot()));
    buttons.appendChild(choose);
    if (jobs.chosen) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Clear';
      clear.addEventListener('click', async () => draw(await window.acoms.clearJobsRoot()));
      buttons.appendChild(clear);
    }
    section.appendChild(buttons);

    const help = document.createElement('p');
    help.className = 'settings__note';
    help.textContent = !jobs.root
      ? 'Pick your synced ACOMS SharePoint folder — the one holding "SEQ - Client Projects - Documents". Then "Open folder" on a job in chat opens it here.'
      : jobs.libraries.length > 0
        ? `Synced here: ${jobs.libraries.map((l) => l.split(' - ')[0]).join(', ')}.`
        : 'No synced libraries in this folder — pick the one holding "SEQ - Client Projects - Documents".';
    section.appendChild(help);
  };

  try {
    draw(await window.acoms.getJobsRoot());
  } catch {
    section.remove();
  }
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
    listEl.appendChild(makeCard(portal));
  }
}

// A portal's tile. Since 2026-09-22 (Dion: "open more than one window of an
// app from the Launcher" / "split the WIP button in two — ACOMS.WIP |
// Scheduler"):
//   - the main half opens/focuses the portal; Shift-click opens ANOTHER window
//   - a small "+" on the right does the same as Shift-click, for mouse users
//   - each named view (portals.json `views`) is a further half with a dot of
//     its own, on the Quick Note strip's split pattern
function makeCard(portal) {
  const views = Array.isArray(portal.views) ? portal.views : [];
  const wrap = document.createElement('div');
  wrap.className = views.length ? 'card card--split' : 'card';

  wrap.appendChild(makeHalf(portal, null));
  for (const view of views) wrap.appendChild(makeHalf(portal, view));

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'card__plus';
  plus.textContent = '+';
  plus.title = `Open another ${portal.name} window (or Shift-click the tile)`;
  plus.setAttribute('aria-label', plus.title);
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    window.acoms.openPortal(portal.id, { newWindow: true });
  });
  wrap.appendChild(plus);

  return wrap;
}

function makeHalf(portal, view) {
  const key = view ? `${portal.id}#${view.id}` : portal.id;
  const label = view ? view.label : portal.name || portal.id;
  const half = document.createElement('button');
  half.type = 'button';
  half.className = view ? 'card__half card__half--view' : 'card__half';

  const isOpen = openIds.has(key);
  half.title = isOpen
    ? `${label} is open — bring it to the front (Shift-click for another window)`
    : `Open ${label}`;

  const text = document.createElement('span');
  text.className = 'card__text';

  const name = document.createElement('span');
  name.className = 'card__name';
  name.textContent = label;

  const tagline = document.createElement('span');
  tagline.className = 'card__tagline';
  tagline.textContent = (view ? view.tagline : portal.tagline) || '';

  text.appendChild(name);
  text.appendChild(tagline);
  half.appendChild(text);

  if (!view) {
    const badge = makeBadge(portal);
    if (badge) half.appendChild(badge);
  }

  const dot = document.createElement('span');
  dot.className = isOpen ? 'dot dot--open' : 'dot';
  half.appendChild(dot);

  half.addEventListener('click', (e) => {
    window.acoms.openPortal(portal.id, {
      view: view ? view.id : undefined,
      newWindow: e.shiftKey
    });
  });
  return half;
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
  renderPortals();
  renderUpdate();
  renderSubtitle();
  if (!settingsPanel.hidden) renderSettings();
}

// Upcoming leave, soonest first, above the portal list. The strip
// always takes the same room, so nothing below it moves when the list
// arrives (Dion 2026-11-25): it says it is loading, then who is off, or that
// nobody is. Only a Launcher with no leave set up has no strip.
function renderUpcomingLeave() {
  leaveSlot.textContent = '';
  const status = (upcomingLeave && upcomingLeave.status) || 'off';
  if (status === 'off') return;
  const lines = (upcomingLeave && upcomingLeave.lines) || [];

  // The whole strip is one button: it opens everyone's leave, for a quick look.
  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'leave';
  box.title = 'See everyone\'s leave';
  box.addEventListener('click', () => {
    renderLeavePanel();
    leavePanel.hidden = false;
  });
  const title = document.createElement('div');
  title.className = 'leave__title';
  title.textContent = 'Upcoming leave';
  box.appendChild(title);

  if (lines.length === 0) {
    const note = document.createElement('div');
    note.className = 'leave__note';
    note.textContent =
      status === 'loading' ? 'Loading leave…' : status === 'unavailable' ? 'Leave is not available right now' : 'No one on leave';
    box.appendChild(note);
  }

  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'leave__row';
    const name = document.createElement('span');
    name.className = 'leave__name';
    name.textContent = line.name;
    const when = document.createElement('span');
    when.className = 'leave__when';
    when.textContent = line.when;
    row.appendChild(name);
    row.appendChild(when);
    // One line per person: their next leave, and how many more they have after it.
    if (line.extra > 0) {
      const extra = document.createElement('span');
      extra.className = 'leave__extra';
      extra.textContent = `+${line.extra} more`;
      extra.title = `${line.extra} more leave ${line.extra === 1 ? 'entry' : 'entries'} after this one`;
      row.appendChild(extra);
    }
    if (line.pending) {
      const tag = document.createElement('span');
      tag.className = 'leave__pending';
      tag.textContent = 'pending';
      tag.title = 'Asked for, not yet approved';
      row.appendChild(tag);
    }
    box.appendChild(row);
  }
  // A fifth line when more than four people are off: how many others, and when the next starts.
  if (upcomingLeave.more) {
    const more = document.createElement('div');
    more.className = 'leave__more';
    more.textContent = upcomingLeave.more;
    box.appendChild(more);
  }
  leaveSlot.appendChild(box);
}

// Everyone's upcoming leave, person by person, every stretch. Shown over the
// picker when the strip is clicked; redrawn if the list changes while open.
// Beside the cog: the next RDO, and the next public holiday when one is
// within a month. Two short lines; nothing until they are known.
function renderKeyDates() {
  keyDatesEl.textContent = '';
  const d = (upcomingLeave && upcomingLeave.dates) || {};
  const add = (label, when, title) => {
    const row = document.createElement('div');
    row.className = 'keydates__row';
    row.title = title;
    const l = document.createElement('span');
    l.className = 'keydates__label';
    l.textContent = label;
    const w = document.createElement('span');
    w.className = 'keydates__when';
    w.textContent = when;
    row.appendChild(l);
    row.appendChild(w);
    keyDatesEl.appendChild(row);
  };
  if (d.rdo) add('RDO', d.rdo, `Next RDO: ${d.rdo}`);
  if (d.holiday) add(d.holiday.name, d.holiday.when, `Next public holiday: ${d.holiday.name}, ${d.holiday.when}`);
}

function renderLeavePanel() {
  leavePanelList.textContent = '';
  const all = (upcomingLeave && upcomingLeave.all) || [];
  if (all.length === 0) {
    const note = document.createElement('div');
    note.className = 'leavepanel__none';
    const status = (upcomingLeave && upcomingLeave.status) || 'off';
    note.textContent =
      status === 'loading' ? 'Loading leave…' : status === 'unavailable' ? 'Leave is not available right now' : 'No one on leave';
    leavePanelList.appendChild(note);
    return;
  }
  for (const person of all) {
    const block = document.createElement('div');
    block.className = 'leavepanel__person';
    const name = document.createElement('div');
    name.className = 'leavepanel__name';
    name.textContent = person.name;
    block.appendChild(name);
    for (const item of person.items || []) {
      const row = document.createElement('div');
      row.className = 'leavepanel__item';
      const when = document.createElement('span');
      when.textContent = item.when;
      row.appendChild(when);
      if (item.pending) {
        const tag = document.createElement('span');
        tag.className = 'leave__pending';
        tag.textContent = 'pending';
        tag.title = 'Asked for, not yet approved';
        row.appendChild(tag);
      }
      block.appendChild(row);
    }
    leavePanelList.appendChild(block);
  }
}

async function init() {
  const data = await window.acoms.getPortals();
  portals = data.portals || [];
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

  upcomingLeave = (await window.acoms.getUpcomingLeave()) || { status: 'off', lines: [], more: '', all: [] };
  renderUpcomingLeave();
  renderKeyDates();
  window.acoms.onUpcomingLeaveChanged((next) => {
    upcomingLeave = next || { status: 'off', lines: [], more: '', all: [] };
    renderUpcomingLeave();
  renderKeyDates();
    if (!leavePanel.hidden) renderLeavePanel();
  });
  // The Calendar window's button, when this Launcher has a calendar set up.
  const calendarOpen = document.getElementById('calendar-open');
  calendarOpen.hidden = !(await window.acoms.calendarEnabled());
  calendarOpen.addEventListener('click', () => window.acoms.openCalendar());

  document.getElementById('leave-panel-close').addEventListener('click', () => {
    leavePanel.hidden = true;
  });
  document.getElementById('leave-panel-open').addEventListener('click', () => {
    leavePanel.hidden = true;
    window.acoms.openLeaveList();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !leavePanel.hidden) leavePanel.hidden = true;
  });

  render();

  // Live-update the open indicators as portal windows open and close.
  window.acoms.onOpenStateChanged((ids) => {
    openIds = new Set(ids || []);
    render();
  });

  // A local-only portal (the Brain Console) started or stopped answering on this computer.
  window.acoms.onPortalsChanged((list) => {
    portals = list || [];
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
