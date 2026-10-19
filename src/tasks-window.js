'use strict';

// The Tasks window (tasks.html). Everything it shows comes from tasks.js in the
// main process through window.acomsTasks; everything it does goes back the same
// way. The rules (filters, grouping, due pills) are tasks-rules.js, shared with
// the main process and the tests, and copied from Controller's /tasks page.

const api = window.acomsTasks;
const R = window.acomsTasksRules;

let state = null;
const ui = {
  tab: 'quick',
  filter: 'all',
  owner: null, // null = not chosen yet (defaults to me once known); '' = all owners
  archived: false,
  notesArchived: false,
  // ACOMS Tasks: all | unclaimed | mine | dismissed, and whether done ones show.
  companyFilter: 'all',
  companyShowDone: false,
  // Recurring: its own filter / owner / archive, and list or calendar.
  recFilter: 'all',
  recOwner: null,
  recArchived: false,
  recView: 'list',
  recMonth: null, // { y, m } shown in the calendar; null = this month
  dialog: null // { kind: 'task' | 'recurring' | 'note' | 'confirm', ... }
};

// ── Little DOM helpers ─────────────────────────────────────────────────────

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

const $ = (id) => document.getElementById(id);

const ICONS = {
  check: 'M4.5 12.75l6 6 9-13.5',
  undo: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3',
  archive:
    'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
  restore:
    'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182',
  mail:
    'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75',
  pin: 'M16.5 3.75l3.75 3.75-4.5 1.5-3.75 3.75.75 4.5-1.5 1.5-3-3-4.5 4.5-.75-.75 4.5-4.5-3-3 1.5-1.5 4.5.75 3.75-3.75 1.5-4.5z',
  toTask:
    'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  trash:
    'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0'
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

function iconButton(name, title, onClick, extra = '') {
  const b = el('button', `icon-btn ${extra}`.trim());
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(icon(name));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

// A link that opens like any other in the Launcher: an ACOMS portal page in
// that portal's window (WIP for a job), anything else in the browser.
function link(href, cls, text, title) {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  if (title) a.title = title;
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('') : '?';
}

function assigneeById(id) {
  return (state.assignees || []).find((a) => a.id === id) || null;
}

function ownerName(id) {
  const a = assigneeById(id);
  return a ? R.assigneeName(a) : id || '';
}

// ── Doing things ───────────────────────────────────────────────────────────

async function act(action) {
  const res = await api.act(action);
  return res || { ok: false, error: 'No answer' };
}

function complete(task) {
  act({ type: 'task:complete', id: task.id });
}

function archiveTask(task) {
  confirmDialog({
    title: 'Archive task?',
    body: `"${task.title}" moves to the archive. You can restore it from there.`,
    okLabel: 'Archive',
    danger: true,
    onOk: () => act({ type: 'task:archive', id: task.id })
  });
}

function restoreTask(task) {
  act({ type: 'task:restore', id: task.id });
}

// "Type a task and press Enter": yours, due tomorrow, low priority — the full
// form's own defaults. Without knowing which employee you are it can't assign
// it, so the full form opens instead.
async function quickAdd(title) {
  const text = title.trim();
  if (!text) return;
  if (!state.myEmployeeId) {
    openTaskForm({ title: text });
    return;
  }
  const fields = {
    title: text,
    projectId: null,
    notes: null,
    label: 'Task',
    dueDate: R.tomorrowIso(),
    status: 'NOT_STARTED',
    priority: 'LOW',
    assigneeId: state.myEmployeeId
  };
  $('quick-add-input').value = '';
  const res = await act({ type: 'task:create', fields });
  if (!res.ok) {
    $('quick-add-input').value = text; // nothing lost
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function render() {
  if (!state) return;
  renderTop();
  renderNotice();
  renderCompany();
  renderQuick();
  renderRecurring();
  renderNotes();
}

function counts(b) {
  const out = [];
  if (b.overdue) out.push(['overdue', b.overdue, 'overdue']);
  if (b.dueToday) out.push(['today', b.dueToday, 'due today']);
  if (b.dueSoon) out.push(['soon', b.dueSoon, 'due this week']);
  return out.map(([tone, n, what]) => {
    const s = el('span', `count count--${tone}`, String(n));
    s.title = `${n} ${what}`;
    return s;
  });
}

function renderTop() {
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('tab--on', b.dataset.tab === ui.tab);
  for (const tab of ['acoms', 'quick', 'recurring', 'notes']) $(`pane-${tab}`).hidden = ui.tab !== tab;

  const own = (list) => (list || []).filter((t) => !state.myEmployeeId || t.assigneeId === state.myEmployeeId);
  $('badge-quick').replaceChildren(...counts(R.taskBadges(own(state.quick))));
  $('badge-recurring').replaceChildren(...counts(R.recurringBadges(own(state.recurring))));
  const cb = R.companyBadges(state.company, state.myEmployeeId);
  const acoms = [];
  if (cb.unclaimed) {
    const s = el('span', 'count count--today', String(cb.unclaimed));
    s.title = `${cb.unclaimed} unclaimed`;
    acoms.push(s);
  }
  if (cb.mine) {
    const s = el('span', 'count count--plain', String(cb.mine));
    s.title = `${cb.mine} with you`;
    acoms.push(s);
  }
  $('badge-acoms').replaceChildren(...acoms);
  const noteCount = (state.notes || []).length;
  $('badge-notes').replaceChildren(...(noteCount ? [el('span', 'count count--plain', String(noteCount))] : []));

  $('me').textContent = state.me && state.me.name ? state.me.name : '';
}

function renderNotice() {
  const box = $('notice');
  const parts = [];
  if (state.status === 'idle') parts.push([el('span', 'notice__text', 'Loading your tasks…')]);
  else if (state.status === 'signIn') {
    const b = el('button', 'btn btn--primary', 'Sign in');
    b.type = 'button';
    b.addEventListener('click', () => api.signIn());
    parts.push([el('span', 'notice__text', 'Your Controller sign-in has run out. Sign in and this window picks up straight away.'), b]);
  } else if (state.status === 'error') {
    const b = el('button', 'btn', 'Try again');
    b.type = 'button';
    b.addEventListener('click', () => api.retry());
    const shown = state.quick && state.quick.length ? ' Showing what was there last.' : '';
    parts.push([el('span', 'notice__text', `Can't reach Controller (${state.errorMessage || 'no answer'}).${shown}`), b]);
  } else if (state.status === 'unavailable') {
    parts.push([el('span', 'notice__text', "This Controller doesn't have the Tasks feed yet.")]);
  } else if (state.status === 'ok' && !state.isAdmin && ui.tab !== 'acoms') {
    parts.push([el('span', 'notice__text', 'Quick Tasks, Recurring Tasks and Quick Notes are for admins for now.')]);
  }
  box.hidden = parts.length === 0;
  box.replaceChildren(...(parts[0] || []));

  const err = $('action-error');
  err.hidden = !state.actionError;
  if (state.actionError) {
    const x = el('button', 'icon-btn', '✕');
    x.type = 'button';
    x.title = 'Dismiss';
    x.addEventListener('click', () => api.clearError());
    err.replaceChildren(el('span', 'action-error__text', state.actionError), x);
  }
}

const CHIPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'due-today', label: 'Due Today' },
  { key: 'due-soon', label: 'Due Soon' }
];

function renderQuick() {
  // The owner filter starts on "my tasks", as the page does.
  if (ui.owner === null && state.myEmployeeId) ui.owner = state.myEmployeeId;

  const archived = ui.archived;
  const source = archived ? state.archivedQuick || [] : state.quick || [];

  const tog = $('toggle-archived');
  tog.textContent = archived ? 'Showing Archived' : 'Active';
  tog.classList.toggle('btn--on', archived);

  $('chips').replaceChildren(
    ...CHIPS.map((c) => {
      const b = el('button', `chip${ui.filter === c.key ? ' chip--on' : ''}`, c.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        ui.filter = ui.filter === c.key ? 'all' : c.key;
        render();
      });
      return b;
    })
  );
  const more = $('more-filter');
  more.value = ['all', 'pending', 'completed', 'high'].includes(ui.filter) ? ui.filter : 'all';
  more.classList.toggle('select--on', ['pending', 'completed', 'high'].includes(ui.filter));

  const ownerSel = $('owner-filter');
  const ownerIds = [...new Set(source.map((t) => t.assigneeId))];
  if (ui.owner && !ownerIds.includes(ui.owner)) ownerIds.push(ui.owner);
  const owners = ownerIds
    .map((id) => ({ id, name: id === state.myEmployeeId ? `${ownerName(id)} (me)` : ownerName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Rebuilt only when the people change, so a refresh never snaps shut a
  // dropdown that is open.
  const ownerKey = owners.map((o) => `${o.id}:${o.name}`).join('|');
  if (ownerSel.dataset.key !== ownerKey) {
    ownerSel.dataset.key = ownerKey;
    ownerSel.replaceChildren(new Option('All Owners', ''), ...owners.map((o) => new Option(o.name, o.id)));
  }
  ownerSel.value = ui.owner || '';
  ownerSel.classList.toggle('select--on', Boolean(ui.owner));

  $('add-task').disabled = !state.isAdmin;
  $('quick-add-input').disabled = !state.isAdmin;

  const list = $('task-list');
  const shown = R.filterTasks(source, { filter: ui.filter, owner: ui.owner || '', archived });
  if (shown.length === 0) {
    const what = state.status === 'idle' ? 'Loading…' : archived ? 'No archived tasks here' : 'No tasks found';
    list.replaceChildren(el('div', 'empty', what));
    return;
  }
  const nodes = [];
  for (const g of R.groupTasks(shown)) {
    nodes.push(el('div', 'group', `${g.label} · ${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'}`));
    for (const t of g.tasks) nodes.push(taskRow(t));
  }
  list.replaceChildren(...nodes);
}

function taskRow(task) {
  const done = task.status === 'COMPLETED';
  const pill = R.duePill(task);
  const row = el('div', `row row--${task.priority || 'LOW'}`);
  if (!done && pill.tone === 'overdue') row.classList.add('row--overdue');
  if (!done && pill.tone === 'today') row.classList.add('row--today');
  if (done) row.classList.add('row--done');
  if (task._pending) row.classList.add('row--saving');
  if (!task._pending) row.addEventListener('click', () => openTaskForm(task));

  const main = el('div', 'row__main');
  const line = el('div', 'row__line');
  const title = el('span', 'row__title', task.title);
  title.title = task.title;
  line.append(title);
  if (task.label && task.label !== 'Task') line.append(el('span', 'pill', task.label));
  // The job it's tagged with opens in WIP's window (Dion: "job look ups etc
  // ... would all have to work as well").
  const job = R.jobNumberOf(task.projectId) || (!task.projectId && R.jobNumberOf(task.title));
  if (task.projectId || job) {
    const text = task.projectId || job;
    line.append(
      job && state.jobLinkBase
        ? link(state.jobLinkBase + encodeURIComponent(job), 'pill pill--job', text, `Open ${job} in WIP`)
        : el('span', 'pill pill--job', text)
    );
  }
  main.append(line);
  if (task.notes) main.append(el('p', 'row__notes', task.notes));
  row.append(main);

  if (task.status !== 'NOT_STARTED' && !done) row.append(el('span', `pill pill--${task.status}`, R.statusLabel(task.status)));
  if (task.priority === 'MEDIUM' || task.priority === 'HIGH') row.append(el('span', `pill pill--${task.priority}`, task.priority));
  row.append(el('span', `pill pill--due pill--${pill.tone}`, pill.text));

  const owner = ownerName(task.assigneeId);
  const av = el('span', 'avatar', initials(owner));
  av.title = owner;
  row.append(av);

  const email = R.sourceEmailUrl(task, state.emailBase);
  if (email) {
    const a = link(email, 'icon-btn', null, 'View source email in ACOMS.Email');
    a.append(icon('mail'));
    row.append(a);
  }

  if (state.isAdmin && !task._pending) {
    row.append(
      iconButton(done ? 'undo' : 'check', done ? 'Undo complete' : 'Complete', () => complete(task), 'icon-btn--ok'),
      task.isArchived
        ? iconButton('restore', 'Restore', () => restoreTask(task), 'icon-btn--ok')
        : iconButton('archive', 'Archive', () => archiveTask(task), 'icon-btn--bad')
    );
  }
  return row;
}

function noteDate(value) {
  return new Date(value).toLocaleString('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function renderNotes() {
  const archived = ui.notesArchived;
  const tog = $('toggle-archived-notes');
  tog.textContent = archived ? 'Showing Archived' : 'Active';
  tog.classList.toggle('btn--on', archived);
  $('add-note').disabled = !state.isAdmin;

  const grid = $('note-grid');
  const source = archived ? state.archivedNotes || [] : state.notes || [];
  if (source.length === 0) {
    grid.replaceChildren(
      el('div', 'empty', archived ? 'No archived notes' : state.status === 'idle' ? 'Loading…' : 'No quick notes yet — Ctrl+N starts one.')
    );
    return;
  }
  grid.replaceChildren(...R.sortNotes(source).map(noteCard));
}

function noteCard(note) {
  const converted = Boolean(note.convertedToTaskId);
  const card = el('div', `note${note.isArchived ? ' note--archived' : ''}`);
  if (!note.isArchived) {
    card.addEventListener('click', () => openNoteEditor(note));
    const pin = iconButton('pin', note.isPinned ? 'Unpin note' : 'Pin note', () => act({ type: 'note:pin', id: note.id }), note.isPinned ? 'icon-btn--on' : '');
    pin.classList.add('note__pin');
    card.append(pin);
  }
  card.append(note.content ? el('div', 'note__text', note.content) : el('div', 'note__text note__empty', 'Empty note'));

  const foot = el('div', 'note__foot');
  foot.append(el('span', 'note__date', noteDate(note.createdAt)));
  if (converted) foot.append(el('span', 'converted', 'Converted to task'));
  if (state.isAdmin && !note.isArchived) {
    foot.append(
      iconButton('toTask', 'Create task from note', () => openTaskForm({ notes: note.content, title: firstLine(note.content) }, note.id), 'icon-btn--ok'),
      iconButton('archive', 'Archive note', () => act({ type: 'note:archive', id: note.id }), 'icon-btn--bad')
    );
  }
  if (state.isAdmin && note.isArchived && !converted) {
    foot.append(iconButton('restore', 'Restore note', () => act({ type: 'note:restore', id: note.id }), 'icon-btn--ok'));
  }
  if (state.isAdmin && note.isArchived) {
    foot.append(
      iconButton('trash', 'Delete permanently', () =>
        confirmDialog({
          title: 'Delete note permanently?',
          body: 'This cannot be undone.',
          okLabel: 'Delete',
          danger: true,
          onOk: () => act({ type: 'note:delete', id: note.id })
        }),
        'icon-btn--bad'
      )
    );
  }
  card.append(foot);
  return card;
}

function firstLine(text) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

// ── ACOMS Tasks ────────────────────────────────────────────────────────────
// The company queue. A company task isn't edited here — the app that raised
// it owns it, and its title LINKS to where the work is done; the actions are
// take / release / done / not needed (CompanyTaskRow.tsx).

const COMPANY_FILTERS = [
  { key: 'all', label: () => 'All open' },
  { key: 'unclaimed', label: (b) => `Unclaimed${b.unclaimed ? ` (${b.unclaimed})` : ''}` },
  { key: 'mine', label: (b) => `Mine${b.mine ? ` (${b.mine})` : ''}` },
  { key: 'dismissed', label: () => `Not needed${state.dismissed && state.dismissed.length ? ` (${state.dismissed.length})` : ''}` }
];

function renderCompany() {
  const badges = R.companyBadges(state.company, state.myEmployeeId);
  $('company-chips').replaceChildren(
    ...COMPANY_FILTERS.map((f) => {
      const b = el('button', `chip${ui.companyFilter === f.key ? ' chip--on' : ''}`, f.label(badges));
      b.type = 'button';
      b.addEventListener('click', () => {
        ui.companyFilter = f.key;
        render();
      });
      return b;
    })
  );
  const doneBtn = $('toggle-done-company');
  doneBtn.textContent = ui.companyShowDone ? 'Showing done' : 'Show done';
  doneBtn.classList.toggle('chip--on', ui.companyShowDone);
  $('company-note').hidden = state.status !== 'ok' || state.isManager;

  const list = $('company-list');
  const shown = R.visibleCompany(state.company, state.dismissed, {
    filter: ui.companyFilter,
    showDone: ui.companyShowDone,
    myId: state.myEmployeeId
  });
  if (shown.length === 0) {
    const empty = el('div', 'empty');
    empty.append(
      el('p', null, state.status === 'idle' ? 'Loading…' : 'Nothing in the queue'),
      el('p', 'pane__note', 'Tasks raised for the company by WIP, GIS, OS, the requests inbox or Job Creator land here.')
    );
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...shown.map(companyRow));
}

// A link from the task's producer; Job Creator's are Controller-relative.
function companyLink(task) {
  if (!task.linkUrl) return null;
  try {
    return new URL(task.linkUrl, state.controllerBase || undefined).toString();
  } catch {
    return null;
  }
}

function companyRow(task) {
  const unclaimed = R.isUnclaimed(task);
  const mine = Boolean(state.myEmployeeId) && task.assigneeId === state.myEmployeeId;
  const done = task.status === 'COMPLETED';
  const dismissed = task.isArchived;
  const holder = unclaimed ? null : assigneeById(task.assigneeId);
  const holderName = holder ? R.assigneeName(holder) : 'Someone';
  const requester = task.requestedById ? assigneeById(task.requestedById) : null;
  const dismisser = task.archivedById ? assigneeById(task.archivedById) : null;
  const pill = R.companyDuePill(task);

  const row = el('div', `crow row--${task.priority || 'LOW'}`);
  if (done || dismissed) row.classList.add('crow--done');
  if (task._pending) row.classList.add('crow--saving');

  const main = el('div', 'crow__main');
  const tags = el('div', 'crow__tags');
  tags.append(el('span', 'pill pill--cat', R.CATEGORY_LABELS[task.category] || task.category));
  if (task.acomsNumber) {
    tags.append(
      state.jobLinkBase
        ? link(state.jobLinkBase + encodeURIComponent(task.acomsNumber), 'crow__num pill pill--job', task.acomsNumber, `Open ${task.acomsNumber} in WIP`)
        : el('span', 'crow__num', task.acomsNumber)
    );
  }
  tags.append(el('span', `pill pill--${pill.tone}`, pill.text));
  if (task.sourceApp) tags.append(el('span', 'crow__src', `from ${R.SOURCE_LABELS[task.sourceApp] || task.sourceApp}`));
  main.append(tags);

  const title = el('div', 'crow__title');
  const href = companyLink(task);
  title.append(href ? link(href, null, task.title, 'Open where this is done') : document.createTextNode(task.title));
  main.append(title);
  if (task.notes) main.append(el('div', 'crow__notes', task.notes));

  const who = el('div', 'crow__who');
  if (unclaimed) who.append(el('span', 'crow__unclaimed', 'Unclaimed'));
  else {
    const since = task.claimedAt ? ` · since ${R.shortDate(task.claimedAt)}` : '';
    who.append(el('span', null, `${mine ? 'You have this' : `${holderName} has this`}${since}`));
  }
  if (requester) who.append(el('span', null, `asked by ${R.assigneeName(requester)}`));
  if (dismissed) {
    const by = dismisser ? ` — ${R.assigneeName(dismisser)}` : '';
    const when = task.archivedAt ? ` · ${R.shortDate(task.archivedAt)}` : '';
    const why = task.closedReason ? `: ${task.closedReason}` : '';
    who.append(el('span', 'crow__dismissed', `Not needed${by}${when}${why}`));
  }
  main.append(who);
  row.append(main);

  if (state.isManager && !task._pending) {
    const actions = el('div', 'crow__actions');
    const button = (label, cls, title, onClick) => {
      const b = el('button', `btn btn--small ${cls}`, label);
      b.type = 'button';
      if (title) b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };
    const go = (type) => act({ type: `company:${type}`, id: task.id });
    if (done) {
      actions.append(button('Reopen', '', 'Marked done by mistake? Reopen it under your name', () => go('claim')));
    } else if (!dismissed) {
      actions.append(
        button('Not needed', 'btn--amber', 'A mistake, the wrong job, overtaken by events — archive it with a reason', () =>
          askWhyNotNeeded(task)
        )
      );
      if (unclaimed) actions.append(button('I’ll take it', 'btn--primary', null, () => go('claim')));
      else if (!mine) actions.append(button('Take over', '', `Take this over from ${holderName}`, () => go('claim')));
      else actions.append(button('Release', '', null, () => go('release')));
      actions.append(button('Done', 'btn--ok', null, () => go('done')));
    }
    if (actions.children.length) row.append(actions);
  }
  return row;
}

// "Not needed" asks why, in one line (the route needs a reason).
function askWhyNotNeeded(task) {
  ui.dialog = { kind: 'confirm' };
  const box = el('div', 'dialog__box dialog__box--small');
  box.append(el('h2', null, 'Not needed?'), el('p', 'pane__note', task.title));
  const form = el('form');
  const why = input('reason', '', { maxlength: '300', placeholder: 'Why is it not needed? (one line)', required: '' });
  form.append(field('Reason', why));
  const actions = el('div', 'dialog__actions');
  const ok = el('button', 'btn btn--danger', 'Dismiss');
  ok.type = 'submit';
  const cancel = el('button', 'btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeDialog);
  actions.append(ok, cancel);
  form.append(actions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const reason = why.value.trim();
    if (!reason) return;
    closeDialog();
    act({ type: 'company:dismiss', id: task.id, reason });
  });
  box.append(form);
  showDialog(box);
  why.focus();
}

// ── Recurring Tasks ────────────────────────────────────────────────────────

const REC_CHIPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'due-today', label: 'Due Today' },
  { key: 'due-soon', label: 'Due Soon' }
];

function renderRecurring() {
  // Starts on "my recurring tasks", as the page does.
  if (ui.recOwner === null && state.myEmployeeId) ui.recOwner = state.myEmployeeId;

  const archived = ui.recArchived;
  const source = archived ? state.archivedRecurring || [] : state.recurring || [];

  const tog = $('toggle-archived-recurring');
  tog.textContent = archived ? 'Showing Archived' : 'Active';
  tog.classList.toggle('btn--on', archived);
  $('add-recurring').disabled = !state.isAdmin;
  $('rec-view-list').classList.toggle('seg__btn--on', ui.recView === 'list');
  $('rec-view-cal').classList.toggle('seg__btn--on', ui.recView === 'calendar');

  $('rec-chips').replaceChildren(
    ...REC_CHIPS.map((c) => {
      const b = el('button', `chip${ui.recFilter === c.key ? ' chip--on' : ''}`, c.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        ui.recFilter = ui.recFilter === c.key ? 'all' : c.key;
        render();
      });
      return b;
    })
  );
  const more = $('rec-more-filter');
  more.value = ui.recFilter === 'on-track' ? 'on-track' : 'all';
  more.classList.toggle('select--on', ui.recFilter === 'on-track');

  const ownerSel = $('rec-owner-filter');
  const ownerIds = [...new Set(source.map((t) => t.assigneeId))];
  if (ui.recOwner && !ownerIds.includes(ui.recOwner)) ownerIds.push(ui.recOwner);
  const owners = ownerIds
    .map((id) => ({ id, name: id === state.myEmployeeId ? `${ownerName(id)} (me)` : ownerName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ownerKey = owners.map((o) => `${o.id}:${o.name}`).join('|');
  if (ownerSel.dataset.key !== ownerKey) {
    ownerSel.dataset.key = ownerKey;
    ownerSel.replaceChildren(new Option('All Owners', ''), ...owners.map((o) => new Option(o.name, o.id)));
  }
  ownerSel.value = ui.recOwner || '';
  ownerSel.classList.toggle('select--on', Boolean(ui.recOwner));

  const list = $('recurring-list');
  if (ui.recView === 'calendar') {
    // The calendar shows them all, as the page's does.
    list.replaceChildren(recurringCalendar(source));
    return;
  }
  const shown = R.filterRecurring(source, { filter: ui.recFilter, owner: ui.recOwner || '' });
  if (shown.length === 0) {
    const what = state.status === 'idle' ? 'Loading…' : archived ? 'No archived recurring tasks' : 'No recurring tasks found';
    list.replaceChildren(el('div', 'empty', what));
    return;
  }
  const nodes = [];
  for (const g of R.groupRecurring(shown)) {
    nodes.push(el('div', 'group', `${g.label} · ${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'}`));
    const table = el('div', 'rtable');
    const head = el('div', 'rrow rrow--head');
    for (const h of ['Task', 'Owner', 'Frequency', 'Last Done', 'Next Due', 'Status', '']) head.append(el('div', null, h));
    table.append(head, ...g.tasks.map(recurringRow));
    nodes.push(table);
  }
  list.replaceChildren(...nodes);
}

function recurringRow(task) {
  const st = R.recurringStatus(task);
  const row = el('div', 'rrow');
  if (st.tone !== 'done') row.classList.add(`rrow--${st.tone}`);
  if (task._pending) row.classList.add('rrow--saving');
  if (!task._pending) row.addEventListener('click', () => openRecurringForm(task));

  const t = el('div');
  t.append(el('div', 'rrow__title', task.title));
  if (task.description) t.append(el('div', 'rrow__desc', task.description));
  row.append(
    t,
    el('div', 'rrow__cell', ownerName(task.assigneeId)),
    el('div', 'rrow__cell', R.frequencyLabel(task.frequencyType, task.frequencyValue)),
    el('div', 'rrow__cell', task.lastCompleted ? R.shortDate(task.lastCompleted) : 'Never'),
    el('div', `rrow__cell${st.tone === 'overdue' ? ' rrow__late' : ''}`, task.nextDue ? R.shortDate(task.nextDue) : 'Not set'),
    el('span', `pill pill--${st.tone}`, st.text)
  );
  const actions = el('div', 'rrow__actions');
  if (state.isAdmin && !task._pending) {
    actions.append(
      iconButton('check', 'Mark completed', () =>
        confirmDialog({
          title: 'Mark as Completed',
          body: `Mark "${task.title}" as completed? This will advance the next due date.`,
          okLabel: 'Complete',
          onOk: () => act({ type: 'recurring:complete', id: task.id })
        }),
        'icon-btn--ok'
      ),
      task.isArchived
        ? iconButton('restore', 'Restore', () => act({ type: 'recurring:restore', id: task.id }), 'icon-btn--ok')
        : iconButton('archive', 'Archive', () =>
            confirmDialog({
              title: 'Archive recurring task?',
              body: `"${task.title}" moves to the archive. You can restore it from there.`,
              okLabel: 'Archive',
              danger: true,
              onOk: () => act({ type: 'recurring:archive', id: task.id })
            }),
            'icon-btn--bad'
          )
    );
  }
  row.append(actions);
  return row;
}

function recurringCalendar(list) {
  const now = new Date();
  const at = ui.recMonth || { y: now.getFullYear(), m: now.getMonth() };
  const box = el('div', 'cal');
  const head = el('div', 'cal__head');
  const move = (delta) => {
    const d = new Date(at.y, at.m + delta, 1);
    ui.recMonth = { y: d.getFullYear(), m: d.getMonth() };
    render();
  };
  const prev = el('button', 'btn btn--small', '‹');
  prev.type = 'button';
  prev.addEventListener('click', () => move(-1));
  const next = el('button', 'btn btn--small', '›');
  next.type = 'button';
  next.addEventListener('click', () => move(1));
  const todayBtn = el('button', 'btn btn--small btn--primary', 'Today');
  todayBtn.type = 'button';
  todayBtn.addEventListener('click', () => {
    ui.recMonth = null;
    render();
  });
  head.append(
    prev,
    el('span', 'cal__month', new Date(at.y, at.m, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })),
    next,
    todayBtn
  );
  const grid = el('div', 'cal__grid');
  for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) grid.append(el('div', 'cal__dow', d));
  for (const day of R.calendarDays(list, at.y, at.m)) {
    const cell = el('div', `cal__day${day.inMonth ? '' : ' cal__day--out'}${day.isToday ? ' cal__day--today' : ''}`);
    cell.append(el('div', 'cal__num', String(day.date.getDate())));
    for (const t of day.tasks) {
      const tone = R.recurringStatus(t).tone;
      const chip = el('div', `cal__task${tone === 'done' ? '' : ` cal__task--${tone}`}`, t.title);
      chip.title = `${t.title} — ${ownerName(t.assigneeId)}`;
      chip.addEventListener('click', () => openRecurringForm(t));
      cell.append(chip);
    }
    grid.append(cell);
  }
  box.append(head, grid);
  return box;
}

// Add / edit a recurring task — the page's fields, in its order.
function openRecurringForm(task) {
  const editing = Boolean(task && task.id);
  const t = task || {};
  ui.dialog = { kind: 'recurring' };

  const box = el('div', 'dialog__box');
  box.append(el('h2', null, editing ? 'Edit Recurring Task' : 'Add Recurring Task'));
  const form = el('form');
  const title = input('title', t.title, { required: '', maxlength: '300', placeholder: 'What recurring task needs tracking?' });
  const people = [...(state.assignees || [])].sort((a, b) => R.assigneeName(a).localeCompare(R.assigneeName(b)));
  const assignee = select(
    'assigneeId',
    [{ value: '', label: 'Choose…' }, ...people.map((a) => ({ value: a.id, label: R.assigneeName(a) }))],
    t.assigneeId || state.myEmployeeId || ''
  );
  if (t.assigneeId && !people.some((a) => a.id === t.assigneeId)) {
    assignee.append(new Option(t.assigneeId, t.assigneeId));
    assignee.value = t.assigneeId;
  }
  const category = select('category', R.RECURRING_CATEGORY_OPTIONS, t.category || 'Task');
  if (t.category && !R.RECURRING_CATEGORY_OPTIONS.some((o) => o.value === t.category)) {
    category.append(new Option(t.category, t.category));
    category.value = t.category;
  }
  const freq = select('frequencyType', R.FREQUENCY_OPTIONS, t.frequencyType || 'WEEKLY');
  const every = input('frequencyValue', String(t.frequencyValue || 1), { type: 'number', min: '1' });
  const schedule = select('scheduleType', R.SCHEDULE_OPTIONS, t.scheduleType || 'FLOATING');
  const last = input('lastCompleted', R.isoDay(t.lastCompleted), { type: 'date' });
  const desc = el('textarea');
  desc.name = 'description';
  desc.rows = 3;
  desc.value = t.description || '';
  desc.placeholder = 'Additional details…';

  form.append(field('Task Title *', title));
  const g1 = el('div', 'grid2');
  g1.append(field('Assignee *', assignee), field('Category', category));
  const g2 = el('div', 'grid3');
  g2.append(field('Frequency', freq), field('Every', every), field('Schedule Type', schedule));
  form.append(g1, g2, field('Last Completed', last), field('Description', desc));

  const error = el('p', 'dialog__error');
  error.hidden = true;
  form.append(error);
  const actions = el('div', 'dialog__actions');
  const save = el('button', 'btn btn--primary', editing ? 'Save Changes' : 'Add Recurring Task');
  save.type = 'submit';
  const cancel = el('button', 'btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeDialog);
  actions.append(save, cancel);
  form.append(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!assignee.value) {
      error.textContent = 'Please select an assignee';
      error.hidden = false;
      return;
    }
    const fields = {
      title: title.value.trim(),
      description: desc.value.trim() || null,
      category: category.value || 'Task',
      frequencyType: freq.value || 'WEEKLY',
      frequencyValue: Math.max(1, parseInt(every.value || '1', 10) || 1),
      scheduleType: schedule.value || 'FLOATING',
      lastCompleted: last.value || null,
      assigneeId: assignee.value
    };
    closeDialog();
    const res = editing
      ? await act({ type: 'recurring:update', id: t.id, fields })
      : await act({ type: 'recurring:create', fields });
    if (!res.ok) {
      openRecurringForm(editing ? { ...t, ...fields } : fields);
      const err = document.querySelector('.dialog__error');
      if (err) {
        err.textContent = res.error || 'That did not save';
        err.hidden = false;
      }
    }
  });

  box.append(form);
  showDialog(box);
  title.focus();
  title.select();
}

// ── Dialogs ────────────────────────────────────────────────────────────────

function closeDialog() {
  const d = ui.dialog;
  if (d && d.kind === 'note') flushNote(d, true);
  ui.dialog = null;
  $('dialog').hidden = true;
  $('dialog').replaceChildren();
}

function showDialog(box) {
  const host = $('dialog');
  host.replaceChildren(box);
  host.hidden = false;
}

function confirmDialog({ title, body, okLabel, danger, onOk }) {
  ui.dialog = { kind: 'confirm' };
  const box = el('div', 'dialog__box dialog__box--small');
  box.append(el('h2', null, title), el('p', null, body));
  const actions = el('div', 'dialog__actions');
  const ok = el('button', `btn ${danger ? 'btn--danger' : 'btn--primary'}`, okLabel);
  ok.type = 'button';
  ok.addEventListener('click', () => {
    closeDialog();
    onOk();
  });
  const cancel = el('button', 'btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeDialog);
  actions.append(ok, cancel);
  box.append(actions);
  showDialog(box);
  ok.focus();
}

function field(label, control) {
  const f = el('div', 'field');
  const l = el('label', null, label);
  f.append(l, control);
  return f;
}

function input(name, value, attrs = {}) {
  const i = el('input');
  i.name = name;
  i.value = value || '';
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

function select(name, options, value) {
  const s = el('select');
  s.name = name;
  for (const o of options) s.append(new Option(o.label, o.value));
  s.value = value;
  return s;
}

// The add / edit form — the page's fields, in its order. `task` with an id
// edits it; without, it is the starting values of a new one. `fromNoteId`
// makes the new task from a note (the note is then marked converted).
function openTaskForm(task, fromNoteId) {
  const editing = Boolean(task && task.id);
  const t = task || {};
  ui.dialog = { kind: 'task' };

  const box = el('div', 'dialog__box');
  const head = el('div', 'dialog__head');
  head.append(el('h2', null, editing ? 'Edit Task' : fromNoteId ? 'Create Task from Note' : 'Add Quick Task'));
  const email = editing && R.sourceEmailUrl(t, state.emailBase);
  if (email) head.append(link(email, 'btn', 'View source email'));
  box.append(head);

  const form = el('form');
  const title = input('title', t.title, { required: '', maxlength: '300', placeholder: 'What needs to be done?' });

  const people = [...(state.assignees || [])].sort((a, b) => R.assigneeName(a).localeCompare(R.assigneeName(b)));
  const assignee = select(
    'assigneeId',
    [{ value: '', label: 'Choose…' }, ...people.map((a) => ({ value: a.id, label: R.assigneeName(a) }))],
    t.assigneeId || state.myEmployeeId || ''
  );
  // An assignee no longer in OS's list still shows, rather than silently changing.
  if (t.assigneeId && !people.some((a) => a.id === t.assigneeId)) {
    assignee.append(new Option(t.assigneeId, t.assigneeId));
    assignee.value = t.assigneeId;
  }

  const project = input('projectId', t.projectId, { placeholder: 'Search by ACOMS no., client ref, name, address…', autocomplete: 'off' });
  const projectField = field('Project (WIP job)', project);
  attachJobSearch(project, projectField);

  const due = input('dueDate', editing ? R.isoDay(t.dueDate) : t.dueDate || R.tomorrowIso(), { type: 'date' });
  const priority = select('priority', R.PRIORITY_OPTIONS, t.priority || 'LOW');
  const label = input('label', t.label || 'Task', { placeholder: 'Task, Meeting, Report' });
  const status = select('status', R.STATUS_OPTIONS, t.status || 'NOT_STARTED');
  const notes = el('textarea');
  notes.name = 'notes';
  notes.rows = 3;
  notes.value = t.notes || '';
  notes.placeholder = 'Additional details…';

  form.append(field('Task Title *', title));
  const g1 = el('div', 'grid2');
  g1.append(field('Assignee *', assignee), projectField);
  form.append(g1);
  if (editing) {
    const g2 = el('div', 'grid2');
    g2.append(field('Progress', status), field('Priority', priority));
    const g3 = el('div', 'grid2');
    g3.append(field('Due Date', due), field('Label', label));
    form.append(g2, g3);
  } else {
    const g2 = el('div', 'grid3');
    g2.append(field('Due Date', due), field('Priority', priority), field('Label', label));
    form.append(g2);
  }
  form.append(field('Notes', notes));

  const error = el('p', 'dialog__error');
  error.hidden = true;
  form.append(error);

  const actions = el('div', 'dialog__actions');
  const save = el('button', 'btn btn--primary', editing ? 'Save Changes' : fromNoteId ? 'Create Task' : 'Add Task');
  save.type = 'submit';
  const cancel = el('button', 'btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeDialog);
  actions.append(save, cancel);
  form.append(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!assignee.value) {
      error.textContent = 'Please select an assignee';
      error.hidden = false;
      return;
    }
    const fields = {
      title: title.value.trim(),
      projectId: project.value.trim() || null,
      notes: notes.value.trim() || null,
      label: label.value.trim() || 'Task',
      dueDate: due.value || null,
      status: editing ? status.value : 'NOT_STARTED',
      priority: priority.value,
      assigneeId: assignee.value
    };
    // Closed at once — the change is already on screen. If the server
    // refuses it, the form comes back with what was typed and why.
    closeDialog();
    const res = editing
      ? await act({ type: 'task:update', id: t.id, fields })
      : await act({ type: 'task:create', fields, fromNoteId });
    if (!res.ok) {
      openTaskForm(editing ? { ...t, ...fields } : fields, fromNoteId);
      const err = document.querySelector('.dialog__error');
      if (err) {
        err.textContent = res.error || 'That did not save';
        err.hidden = false;
      }
    }
  });

  box.append(form);
  showDialog(box);
  title.focus();
  title.select();
}

// The Project field searches WIP's jobs as you type, as the page's does.
function attachJobSearch(inputEl, fieldEl) {
  const list = el('div', 'suggest');
  list.hidden = true;
  fieldEl.append(list);
  let seq = 0;
  let timer = null;
  let items = [];
  let on = -1;

  const pick = (value) => {
    inputEl.value = value;
    list.hidden = true;
  };
  const draw = () => {
    if (items.length === 0) {
      list.replaceChildren(el('div', 'suggest__none', 'No matching jobs'));
      return;
    }
    list.replaceChildren(
      ...items.map((it, i) => {
        const b = el('button', `suggest__item${i === on ? ' suggest__item--on' : ''}`);
        b.type = 'button';
        b.append(document.createTextNode(it.value));
        if (it.sublabel) b.append(el('span', 'suggest__sub', it.sublabel));
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(it.value);
        });
        return b;
      })
    );
  };

  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inputEl.value.trim();
    if (q.length < 2) {
      list.hidden = true;
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      const found = await api.searchJobs(q);
      if (mine !== seq) return; // a newer search superseded this one
      items = found || [];
      on = -1;
      draw();
      list.hidden = false;
    }, 200);
  });
  inputEl.addEventListener('keydown', (e) => {
    if (list.hidden || items.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      on = (on + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      draw();
    } else if (e.key === 'Enter' && on >= 0) {
      e.preventDefault();
      pick(items[on].value);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      list.hidden = true;
    }
  });
  inputEl.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
}

// ── The note editor ────────────────────────────────────────────────────────
// Opens at once for typing. A new note is created on the server in the
// background; what's typed saves a second after you stop (the page's
// auto-save), and closing saves at once — or, left empty, throws it away.

function openNoteEditor(note) {
  const d = {
    kind: 'note',
    id: note ? note.id : null,
    creating: null,
    saved: note ? note.content || '' : '',
    timer: null,
    status: null
  };
  if (!note) {
    d.creating = act({ type: 'note:create' }).then((res) => {
      if (res.ok && res.data && res.data.id) d.id = res.data.id;
      return d.id;
    });
  }
  ui.dialog = d;

  const box = el('div', 'dialog__box');
  const head = el('div', 'dialog__head');
  const hint = el('span', 'dialog__hint', '');
  head.append(el('h2', null, 'Quick Note'), hint);
  const area = el('textarea', 'editor');
  area.value = d.saved;
  area.placeholder = 'Type your note here…';
  area.maxLength = 20000;
  d.area = area;
  d.hint = hint;
  area.addEventListener('input', () => {
    hint.textContent = 'Saving…';
    clearTimeout(d.timer);
    d.timer = setTimeout(() => flushNote(d, false), 1000);
  });

  const actions = el('div', 'dialog__actions');
  const doneBtn = el('button', 'btn btn--primary', 'Done');
  doneBtn.type = 'button';
  doneBtn.addEventListener('click', closeDialog);
  actions.append(doneBtn, el('span', 'dialog__hint', 'Saves as you type · Esc closes'));

  box.append(head, area, actions);
  showDialog(box);
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

async function flushNote(d, closing) {
  clearTimeout(d.timer);
  const content = d.area ? d.area.value : d.saved;
  const id = d.id || (d.creating ? await d.creating : null);
  if (!id) {
    if (content.trim()) d.hint && (d.hint.textContent = "Couldn't save — check the message above");
    return;
  }
  if (closing && content.trim() === '') {
    // Persist the empty text first if it changed, so the purge sees it empty.
    if (content !== d.saved) await act({ type: 'note:update', id, content });
    act({ type: 'note:discard', id });
    return;
  }
  if (content === d.saved) {
    if (!closing && d.hint) d.hint.textContent = 'Saved';
    return;
  }
  const res = await act({ type: 'note:update', id, content });
  if (res.ok) d.saved = content;
  if (!closing && d.hint && ui.dialog === d) d.hint.textContent = res.ok ? 'Saved' : "Couldn't save";
}

// ── Wiring ─────────────────────────────────────────────────────────────────

// Ctrl+N: a new one of whatever the tab holds (the queue's tasks come from the
// apps, so on ACOMS Tasks it's a Quick Task).
function newThing() {
  if (!state || !state.isAdmin) return;
  if (ui.tab === 'notes') openNoteEditor(null);
  else if (ui.tab === 'recurring') openRecurringForm(null);
  else {
    if (ui.tab !== 'quick') setTab('quick');
    openTaskForm(null);
  }
}

const TABS = ['acoms', 'quick', 'recurring', 'notes'];

function setTab(tab) {
  ui.tab = tab;
  render();
}

for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));

$('quick-add').addEventListener('submit', (e) => {
  e.preventDefault();
  quickAdd($('quick-add-input').value);
});
$('add-task').addEventListener('click', () => openTaskForm(null));
$('add-note').addEventListener('click', () => openNoteEditor(null));
$('more-filter').addEventListener('change', (e) => {
  ui.filter = e.target.value;
  render();
});
$('owner-filter').addEventListener('change', (e) => {
  ui.owner = e.target.value;
  render();
});
$('toggle-archived').addEventListener('click', () => {
  ui.archived = !ui.archived;
  api.loadArchived('quick', ui.archived);
  render();
});
$('toggle-archived-notes').addEventListener('click', () => {
  ui.notesArchived = !ui.notesArchived;
  api.loadArchived('notes', ui.notesArchived);
  render();
});
$('toggle-done-company').addEventListener('click', () => {
  ui.companyShowDone = !ui.companyShowDone;
  render();
});
$('add-recurring').addEventListener('click', () => openRecurringForm(null));
$('toggle-archived-recurring').addEventListener('click', () => {
  ui.recArchived = !ui.recArchived;
  api.loadArchived('recurring', ui.recArchived);
  render();
});
$('rec-view-list').addEventListener('click', () => {
  ui.recView = 'list';
  render();
});
$('rec-view-cal').addEventListener('click', () => {
  ui.recView = 'calendar';
  render();
});
$('rec-more-filter').addEventListener('change', (e) => {
  ui.recFilter = e.target.value;
  render();
});
$('rec-owner-filter').addEventListener('change', (e) => {
  ui.recOwner = e.target.value;
  render();
});
$('dialog').addEventListener('mousedown', (e) => {
  if (e.target === $('dialog')) closeDialog();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.dialog) {
    e.preventDefault();
    closeDialog();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (!ui.dialog) newThing();
  } else if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
    // Ctrl+1…4: the tabs, left to right.
    e.preventDefault();
    if (!ui.dialog) setTab(TABS[Number(e.key) - 1]);
  }
});

api.onCommand((command) => {
  if (command === 'new-task') {
    setTab('quick');
    if (!ui.dialog) openTaskForm(null);
  } else if (command === 'new-note') {
    setTab('notes');
    if (!ui.dialog) openNoteEditor(null);
  } else if (command.startsWith('tab:') && TABS.includes(command.slice(4))) {
    setTab(command.slice(4));
  }
});

api.onState((s) => {
  state = s;
  render();
});

api.getState().then((s) => {
  if (!state) {
    state = s;
    render();
  }
  $('quick-add-input').focus();
});
