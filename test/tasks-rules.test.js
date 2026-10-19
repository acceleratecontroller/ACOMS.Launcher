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
