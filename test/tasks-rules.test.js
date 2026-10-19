'use strict';

const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/tasks-rules');

// Monday 19 Oct 2026, mid-morning, local time.
const NOW = new Date(2026, 9, 19, 10, 30).getTime();
const day = (offset) => new Date(2026, 9, 19 + offset, 0, 0).toISOString();

const task = (over) => ({
  id: over.id || 't',
  title: 'x',
  status: 'NOT_STARTED',
  priority: 'LOW',
  assigneeId: 'me',
  isArchived: false,
  dueDate: null,
  ...over
});

test('overdue / today / soon are judged on calendar days, as the page does', () => {
  assert.strictEqual(R.isOverdue(day(-1), NOW), true);
  assert.strictEqual(R.isOverdue(day(0), NOW), false);
  assert.strictEqual(R.isDueToday(day(0), NOW), true);
  assert.strictEqual(R.isDueSoon(day(0), NOW), false, 'today is not "soon"');
  assert.strictEqual(R.isDueSoon(day(7), NOW), true);
  assert.strictEqual(R.isDueSoon(day(8), NOW), false);
  assert.strictEqual(R.isOverdue(null, NOW), false);
});

test('the default list hides completed tasks; showing archived shows them all', () => {
  const list = [task({ id: 'a' }), task({ id: 'b', status: 'COMPLETED' })];
  assert.deepStrictEqual(R.filterTasks(list, {}, NOW).map((t) => t.id), ['a']);
  assert.deepStrictEqual(R.filterTasks(list, { archived: true }, NOW).map((t) => t.id), ['a', 'b']);
  assert.deepStrictEqual(R.filterTasks(list, { filter: 'completed' }, NOW).map((t) => t.id), ['b']);
});

test('the filter chips and the owner filter combine', () => {
  const list = [
    task({ id: 'late', dueDate: day(-2) }),
    task({ id: 'late-done', dueDate: day(-2), status: 'COMPLETED' }),
    task({ id: 'today', dueDate: day(0) }),
    task({ id: 'soon', dueDate: day(3) }),
    task({ id: 'theirs', dueDate: day(-2), assigneeId: 'them' }),
    task({ id: 'high', priority: 'HIGH' })
  ];
  const ids = (opts) => R.filterTasks(list, opts, NOW).map((t) => t.id);
  assert.deepStrictEqual(ids({ filter: 'overdue' }), ['late', 'theirs']);
  assert.deepStrictEqual(ids({ filter: 'overdue', owner: 'me' }), ['late']);
  assert.deepStrictEqual(ids({ filter: 'due-today' }), ['today']);
  assert.deepStrictEqual(ids({ filter: 'due-soon' }), ['soon']);
  assert.deepStrictEqual(ids({ filter: 'high' }), ['high']);
});

test('groups: overdue first, then by date, undated last, one heading per day', () => {
  const list = [
    task({ id: 'none' }),
    task({ id: 'tomorrow', dueDate: day(1) }),
    task({ id: 'late', dueDate: day(-3) }),
    task({ id: 'today', dueDate: day(0) })
  ];
  const groups = R.groupTasks(list, NOW);
  assert.deepStrictEqual(
    groups.map((g) => [g.tasks.map((t) => t.id).join(), g.label]),
    [
      ['late', 'Friday 16 Oct 2026'],
      ['today', 'Today'],
      ['tomorrow', 'Tomorrow'],
      ['none', 'No Due Date']
    ]
  );
});

test('the due pill says what the page says', () => {
  assert.deepStrictEqual(R.duePill(task({ status: 'COMPLETED', dueDate: day(-1) }), NOW), { text: 'Completed', tone: 'done' });
  assert.deepStrictEqual(R.duePill(task({}), NOW), { text: 'No date', tone: 'none' });
  assert.strictEqual(R.duePill(task({ dueDate: day(-1) }), NOW).tone, 'overdue');
  assert.match(R.duePill(task({ dueDate: day(-1) }), NOW).text, /^Overdue · 18\/10\/26$/);
  assert.deepStrictEqual(R.duePill(task({ dueDate: day(0) }), NOW), { text: 'Due Today', tone: 'today' });
  assert.strictEqual(R.duePill(task({ dueDate: day(2) }), NOW).tone, 'soon');
  assert.strictEqual(R.duePill(task({ dueDate: day(20) }), NOW).tone, 'later');
});

test('badges count open, unarchived tasks only', () => {
  const list = [
    task({ dueDate: day(-1) }),
    task({ dueDate: day(-1), status: 'COMPLETED' }),
    task({ dueDate: day(-1), isArchived: true }),
    task({ dueDate: day(0) }),
    task({ dueDate: day(4) })
  ];
  assert.deepStrictEqual(R.taskBadges(list, NOW), { overdue: 1, dueToday: 1, dueSoon: 1 });
});

test('notes: pinned first, then most recently edited', () => {
  const notes = [
    { id: 'old', isPinned: false, updatedAt: day(-5) },
    { id: 'pinned', isPinned: true, updatedAt: day(-9) },
    { id: 'new', isPinned: false, updatedAt: day(0) }
  ];
  assert.deepStrictEqual(R.sortNotes(notes).map((n) => n.id), ['pinned', 'new', 'old']);
});

test('my employee id comes from my identity, or is unknown', () => {
  const people = [{ id: 'emp-1', identityId: 'id-1', firstName: 'Dion', lastName: 'H' }];
  assert.strictEqual(R.myEmployeeId(people, { identityId: 'id-1' }), 'emp-1');
  assert.strictEqual(R.myEmployeeId(people, { identityId: 'id-2' }), null);
  assert.strictEqual(R.myEmployeeId(people, null), null);
});

test('instant writes change a copy, never the state they were given', () => {
  const before = {
    quick: [task({ id: 'a' }), task({ id: 'b', status: 'COMPLETED' })],
    notes: [{ id: 'n', content: 'hi', isPinned: false }]
  };
  const frozen = JSON.stringify(before);

  const done = R.applyOptimistic(before, { type: 'task:complete', id: 'a' });
  assert.strictEqual(done.quick.find((t) => t.id === 'a').status, 'COMPLETED');
  const undone = R.applyOptimistic(before, { type: 'task:complete', id: 'b' });
  assert.strictEqual(undone.quick.find((t) => t.id === 'b').status, 'NOT_STARTED', 'complete toggles, as the route does');

  assert.deepStrictEqual(R.applyOptimistic(before, { type: 'task:archive', id: 'a' }).quick.map((t) => t.id), ['b']);
  assert.strictEqual(R.applyOptimistic(before, { type: 'task:update', id: 'a', fields: { title: 'new' } }).quick[0].title, 'new');

  const created = R.applyOptimistic(before, { type: 'task:create', fields: { title: 'fresh', assigneeId: 'me' } });
  assert.strictEqual(created.quick[0].title, 'fresh');
  assert.strictEqual(created.quick[0]._pending, true);

  assert.strictEqual(R.applyOptimistic(before, { type: 'note:pin', id: 'n' }).notes[0].isPinned, true);
  assert.strictEqual(R.applyOptimistic(before, { type: 'note:update', id: 'n', content: 'bye' }).notes[0].content, 'bye');
  assert.deepStrictEqual(R.applyOptimistic(before, { type: 'note:archive', id: 'n' }).notes, []);

  assert.strictEqual(JSON.stringify(before), frozen);
});

test('polls fast in front, slower behind, gently in the background, backs off on failure', () => {
  assert.strictEqual(R.pollIntervalMs({ windowOpen: true, windowFocused: true, status: 'ok' }), 4000);
  assert.strictEqual(R.pollIntervalMs({ windowOpen: true, windowFocused: false, status: 'ok' }), 10000);
  assert.strictEqual(R.pollIntervalMs({ windowOpen: false, windowFocused: false, status: 'ok' }), 60000);
  assert.strictEqual(R.pollIntervalMs({ windowOpen: true, windowFocused: true, status: 'error' }), 30000);
  assert.strictEqual(R.pollIntervalMs({ windowOpen: true, windowFocused: true, status: 'signIn' }), 60000);
});

test('links: the job a task is tagged with, and its source email', () => {
  assert.strictEqual(R.jobNumberOf('A1174 · 70256 · Smith St'), 'A1174');
  assert.strictEqual(R.jobNumberOf('a1016b · second view'), 'A1016B');
  assert.strictEqual(R.jobNumberOf('no job here'), null);
  assert.strictEqual(R.sourceEmailUrl({ sourceEmailThreadId: 'th 1' }, 'https://mail.test/'), 'https://mail.test/threads/th%201');
  assert.strictEqual(R.sourceEmailUrl({ sourceEmailThreadId: null }, 'https://mail.test'), null);
  assert.strictEqual(R.sourceEmailUrl({ sourceEmailThreadId: 'x' }, null), null);
});

test('a WIP job is stored the way the page stores it', () => {
  assert.strictEqual(
    R.wipJobRef({ acomsNumberFormatted: 'A1174', clientReferenceNumber: '70256', name: 'Smith St' }),
    'A1174 · 70256 · Smith St'
  );
  assert.strictEqual(R.wipJobRef({ acomsNumberFormatted: 'A1174', clientReferenceNumber: 'a1174', name: 'Smith St' }), 'A1174 · Smith St');
});

// ── ACOMS Tasks ──────────────────────────────────────────────────────────────

const ctask = (over) => task({ kind: 'COMPANY', assigneeId: R.COMPANY_ASSIGNEE_ID, createdAt: day(0), ...over });

test('the queue: unclaimed first (newest on top), then claimed; done only when asked', () => {
  const list = [
    ctask({ id: 'claimed', assigneeId: 'me', createdAt: day(-1) }),
    ctask({ id: 'old-unclaimed', createdAt: day(-5) }),
    ctask({ id: 'new-unclaimed', createdAt: day(-2) }),
    ctask({ id: 'done', assigneeId: 'me', status: 'COMPLETED' })
  ];
  const ids = (opts) => R.visibleCompany(list, [], opts).map((t) => t.id);
  assert.deepStrictEqual(ids({}), ['new-unclaimed', 'old-unclaimed', 'claimed']);
  assert.deepStrictEqual(ids({ showDone: true }), ['new-unclaimed', 'old-unclaimed', 'claimed', 'done']);
  assert.deepStrictEqual(ids({ filter: 'unclaimed' }), ['new-unclaimed', 'old-unclaimed']);
  assert.deepStrictEqual(ids({ filter: 'mine', myId: 'me' }), ['claimed']);
  assert.deepStrictEqual(ids({ filter: 'mine', myId: null }), [], 'not knowing who I am shows none, not all');
});

test('"Not needed" lists the dismissed ones, newest first', () => {
  const dismissed = [ctask({ id: 'a', archivedAt: day(-3) }), ctask({ id: 'b', archivedAt: day(-1) })];
  assert.deepStrictEqual(R.visibleCompany([], dismissed, { filter: 'dismissed' }).map((t) => t.id), ['b', 'a']);
});

test('queue badges: unclaimed and mine, open ones only', () => {
  const list = [
    ctask({}),
    ctask({ status: 'COMPLETED' }),
    ctask({ assigneeId: 'me' }),
    ctask({ assigneeId: 'them' })
  ];
  assert.deepStrictEqual(R.companyBadges(list, 'me'), { unclaimed: 1, mine: 1 });
  assert.deepStrictEqual(R.companyBadges(list, null), { unclaimed: 1, mine: 0 });
});

test('the queue pill uses its own words', () => {
  assert.strictEqual(R.companyDuePill(ctask({ status: 'COMPLETED' }), NOW).text, 'Done');
  assert.strictEqual(R.companyDuePill(ctask({ dueDate: day(0) }), NOW).text, 'Due today');
  assert.strictEqual(R.companyDuePill(ctask({ dueDate: day(-1) }), NOW).tone, 'overdue');
});

test('claim / release / done / dismiss show at once', () => {
  const s = { company: [ctask({ id: 'c' })], dismissed: [] };
  const claimed = R.applyOptimistic(s, { type: 'company:claim', id: 'c', me: 'me' });
  assert.strictEqual(claimed.company[0].assigneeId, 'me');
  assert.strictEqual(R.applyOptimistic(claimed, { type: 'company:release', id: 'c' }).company[0].assigneeId, R.COMPANY_ASSIGNEE_ID);
  assert.strictEqual(R.applyOptimistic(s, { type: 'company:done', id: 'c' }).company[0].status, 'COMPLETED');
  const gone = R.applyOptimistic(s, { type: 'company:dismiss', id: 'c', me: 'me', reason: 'wrong job' });
  assert.deepStrictEqual(gone.company, []);
  assert.strictEqual(gone.dismissed[0].closedReason, 'wrong job');
  assert.strictEqual(gone.dismissed[0].isArchived, true);
  assert.strictEqual(s.company[0].assigneeId, R.COMPANY_ASSIGNEE_ID, 'the original is untouched');
});

// ── Recurring ────────────────────────────────────────────────────────────────

const rtask = (over) => ({ id: 'r', title: 'r', assigneeId: 'me', isArchived: false, nextDue: null, frequencyType: 'WEEKLY', frequencyValue: 1, ...over });

test('recurring: overdue first, then by next due, undated last; filters and owner', () => {
  const list = [
    rtask({ id: 'none' }),
    rtask({ id: 'week', nextDue: day(5) }),
    rtask({ id: 'late', nextDue: day(-2) }),
    rtask({ id: 'today', nextDue: day(0) }),
    rtask({ id: 'later', nextDue: day(30) }),
    rtask({ id: 'theirs', nextDue: day(-2), assigneeId: 'them' })
  ];
  const ids = (opts) => R.filterRecurring(list, opts, NOW).map((t) => t.id);
  assert.deepStrictEqual(ids({ owner: 'me' }), ['late', 'today', 'week', 'later', 'none']);
  assert.deepStrictEqual(ids({ filter: 'overdue' }), ['late', 'theirs']);
  assert.deepStrictEqual(ids({ filter: 'due-soon' }), ['week']);
  assert.deepStrictEqual(ids({ filter: 'on-track' }), ['later', 'none']);
  assert.deepStrictEqual(
    R.groupRecurring(R.filterRecurring(list, { owner: 'me' }, NOW), NOW).map((g) => g.label).slice(1, 2),
    ['Today']
  );
});

test('recurring status pill: days overdue, today, soon, on track', () => {
  assert.deepStrictEqual(R.recurringStatus(rtask({ nextDue: day(-3) }), NOW), { text: 'Overdue 3d', tone: 'overdue' });
  assert.strictEqual(R.recurringStatus(rtask({ nextDue: day(0) }), NOW).text, 'Due Today');
  assert.strictEqual(R.recurringStatus(rtask({ nextDue: day(2) }), NOW).text, 'Due Soon');
  assert.strictEqual(R.recurringStatus(rtask({ nextDue: day(20) }), NOW).text, 'On Track');
  assert.strictEqual(R.recurringStatus(rtask({}), NOW).text, 'On Track');
});

test('frequency reads as the page writes it', () => {
  assert.strictEqual(R.frequencyLabel('WEEKLY', 1), 'Weekly');
  assert.strictEqual(R.frequencyLabel('MONTHLY', 3), 'Every 3 monthly');
  assert.strictEqual(R.frequencyLabel('DAILY', 1), 'Daily (Mon–Fri)');
});

test('the calendar: six weeks from the Sunday before the 1st, tasks on their next-due day', () => {
  const days = R.calendarDays([rtask({ id: 'x', nextDue: day(0) })], 2026, 9, NOW);
  assert.strictEqual(days.length, 42);
  assert.strictEqual(days[0].date.getDay(), 0, 'starts on a Sunday');
  assert.strictEqual(days[0].date.getDate(), 27, 'Sun 27 Sep, before Thu 1 Oct');
  const today = days.find((d) => d.isToday);
  assert.strictEqual(today.date.getDate(), 19);
  assert.deepStrictEqual(today.tasks.map((t) => t.id), ['x']);
  assert.strictEqual(days.filter((d) => d.inMonth).length, 31);
});

test('recurring complete shows "done today" at once; the next due is left to the server', () => {
  const s = { recurring: [rtask({ id: 'r', nextDue: day(-1) })] };
  const after = R.applyOptimistic(s, { type: 'recurring:complete', id: 'r' });
  assert.ok(after.recurring[0].lastCompleted);
  assert.strictEqual(after.recurring[0].nextDue, day(-1));
  assert.deepStrictEqual(R.applyOptimistic(s, { type: 'recurring:archive', id: 'r' }).recurring, []);
});
