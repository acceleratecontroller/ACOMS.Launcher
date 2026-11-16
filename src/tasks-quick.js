'use strict';

// The Quick Tasks pane of the Tasks window (Dion, 2026-11-16: "a visual mess
// and when i start to have too many tasks ... there is no way to really get on
// top of them or find stuff easily"). Loaded after tasks-window.js and uses its
// helpers (el, icon, act, complete, openTaskForm, …) and its `state` / `ui`.
//
//   one line per task, in five buckets, not a card per task and a header per day
//   search, and filters that count (No date goes red when it is being forgotten)
//   click a task: it opens in a panel at the side and saves as you change it
//   the add line reads a date, a job number and "!" the way chat does
//   a Week view to drag tasks between days
//   Re-plan: the overdue ones, one at a time, each dealt with in a keystroke
//
// What is shown and in what order is decided in tasks-rules.js (tested).

const QUICK_PREFS = 'acoms.tasks.quick.v1';

function loadQuickPrefs() {
  try {
    return JSON.parse(window.localStorage.getItem(QUICK_PREFS)) || {};
  } catch {
    return {};
  }
}

const quickPrefs = loadQuickPrefs();

const quick = {
  view: quickPrefs.view === 'week' ? 'week' : 'list',
  group: ['due', 'job', 'label'].includes(quickPrefs.group) ? quickPrefs.group : 'due',
  // Groups folded shut, by "<group-by>:<key>". Later and No date start shut.
  shut: quickPrefs.shut && typeof quickPrefs.shut === 'object' ? quickPrefs.shut : { 'due:later': true, 'due:none': true },
  search: '',
  sel: null, // the task open in the side panel
  panelKey: null,
  replan: false,
  skipped: {}
};

function saveQuickPrefs() {
  try {
    window.localStorage.setItem(QUICK_PREFS, JSON.stringify({ view: quick.view, group: quick.group, shut: quick.shut }));
  } catch {
    // Remembering the layout is a nicety; the window works without it.
  }
}

const QUICK_CHIPS = [
  { key: 'all', label: 'All', count: (c) => c.all, always: true },
  { key: 'overdue', label: 'Overdue', count: (c) => c.overdue, always: true },
  { key: 'due-today', label: 'Today', count: (c) => c.today, always: true },
  { key: 'due-soon', label: 'Next 7 days', count: (c) => c.soon },
  { key: 'waiting', label: 'Waiting', count: (c) => c.waiting },
  { key: 'stuck', label: 'Stuck', count: (c) => c.stuck },
  { key: 'high', label: 'High priority', count: (c) => c.high, always: true },
  // Dion 2026-11-16: "having a no date next to high priority for the filter
  // and if anything has been in there more than a week it starts counting
  // them red".
  { key: 'no-date', label: 'No date', count: (c) => c.noDate, always: true, bad: (c) => c.noDateForgotten },
  { key: 'stale', label: 'Stale', count: (c) => c.stale, title: `Not changed in over ${R.STALE_AFTER_DAYS} days` },
  { key: 'completed', label: 'Done', count: (c) => c.completed }
];

const SHORT_STATUS = { IN_PROGRESS: 'In progress', STUCK: 'Stuck', AWAITING_RESPONSE: 'Waiting' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function svgIcon(d, cls, filled) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  for (const part of [].concat(d)) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', part);
    svg.append(p);
  }
  return svg;
}

const QICON = {
  chevron: 'M4.5 2.5l3.5 3.5-3.5 3.5',
  tick: 'M2.5 6.3l2.3 2.3 4.7-5.2',
  close: 'M2.5 2.5l7 7M9.5 2.5l-7 7',
  flag: ['M2.5 11V1.5', 'M2.5 2h7L7.8 4.5 9.5 7h-7z']
};

function button(cls, text, onClick, title) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// ── Saving ─────────────────────────────────────────────────────────────────

const canEdit = (task) => Boolean(state.isAdmin && task && !task._pending && !task.isArchived);

// The route takes the whole task (as the form sends it), so a change goes up
// with everything else as it stands.
function taskFields(t) {
  return {
    title: t.title,
    projectId: t.projectId || null,
    notes: t.notes || null,
    label: t.label || 'Task',
    dueDate: t.dueDate ? R.isoDay(t.dueDate) : null,
    status: t.status || 'NOT_STARTED',
    priority: t.priority || 'LOW',
    assigneeId: t.assigneeId
  };
}

function saveTask(task, change) {
  if (!canEdit(task)) return Promise.resolve({ ok: false });
  return act({ type: 'task:update', id: task.id, fields: { ...taskFields(task), ...change } });
}

const DATE_KEYS = {
  t: () => R.addDaysIso(0),
  m: () => R.addDaysIso(1),
  w: () => R.nextMondayIso()
};

function knownLabels() {
  return [...new Set((state.quick || []).map((t) => (t.label || '').trim()).filter(Boolean))];
}

// "Type a task and press Enter": yours, due tomorrow unless a date is in it.
// Without knowing which employee you are it can't assign it, so the full form
// opens instead.
async function quickAdd(text) {
  const typed = String(text || '').trim();
  if (!typed) return;
  const parser = window.acomsChatTaskParse;
  const p = R.parseQuickAdd(typed, { labels: knownLabels(), parseTask: parser && parser.parseTask });
  const fields = {
    title: p.title || typed,
    projectId: p.job || null,
    notes: null,
    label: p.label || 'Task',
    dueDate: p.dueDate,
    status: 'NOT_STARTED',
    priority: p.priority,
    assigneeId: state.myEmployeeId
  };
  if (!state.myEmployeeId) {
    openTaskForm(fields);
    return;
  }
  $('quick-add-input').value = '';
  renderPreview();
  // The job number alone becomes WIP's own reference for it, when WIP knows it.
  if (p.job) {
    try {
      const found = await api.searchJobs(p.job);
      const hit = (found || []).find((j) => R.jobNumberOf(j.value) === p.job);
      if (hit) fields.projectId = hit.value;
    } catch {
      // The number on its own still tags the task.
    }
  }
  const res = await act({ type: 'task:create', fields });
  if (!res.ok && !$('quick-add-input').value) {
    $('quick-add-input').value = typed; // nothing lost
    renderPreview();
  }
}

// What the add line understood, shown before Enter is pressed.
function renderPreview() {
  const box = $('quick-preview');
  const typed = $('quick-add-input').value.trim();
  if (!typed) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const parser = window.acomsChatTaskParse;
  const p = R.parseQuickAdd(typed, { labels: knownLabels(), parseTask: parser && parser.parseTask });
  const day = parser ? parser.dayWords(p.dueDate) : p.dueDate;
  const parts = [el('span', 'qpreview__lead', 'Will add, due')];
  parts.push(el('span', `qtag${p.dueFound ? ' qtag--on' : ''}`, p.dueFound ? day : `${day} (tomorrow, no date typed)`));
  if (p.job) parts.push(el('span', 'qtag qtag--on', p.job));
  if (p.label) parts.push(el('span', 'qtag qtag--on', p.label));
  if (p.priority === 'HIGH') parts.push(el('span', 'qtag qtag--on', 'High priority'));
  box.hidden = false;
  box.replaceChildren(...parts);
}

// ── The pane ───────────────────────────────────────────────────────────────

function renderQuick() {
  // The owner filter starts on "my tasks", as the page does.
  if (ui.owner === null && state.myEmployeeId) ui.owner = state.myEmployeeId;

  const archived = ui.archived;
  const source = archived ? state.archivedQuick || [] : state.quick || [];
  const owned = source.filter((t) => !ui.owner || t.assigneeId === ui.owner);
  const counts = R.quickCounts(owned);
  const queue = archived ? [] : R.replanQueue(owned, undefined, quick.skipped);
  if (archived) quick.replan = false;

  renderQuickTools(source, counts, queue, archived);

  const shown = R.quickFilter(source, { filter: ui.filter, owner: ui.owner || '', archived, q: quick.search });
  const list = $('task-list');
  const keep = focusedTaskId();
  list.className = `qlist${quick.replan ? ' qlist--replan' : quick.view === 'week' && !archived ? ' qlist--week' : ''}`;
  if (quick.replan) list.replaceChildren(replanCard(queue));
  else if (quick.view === 'week' && !archived) list.replaceChildren(weekBoard(shown));
  else list.replaceChildren(...listNodes(shown, archived));
  if (keep) refocusTask(keep);

  renderPanel(source);
  renderFoot(counts, shown.length);
}

function renderQuickTools(source, counts, queue, archived) {
  $('chips').replaceChildren(
    ...QUICK_CHIPS.filter((c) => c.always || c.count(counts) > 0 || ui.filter === c.key).map((c) => {
      const b = button(`qchip${ui.filter === c.key ? ' qchip--on' : ''}`, c.label, () => {
        ui.filter = ui.filter === c.key ? 'all' : c.key;
        render();
      });
      const bad = c.bad ? c.bad(counts) : 0;
      const n = el('span', `qchip__n${bad || (c.key === 'overdue' && counts.overdue) ? ' qchip__n--bad' : ''}`, String(c.count(counts)));
      b.append(n);
      b.title = bad
        ? `${plural(bad, 'task')} with no date not touched in over ${R.FORGOTTEN_AFTER_DAYS} days`
        : c.title || '';
      return b;
    })
  );

  const replan = $('replan-btn');
  replan.hidden = archived || (queue.length === 0 && !quick.replan);
  replan.textContent = quick.replan ? 'Back to the list' : `Re-plan ${queue.length}`;
  replan.title = quick.replan ? '' : 'Overdue tasks, and undated ones not looked at in a week, one at a time';

  $('quick-view-list').classList.toggle('seg__btn--on', quick.view === 'list');
  $('quick-view-week').classList.toggle('seg__btn--on', quick.view === 'week');
  $('group-by').value = quick.group;
  $('group-by').hidden = quick.view === 'week';

  const tog = $('toggle-archived');
  tog.textContent = archived ? 'Showing archived' : 'Archived';
  tog.classList.toggle('qbtn--on', archived);

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
    ownerSel.replaceChildren(new Option('All owners', ''), ...owners.map((o) => new Option(o.name, o.id)));
  }
  ownerSel.value = ui.owner || '';

  $('add-task').disabled = !state.isAdmin;
  $('quick-add-input').disabled = !state.isAdmin;
}

function renderFoot(counts, shownCount) {
  const foot = $('quick-foot');
  const parts = [el('span', null, `${counts.all} open`)];
  if (counts.overdue) parts.push(el('span', 'qfoot__bad', `${counts.overdue} overdue`));
  if (quick.search) parts.push(el('span', null, `${shownCount} match "${quick.search}"`));
  parts.push(el('span', 'qtools__grow'));
  parts.push(el('span', null, 'On a task: Space done, T today, M tomorrow, W next Monday'));
  foot.replaceChildren(...parts);
}

// ── The list ───────────────────────────────────────────────────────────────

function listNodes(shown, archived) {
  if (shown.length === 0) {
    const what =
      state.status === 'idle' ? 'Loading…' : archived ? 'No archived tasks here' : quick.search ? 'Nothing matches that search' : 'No tasks here';
    return [el('div', 'empty', what)];
  }
  const nodes = [];
  for (const g of R.groupQuick(shown, archived ? 'due' : quick.group)) {
    const shutKey = `${quick.group}:${g.key}`;
    // A search opens every group: what was looked for is never folded away.
    const open = archived || quick.search ? true : !quick.shut[shutKey];
    const head = button(`qgroup qgroup--${quick.group === 'due' ? g.key : 'plain'}`, null, () => {
      quick.shut = { ...quick.shut, [shutKey]: open };
      saveQuickPrefs();
      render();
    });
    head.setAttribute('aria-expanded', String(open));
    head.append(svgIcon(QICON.chevron, `qgroup__chev${open ? ' qgroup__chev--open' : ''}`), el('span', 'qgroup__label', g.label), el('span', 'qgroup__n', String(g.tasks.length)));
    if (g.forgotten) head.append(el('span', 'qgroup__warn', `${g.forgotten} not touched in over a week`));
    nodes.push(head);
    if (open) for (const t of g.tasks) nodes.push(quickRow(t));
  }
  return nodes;
}

function jobTagOf(task) {
  const number = R.jobNumberOf(task.projectId) || (!task.projectId && R.jobNumberOf(task.title));
  if (!task.projectId && !number) return null;
  return { number, text: number || R.jobKey(task.projectId), full: task.projectId || number };
}

function quickRow(task) {
  const done = task.status === 'COMPLETED';
  const tone = R.duePill(task).tone;
  const row = el('div', 'qrow');
  row.dataset.id = task.id;
  if (done) row.classList.add('qrow--done');
  if (task._pending) row.classList.add('qrow--saving');
  if (task.id === quick.sel) row.classList.add('qrow--sel');

  const check = button(`qcheck${done ? ' qcheck--on' : ''}`, null, () => complete(task), done ? 'Undo complete' : 'Complete');
  check.setAttribute('aria-label', done ? 'Undo complete' : 'Complete');
  check.disabled = !state.isAdmin || Boolean(task._pending) || Boolean(task.isArchived);
  const ring = el('span', 'qcheck__ring');
  if (done) ring.append(svgIcon(QICON.tick));
  check.append(ring);

  const main = button('qrow__main', null, () => selectTask(task.id));
  const title = el('span', 'qrow__title', task.title);
  title.title = task.title;
  main.append(title);
  const job = jobTagOf(task);
  if (job) {
    const tag = el('span', 'qtag', job.text);
    tag.title = job.full;
    main.append(tag);
  }
  if (task.label && task.label !== 'Task') main.append(el('span', 'qtag qtag--label', task.label));
  const from = R.addedBy(task, state.assignees, state.me);
  if (from && from.kind === 'person') {
    const tag = el('span', 'qfrom', `from ${from.name.split(' ')[0]}`);
    tag.title = `Added by ${from.name}`;
    main.append(tag);
  }

  const status = el('span', 'qrow__status');
  if (!done && SHORT_STATUS[task.status]) status.append(el('span', `qdot qdot--${task.status}`), el('span', null, SHORT_STATUS[task.status]));

  const owner = el('span', 'qrow__owner');
  if (task.assigneeId !== state.myEmployeeId) {
    const name = ownerName(task.assigneeId);
    const av = el('span', 'qavatar', initials(name));
    av.title = name;
    owner.append(av);
  }

  const due = el('span', `qrow__due qdue--${tone}`, done ? 'Done' : R.dueShort(task));
  const flag = el('span', 'qrow__flag');
  if (!done && task.priority === 'HIGH') {
    const f = svgIcon(QICON.flag, 'qflag', true);
    flag.title = 'High priority';
    flag.append(f);
  } else if (!done && task.priority === 'MEDIUM') {
    flag.title = 'Medium priority';
    flag.append(svgIcon(QICON.flag, 'qflag qflag--medium'));
  }

  row.append(check, main, status, owner, due, flag);
  if (task.isArchived && state.isAdmin) row.append(iconButton('restore', 'Restore', () => restoreTask(task), 'icon-btn--ok'));
  return row;
}

function selectTask(id) {
  quick.sel = quick.sel === id ? null : id;
  quick.panelKey = null;
  render();
}

// Moves to the next or previous task on screen, from the focused one (else the
// one open in the panel). Folded groups are not on screen, so they are skipped.
function stepTask(step) {
  const ids = [...document.querySelectorAll('#task-list [data-id]')].map((r) => r.dataset.id);
  if (ids.length === 0) return false;
  const at = ids.indexOf(focusedTaskId() || quick.sel);
  const next = at === -1 ? (step > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, at + step));
  const id = ids[next];
  if (quick.sel && quick.sel !== id) {
    quick.sel = id;
    quick.panelKey = null;
    render();
  }
  refocusTask(id);
  return true;
}

function focusedTaskId() {
  const a = document.activeElement;
  const row = a && a.closest ? a.closest('#task-list [data-id]') : null;
  return row ? row.dataset.id : null;
}

function refocusTask(id) {
  const row = [...document.querySelectorAll('#task-list [data-id]')].find((r) => r.dataset.id === id);
  const target = row && (row.matches('button') ? row : row.querySelector('.qrow__main'));
  if (target) target.focus();
}

function taskById(id) {
  const source = ui.archived ? state.archivedQuick || [] : state.quick || [];
  return source.find((t) => t.id === id) || null;
}

// ── The week ───────────────────────────────────────────────────────────────

function weekBoard(shown) {
  const board = el('div', 'qweek');
  for (const col of R.weekColumns(shown)) {
    const sec = el('section', `qcol qcol--${col.kind}${col.isToday ? ' qcol--today' : ''}`);
    const head = el('div', 'qcol__head');
    head.append(el('span', 'qcol__label', col.label));
    if (col.isToday) head.append(el('span', 'qcol__sub', 'today'));
    head.append(el('span', 'qtools__grow'), el('span', 'qcol__n', String(col.tasks.length)));
    const body = el('div', 'qcol__body');
    for (const t of col.tasks) body.append(weekCard(t, col));
    sec.append(head, body);

    // Dropping a task on a day gives it that date.
    if (col.iso && state.isAdmin) {
      sec.addEventListener('dragover', (e) => {
        e.preventDefault();
        sec.classList.add('qcol--drop');
      });
      sec.addEventListener('dragleave', () => sec.classList.remove('qcol--drop'));
      sec.addEventListener('drop', (e) => {
        e.preventDefault();
        sec.classList.remove('qcol--drop');
        const task = taskById(e.dataTransfer.getData('text/plain'));
        if (task && R.isoDay(task.dueDate) !== col.iso) saveTask(task, { dueDate: col.iso });
      });
    }
    board.append(sec);
  }
  return board;
}

function weekCard(task, col) {
  const card = button(`qcard${task.id === quick.sel ? ' qcard--sel' : ''}${task._pending ? ' qrow--saving' : ''}`, null, () => selectTask(task.id));
  card.dataset.id = task.id;
  if (canEdit(task)) {
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  }
  card.append(el('span', 'qcard__title', task.title));
  const job = jobTagOf(task);
  const meta = [
    col.kind === 'day' ? '' : R.dueShort(task),
    job ? job.text : '',
    SHORT_STATUS[task.status] || '',
    task.assigneeId !== state.myEmployeeId ? ownerName(task.assigneeId) : ''
  ].filter(Boolean);
  const line = el('span', `qcard__meta${col.kind === 'overdue' ? ' qdue--overdue' : ''}`, meta.join(' · '));
  if (task.priority === 'HIGH') line.append(svgIcon(QICON.flag, 'qflag', true));
  if (meta.length || task.priority === 'HIGH') card.append(line);
  return card;
}

// ── Re-plan ────────────────────────────────────────────────────────────────

const REPLAN_ACTIONS = [
  { key: 'd', label: 'Done', main: true, run: (t) => complete(t) },
  { key: '1', label: 'Today', run: (t) => saveTask(t, { dueDate: R.addDaysIso(0) }) },
  { key: '2', label: 'Tomorrow', run: (t) => saveTask(t, { dueDate: R.addDaysIso(1) }) },
  { key: '3', label: 'Next Monday', run: (t) => saveTask(t, { dueDate: R.nextMondayIso() }) },
  { key: 'w', label: 'Waiting, look again in 3 days', run: (t) => saveTask(t, { status: 'AWAITING_RESPONSE', dueDate: R.addDaysIso(3) }) },
  { key: 'n', label: 'No date, keep it on the list', run: (t) => saveTask(t, { dueDate: null }) },
  { key: 'x', label: 'Not needed, archive it', run: (t) => act({ type: 'task:archive', id: t.id }) }
];

function replanCurrent() {
  const source = state.quick || [];
  const owned = source.filter((t) => !ui.owner || t.assigneeId === ui.owner);
  return R.replanQueue(owned, undefined, quick.skipped)[0] || null;
}

function replanDo(key) {
  const cur = replanCurrent();
  if (!cur || !state.isAdmin) return;
  if (key === 's') {
    quick.skipped = { ...quick.skipped, [cur.task.id]: true };
    render();
    return;
  }
  const action = REPLAN_ACTIONS.find((a) => a.key === key);
  if (!action) return;
  // An undated task kept as it is has been looked at: it leaves this run, and
  // the save itself restarts its "not touched" clock.
  if (key === 'n') quick.skipped = { ...quick.skipped, [cur.task.id]: true };
  action.run(cur.task);
}

function setReplan(on) {
  quick.replan = on;
  quick.skipped = {};
  if (on) quick.sel = null;
  render();
}

function replanCard(queue) {
  const wrap = el('div', 'qreplan');
  if (queue.length === 0) {
    wrap.append(
      el('div', 'qreplan__title', 'Nothing left to re-plan'),
      el('p', 'qreplan__why', 'Nothing is overdue, and every undated task has been looked at this week.'),
      button('btn btn--primary', 'Back to the list', () => setReplan(false))
    );
    return wrap;
  }
  const { task, why, days } = queue[0];
  const job = jobTagOf(task);
  const what =
    why === 'overdue'
      ? `Due ${R.dueShort(task)}, ${plural(days, 'day')} late`
      : `No date, not touched for ${plural(days, 'day')}`;
  const meta = [what, job ? job.text : '', SHORT_STATUS[task.status] || '', task.priority === 'HIGH' ? 'High priority' : ''].filter(Boolean);

  wrap.append(el('div', 'qreplan__count', `${queue.length} to go`), el('div', 'qreplan__title', task.title));
  wrap.append(el('div', `qreplan__meta${why === 'overdue' ? ' qdue--overdue' : ''}`, meta.join(' · ')));
  if (task.notes) wrap.append(el('p', 'qreplan__notes', task.notes));

  const grid = el('div', 'qreplan__grid');
  for (const a of REPLAN_ACTIONS) {
    const b = button(`qreplan__act${a.main ? ' qreplan__act--main' : ''}`, null, () => replanDo(a.key));
    b.disabled = !state.isAdmin;
    b.append(el('span', 'qreplan__label', a.label), el('span', 'qreplan__key', a.key.toUpperCase()));
    grid.append(b);
  }
  wrap.append(grid);

  const foot = el('div', 'qreplan__foot');
  foot.append(
    button('qlink', 'Skip for now (S)', () => replanDo('s')),
    button('qlink', 'Open it', () => {
      quick.replan = false;
      quick.sel = task.id;
      quick.panelKey = null;
      render();
    }),
    el('span', 'qtools__grow'),
    button('qlink', 'Back to the list (Esc)', () => setReplan(false))
  );
  wrap.append(foot);
  return wrap;
}

// ── The side panel ─────────────────────────────────────────────────────────
// A task opens here instead of in a form over the window. Every change saves
// as it is made; text saves when you leave the box.

function closePanel() {
  quick.sel = null;
  quick.panelKey = null;
  render();
}

function renderPanel(source) {
  const host = $('task-panel');
  const task = quick.sel && !quick.replan ? source.find((t) => t.id === quick.sel) : null;
  if (!task) {
    // Completed-then-hidden, archived or gone: nothing to show.
    if (quick.sel && !quick.replan && !source.some((t) => t.id === quick.sel)) quick.sel = null;
    host.hidden = true;
    host.replaceChildren();
    quick.panelKey = null;
    return;
  }
  host.hidden = false;
  const related = relatedTasks(task, source);
  const key = JSON.stringify([
    task.id, task.title, task.projectId, task.notes, task.label, task.dueDate, task.status, task.priority,
    task.assigneeId, Boolean(task._pending), Boolean(task.isArchived), state.isAdmin,
    (R.addedBy(task, state.assignees, state.me) || {}).name,
    related.map((t) => [t.id, t.title, t.dueDate])
  ]);
  if (key === quick.panelKey) return;
  // Someone is typing in it: leave it alone until they are done.
  const a = document.activeElement;
  if (quick.panelKey && host.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && host.dataset.id === task.id) return;
  quick.panelKey = key;
  host.dataset.id = task.id;
  host.replaceChildren(...buildPanel(task, related));
}

function relatedTasks(task, source) {
  const key = R.jobKey(task.projectId);
  if (!key) return [];
  return source.filter((t) => t.id !== task.id && t.status !== 'COMPLETED' && R.jobKey(t.projectId) === key).slice(0, 6);
}

function choice(options, current, onPick, disabled) {
  const box = el('div', 'qchoice');
  for (const o of options) {
    const b = button(`qchoice__btn${o.value === current ? ' qchoice__btn--on' : ''}`, o.label, () => onPick(o.value));
    b.disabled = disabled;
    box.append(b);
  }
  return box;
}

function panelRow(label, ...content) {
  const row = el('div', 'qpanel__row');
  row.append(el('div', 'qpanel__label', label));
  const body = el('div', 'qpanel__value');
  body.append(...content);
  row.append(body);
  return row;
}

// Saves a text box when it is left (or Enter, in a one-line box), if changed.
function saveOnLeave(control, read, save, oneLine) {
  const start = read();
  control.addEventListener('blur', () => {
    if (read() !== start) save(read());
  });
  if (oneLine) {
    control.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        control.blur();
      }
    });
  }
}

function buildPanel(task, related) {
  const editable = canEdit(task);
  const done = task.status === 'COMPLETED';
  const bucket = R.bucketOf(task);
  const out = [];

  // Title
  const head = el('div', 'qpanel__head');
  const check = button(`qcheck${done ? ' qcheck--on' : ''}`, null, () => complete(task), done ? 'Undo complete' : 'Complete');
  check.setAttribute('aria-label', done ? 'Undo complete' : 'Complete');
  check.disabled = !editable;
  const ring = el('span', 'qcheck__ring');
  if (done) ring.append(svgIcon(QICON.tick));
  check.append(ring);
  const title = el('textarea', 'qpanel__title');
  title.value = task.title;
  title.rows = 2;
  title.maxLength = 300;
  title.readOnly = !editable;
  title.setAttribute('aria-label', 'Task title');
  saveOnLeave(title, () => title.value.trim(), (v) => (v ? saveTask(task, { title: v }) : (title.value = task.title)), true);
  const close = button('qpanel__close', null, closePanel, 'Close (Esc)');
  close.setAttribute('aria-label', 'Close');
  close.append(svgIcon(QICON.close));
  head.append(check, title, close);
  out.push(head);

  // Due
  const date = el('input', 'qpanel__input');
  date.type = 'date';
  date.value = task.dueDate ? R.isoDay(task.dueDate) : '';
  date.disabled = !editable;
  date.setAttribute('aria-label', 'Due date');
  date.addEventListener('change', () => {
    date.blur();
    saveTask(task, { dueDate: date.value || null });
  });
  const late =
    !done && bucket === 'overdue'
      ? el('span', 'qdue--overdue', `${plural(R.daysBetween(task.dueDate, Date.now()), 'day')} late`)
      : el('span', 'qpanel__dim', done ? 'Done' : R.dueShort(task));
  out.push(panelRow('Due', date, late));
  const iso = task.dueDate ? R.isoDay(task.dueDate) : null;
  const moves = [
    { value: R.addDaysIso(0), label: 'Today' },
    { value: R.addDaysIso(1), label: 'Tomorrow' },
    { value: R.nextMondayIso(), label: 'Next Monday' },
    { value: R.addDaysIso(14), label: 'In 2 weeks' },
    { value: null, label: 'No date' }
  ];
  out.push(panelRow('Move it', choice(moves, iso, (v) => saveTask(task, { dueDate: v }), !editable)));

  // Progress and priority
  out.push(
    panelRow(
      'Progress',
      choice(
        R.STATUS_OPTIONS.filter((o) => o.value !== 'COMPLETED').map((o) => ({ value: o.value, label: SHORT_STATUS[o.value] || (o.value === 'NOT_STARTED' ? 'Not started' : o.label) })),
        task.status,
        (v) => saveTask(task, { status: v }),
        !editable
      )
    )
  );
  out.push(panelRow('Priority', choice(R.PRIORITY_OPTIONS, task.priority || 'LOW', (v) => saveTask(task, { priority: v }), !editable)));

  // Job
  // A textarea, so a long "A0023 · ref · name" wraps instead of running off the end.
  const jobInput = el('textarea', 'qpanel__input');
  jobInput.rows = 1;
  jobInput.value = task.projectId || '';
  jobInput.placeholder = 'Search by ACOMS no., client ref, name, address…';
  jobInput.autocomplete = 'off';
  jobInput.readOnly = !editable;
  jobInput.setAttribute('aria-label', 'Project (WIP job)');
  const jobField = el('div', 'qpanel__job field');
  jobField.append(jobInput);
  if (editable) attachJobSearch(jobInput, jobField);
  saveOnLeave(jobInput, () => jobInput.value.trim(), (v) => saveTask(task, { projectId: v || null }), true);
  const job = jobTagOf(task);
  const jobBits = [jobField];
  if (job && job.number && state.jobLinkBase) {
    jobBits.push(link(state.jobLinkBase + encodeURIComponent(job.number), 'qlink', `Open ${job.number} in WIP`));
  }
  out.push(panelRow('Job', ...jobBits));

  // Label and owner
  const label = el('input', 'qpanel__input');
  label.value = task.label || 'Task';
  label.placeholder = 'Task, Meeting, Report';
  label.readOnly = !editable;
  label.setAttribute('aria-label', 'Label');
  label.setAttribute('list', 'quick-labels');
  const options = el('datalist');
  options.id = 'quick-labels';
  for (const l of knownLabels()) options.append(new Option(l, l));
  saveOnLeave(label, () => label.value.trim() || 'Task', (v) => saveTask(task, { label: v }), true);
  out.push(panelRow('Label', label, options));

  const people = [...(state.assignees || [])].sort((a, b) => R.assigneeName(a).localeCompare(R.assigneeName(b)));
  const owner = select('assigneeId', people.map((a) => ({ value: a.id, label: R.assigneeName(a) })), task.assigneeId);
  owner.className = 'qpanel__input';
  // An assignee no longer in OS's list still shows, rather than silently changing.
  if (!people.some((a) => a.id === task.assigneeId)) {
    owner.append(new Option(ownerName(task.assigneeId), task.assigneeId));
    owner.value = task.assigneeId;
  }
  owner.disabled = !editable;
  owner.setAttribute('aria-label', 'Owner');
  owner.addEventListener('change', () => {
    owner.blur();
    saveTask(task, { assigneeId: owner.value });
  });
  out.push(panelRow('Owner', owner));
  const from = R.addedBy(task, state.assignees, state.me);
  if (from) out.push(panelRow('Added by', el('span', 'qpanel__text', from.name)));

  // Notes
  const notes = el('textarea', 'qpanel__notes');
  notes.value = task.notes || '';
  notes.rows = 4;
  notes.placeholder = 'Notes…';
  notes.readOnly = !editable;
  notes.setAttribute('aria-label', 'Notes');
  saveOnLeave(notes, () => notes.value.trim(), (v) => saveTask(task, { notes: v || null }));
  out.push(notes);

  // The same job's other open tasks
  if (related.length) {
    const box = el('div', 'qpanel__related');
    box.append(el('div', 'qpanel__label', `Also open on ${R.jobKey(task.projectId)}`));
    for (const t of related) {
      const b = button('qrelated', null, () => {
        quick.sel = t.id;
        quick.panelKey = null;
        render();
      });
      b.append(el('span', 'qrelated__title', t.title), el('span', `qdue--${R.duePill(t).tone}`, R.dueShort(t)));
      box.append(b);
    }
    out.push(box);
  }

  // Where it came from
  const meta = el('div', 'qpanel__meta');
  const facts = [];
  if (task.createdAt) facts.push(`Added ${R.shortDate(task.createdAt)}`);
  if (task.updatedAt) facts.push(`last changed ${R.shortDate(task.updatedAt)}`);
  meta.append(el('span', null, facts.join(', ')));
  const email = R.sourceEmailUrl(task, state.emailBase);
  if (email) meta.append(link(email, 'qlink', 'View source email'));
  out.push(meta, el('span', 'qtools__grow'));

  // Actions
  const actions = el('div', 'qpanel__actions');
  if (task.isArchived) {
    const b = button('btn btn--primary', 'Restore', () => restoreTask(task));
    b.disabled = !state.isAdmin;
    actions.append(b);
  } else {
    const ok = button('btn btn--primary', done ? 'Mark not done' : 'Complete', () => complete(task));
    ok.disabled = !editable;
    const arch = button('btn', 'Archive', () => archiveTask(task));
    arch.disabled = !editable;
    actions.append(ok, arch);
  }
  out.push(actions);
  return out;
}

// ── Wiring ─────────────────────────────────────────────────────────────────

$('quick-add').addEventListener('submit', (e) => {
  e.preventDefault();
  quickAdd($('quick-add-input').value);
});
$('quick-add-input').addEventListener('input', renderPreview);
$('quick-search').addEventListener('input', (e) => {
  quick.search = e.target.value.trim();
  render();
});
$('quick-view-list').addEventListener('click', () => {
  quick.view = 'list';
  quick.replan = false;
  saveQuickPrefs();
  render();
});
$('quick-view-week').addEventListener('click', () => {
  quick.view = 'week';
  quick.replan = false;
  saveQuickPrefs();
  render();
});
$('group-by').addEventListener('change', (e) => {
  quick.group = e.target.value;
  saveQuickPrefs();
  render();
});
$('replan-btn').addEventListener('click', () => setReplan(!quick.replan));

const isTyping = (target) => Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

document.addEventListener('keydown', (e) => {
  if (!state || ui.tab !== 'quick' || ui.dialog || e.defaultPrevented) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('quick-search').focus();
    $('quick-search').select();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    if (e.target === $('quick-search') && quick.search) {
      $('quick-search').value = '';
      quick.search = '';
      render();
    } else if (isTyping(e.target) && $('task-panel').contains(e.target)) {
      e.target.blur();
    } else if (quick.replan) {
      setReplan(false);
    } else if (quick.sel) {
      closePanel();
    }
    return;
  }
  if (isTyping(e.target)) return;

  const key = e.key.toLowerCase();
  if (quick.replan) {
    if (key === 's' || REPLAN_ACTIONS.some((a) => a.key === key)) {
      e.preventDefault();
      replanDo(key);
    }
    return;
  }

  // Up / Down walk the tasks; with the panel open it follows along.
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (stepTask(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    return;
  }

  // On a task in the list or the week: Space completes, T / M / W re-date it.
  const row = e.target.closest ? e.target.closest('#task-list [data-id]') : null;
  const task = row ? taskById(row.dataset.id) : null;
  if (!task || !canEdit(task)) return;
  if (e.key === ' ') {
    e.preventDefault();
    complete(task);
  } else if (DATE_KEYS[key]) {
    e.preventDefault();
    saveTask(task, { dueDate: DATE_KEYS[key]() });
  }
});

// The reminder toast and the tray can ask for Re-plan directly.
api.onCommand((command) => {
  if (command !== 'replan') return;
  setTab('quick');
  setReplan(true);
});

// A state that arrived before this file loaded is waiting to be drawn.
render();
