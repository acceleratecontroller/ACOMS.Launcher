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
  dialog: null // { kind: 'task' | 'note' | 'confirm', ... }
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
  renderQuick();
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
  $('pane-quick').hidden = ui.tab !== 'quick';
  $('pane-notes').hidden = ui.tab !== 'notes';

  const mine = (state.quick || []).filter((t) => !state.myEmployeeId || t.assigneeId === state.myEmployeeId);
  $('badge-quick').replaceChildren(...counts(R.taskBadges(mine)));
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
  } else if (state.status === 'ok' && !state.isAdmin) {
    parts.push([el('span', 'notice__text', 'Quick Tasks and Quick Notes are for admins for now.')]);
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

function newThing() {
  if (!state || !state.isAdmin) return;
  if (ui.tab === 'notes') openNoteEditor(null);
  else openTaskForm(null);
}

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
  } else if ((e.ctrlKey || e.metaKey) && (e.key === '1' || e.key === '2')) {
    e.preventDefault();
    setTab(e.key === '1' ? 'quick' : 'notes');
  }
});

api.onCommand((command) => {
  if (command === 'new-task') {
    setTab('quick');
    if (!ui.dialog) openTaskForm(null);
  } else if (command === 'new-note') {
    setTab('notes');
    if (!ui.dialog) openNoteEditor(null);
  } else if (command === 'tab:notes' || command === 'tab:quick') {
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
