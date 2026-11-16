'use strict';

// The redesigned Quick Tasks pane (2026-11-16): buckets, search, the No date
// list that says when it is being forgotten, the week, the re-plan queue and
// the add line.

const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/tasks-rules');
const { parseTask } = require('../src/chat-task-parse');

// Monday 19 Oct 2026, mid-morning, local time.
const NOW = new Date(2026, 9, 19, 10, 30).getTime();
const day = (offset) => new Date(2026, 9, 19 + offset, 0, 0).toISOString();

let n = 0;
const task = (over) => ({
  id: over.id || `t${++n}`,
  title: 'x',
  status: 'NOT_STARTED',
  priority: 'LOW',
  assigneeId: 'me',
  isArchived: false,
  dueDate: null,
  updatedAt: day(0),
  ...over
});

test('a task lands in one of five buckets by its date', () => {
  assert.strictEqual(R.bucketOf(task({ dueDate: day(-3) }), NOW), 'overdue');
  assert.strictEqual(R.bucketOf(task({ dueDate: day(0) }), NOW), 'today');
  assert.strictEqual(R.bucketOf(task({ dueDate: day(7) }), NOW), 'week');
  assert.strictEqual(R.bucketOf(task({ dueDate: day(8) }), NOW), 'later');
  assert.strictEqual(R.bucketOf(task({}), NOW), 'none');
});

test('groups by due date come in order, and empty buckets are left out', () => {
  const groups = R.groupQuick(
    [task({ id: 'later', dueDate: day(20) }), task({ id: 'none' }), task({ id: 'late', dueDate: day(-1) })],
    'due',
    NOW
  );
  assert.deepStrictEqual(groups.map((g) => g.key), ['overdue', 'later', 'none']);
  assert.deepStrictEqual(groups.map((g) => g.label), ['Overdue', 'Later', 'No date']);
});

test('inside a bucket: earliest first, then high priority first', () => {
  const groups = R.groupQuick(
    [
      task({ id: 'low', dueDate: day(-1) }),
      task({ id: 'high', dueDate: day(-1), priority: 'HIGH' }),
      task({ id: 'oldest', dueDate: day(-9) })
    ],
    'due',
    NOW
  );
  assert.deepStrictEqual(groups[0].tasks.map((t) => t.id), ['oldest', 'high', 'low']);
});

test('an undated task counts as forgotten only after a week untouched', () => {
  assert.strictEqual(R.isForgotten(task({ updatedAt: day(-7) }), NOW), false);
  assert.strictEqual(R.isForgotten(task({ updatedAt: day(-8) }), NOW), true);
  assert.strictEqual(R.isForgotten(task({ updatedAt: day(-30), dueDate: day(3) }), NOW), false, 'dated tasks are never "forgotten"');
  assert.strictEqual(R.isForgotten(task({ updatedAt: day(-30), status: 'COMPLETED' }), NOW), false);
  // Never changed: its created date is the clock.
  assert.strictEqual(R.isForgotten(task({ updatedAt: undefined, createdAt: day(-10) }), NOW), true);
});

test('the No date group puts the longest-ignored first and counts the forgotten', () => {
  const groups = R.groupQuick(
    [task({ id: 'fresh', updatedAt: day(-1) }), task({ id: 'old', updatedAt: day(-40) }), task({ id: 'mid', updatedAt: day(-9) })],
    'due',
    NOW
  );
  assert.deepStrictEqual(groups[0].tasks.map((t) => t.id), ['old', 'mid', 'fresh']);
  assert.strictEqual(groups[0].forgotten, 2);
});

test('the chip counts cover open tasks only, and say how many undated ones are forgotten', () => {
  const c = R.quickCounts(
    [
      task({ dueDate: day(-2), priority: 'HIGH' }),
      task({ dueDate: day(0), status: 'AWAITING_RESPONSE' }),
      task({ dueDate: day(3), status: 'STUCK' }),
      task({ updatedAt: day(-20) }),
      task({ updatedAt: day(-2) }),
      task({ dueDate: day(-5), status: 'COMPLETED' }),
      task({ dueDate: day(40), updatedAt: day(-45) }),
      task({ dueDate: day(-1), isArchived: true })
    ],
    NOW
  );
  assert.deepStrictEqual(c, {
    all: 6,
    overdue: 1,
    today: 1,
    soon: 1,
    waiting: 1,
    stuck: 1,
    high: 1,
    noDate: 2,
    noDateForgotten: 1,
    stale: 1,
    completed: 1
  });
});

test('search needs every word, across title, job, label and notes', () => {
  const t = task({ title: 'Chase Ventia for retention', projectId: 'A0634 · 70256 · Smith St', label: 'Forecast', notes: 'rang accounts' });
  assert.strictEqual(R.matchesSearch(t, 'ventia a0634'), true);
  assert.strictEqual(R.matchesSearch(t, 'smith forecast accounts'), true);
  assert.strictEqual(R.matchesSearch(t, 'ventia a9999'), false);
  assert.strictEqual(R.matchesSearch(t, '   '), true);
});

test('filters: no-date, waiting, stale; "all" hides completed unless archived', () => {
  const list = [
    task({ id: 'nd' }),
    task({ id: 'wait', dueDate: day(2), status: 'AWAITING_RESPONSE' }),
    task({ id: 'stale', dueDate: day(50), updatedAt: day(-31) }),
    task({ id: 'done', dueDate: day(-2), status: 'COMPLETED' }),
    task({ id: 'theirs', assigneeId: 'jd' })
  ];
  const ids = (opts) => R.quickFilter(list, opts, NOW).map((t) => t.id);
  assert.deepStrictEqual(ids({ filter: 'no-date', owner: 'me' }), ['nd']);
  assert.deepStrictEqual(ids({ filter: 'waiting' }), ['wait']);
  assert.deepStrictEqual(ids({ filter: 'stale' }), ['stale']);
  assert.deepStrictEqual(ids({ filter: 'completed' }), ['done']);
  assert.deepStrictEqual(ids({ owner: 'me' }), ['nd', 'wait', 'stale']);
  assert.strictEqual(ids({ archived: true }).length, 5);
});

test('grouping by job uses the A-number, with no-job last', () => {
  const groups = R.groupQuick(
    [
      task({ id: 'a', projectId: 'A1209 · REF · Name' }),
      task({ id: 'b' }),
      task({ id: 'c', projectId: 'a1209' }),
      task({ id: 'd', projectId: 'A0634' })
    ],
    'job',
    NOW
  );
  assert.deepStrictEqual(groups.map((g) => [g.label, g.tasks.length]), [['A0634', 1], ['A1209', 2], ['No job', 1]]);
});

test('grouping by label treats a missing label as Task', () => {
  const groups = R.groupQuick([task({ label: 'Forecast meeting' }), task({ label: '' }), task({ label: 'Task' })], 'label', NOW);
  assert.deepStrictEqual(groups.map((g) => [g.label, g.tasks.length]), [['Forecast meeting', 1], ['Task', 2]]);
});

test('the week: Overdue, today and the next four weekdays, then Later', () => {
  const cols = R.weekColumns(
    [
      task({ id: 'late', dueDate: day(-1) }),
      task({ id: 'today', dueDate: day(0) }),
      task({ id: 'fri', dueDate: day(4) }),
      task({ id: 'sat', dueDate: day(5) }),
      task({ id: 'none' })
    ],
    NOW
  );
  assert.deepStrictEqual(cols.map((c) => c.key), ['overdue', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', 'later']);
  assert.strictEqual(cols[1].isToday, true);
  assert.deepStrictEqual(cols[0].tasks.map((t) => t.id), ['late']);
  assert.deepStrictEqual(cols[5].tasks.map((t) => t.id), ['fri']);
  assert.deepStrictEqual(cols[6].tasks.map((t) => t.id).sort(), ['none', 'sat']);
});

test('the week skips the weekend but still shows today when today is one', () => {
  const saturday = new Date(2026, 9, 24, 9, 0).getTime();
  assert.deepStrictEqual(
    R.weekColumns([], saturday).filter((c) => c.kind === 'day').map((c) => c.key),
    ['2026-10-24', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']
  );
});

test('re-plan: overdue oldest first, then forgotten undated; skipped and done left out', () => {
  const q = R.replanQueue(
    [
      task({ id: 'late1', dueDate: day(-1) }),
      task({ id: 'late9', dueDate: day(-9) }),
      task({ id: 'forgot', updatedAt: day(-12) }),
      task({ id: 'fresh', updatedAt: day(-1) }),
      task({ id: 'done', dueDate: day(-3), status: 'COMPLETED' }),
      task({ id: 'skip', dueDate: day(-20) }),
      task({ id: 'fine', dueDate: day(2) })
    ],
    NOW,
    { skip: true }
  );
  assert.deepStrictEqual(q.map((x) => [x.task.id, x.why, x.days]), [
    ['late9', 'overdue', 9],
    ['late1', 'overdue', 1],
    ['forgot', 'undated', 12]
  ]);
});

test('next Monday is never today', () => {
  assert.strictEqual(R.nextMondayIso(NOW), '2026-10-26'); // from a Monday
  assert.strictEqual(R.nextMondayIso(new Date(2026, 9, 25, 9).getTime()), '2026-10-26'); // from a Sunday
  assert.strictEqual(R.addDaysIso(3, NOW), '2026-10-22');
});

test('the due column reads Today, Tomorrow, a weekday, then a date', () => {
  assert.strictEqual(R.dueShort(task({}), NOW), 'No date');
  assert.strictEqual(R.dueShort(task({ dueDate: day(0) }), NOW), 'Today');
  assert.strictEqual(R.dueShort(task({ dueDate: day(1) }), NOW), 'Tomorrow');
  assert.match(R.dueShort(task({ dueDate: day(3) }), NOW), /Thu.*22|22.*Thu/);
  assert.match(R.dueShort(task({ dueDate: day(-16) }), NOW), /3 Oct/);
});

test('the add line: no date typed means tomorrow', () => {
  const p = R.parseQuickAdd('Order pit lids', { now: NOW, parseTask });
  assert.deepStrictEqual(p, { title: 'Order pit lids', dueDate: '2026-10-20', dueFound: false, job: null, label: null, priority: 'LOW' });
});

test('the add line reads a day, a job number and "!" and keeps the words typed', () => {
  const p = R.parseQuickAdd('ring Bob friday A1209 !', { now: NOW, parseTask });
  assert.strictEqual(p.title, 'ring Bob friday A1209');
  assert.strictEqual(p.dueDate, '2026-10-23');
  assert.strictEqual(p.dueFound, true);
  assert.strictEqual(p.job, 'A1209');
  assert.strictEqual(p.priority, 'HIGH');
});

test('the add line: "urgent" is high priority, a "!" inside a word is not', () => {
  assert.strictEqual(R.parseQuickAdd('urgent call council', { now: NOW, parseTask }).priority, 'HIGH');
  assert.strictEqual(R.parseQuickAdd('Wow! that worked', { now: NOW, parseTask }).priority, 'LOW');
  assert.strictEqual(R.parseQuickAdd('Wow! that worked', { now: NOW, parseTask }).title, 'Wow! that worked');
});

test('the add line picks up a label the Task Manager already uses', () => {
  const p = R.parseQuickAdd('forecast meeting: price the Novus tickets', { now: NOW, labels: ['Task', 'Forecast meeting'], parseTask });
  assert.strictEqual(p.label, 'Forecast meeting');
});

test('the add line still works with no parser loaded', () => {
  const p = R.parseQuickAdd('ring Bob friday', { now: NOW });
  assert.strictEqual(p.dueDate, '2026-10-20');
  assert.strictEqual(p.dueFound, false);
});

test('addedBy names the person or the app that created a task', () => {
  const staff = [
    { id: 'e1', firstName: 'Dion', lastName: 'H', identityId: 'idn-dion' },
    { id: 'e2', firstName: 'Jane', lastName: 'Doe', identityId: 'idn-jane' }
  ];
  const me = { id: 'idn-dion', identityId: 'idn-dion' };
  assert.deepStrictEqual(R.addedBy({ createdById: 'idn-dion' }, staff, me), { kind: 'me', name: 'You' });
  assert.deepStrictEqual(R.addedBy({ createdById: 'idn-jane' }, staff, me), { kind: 'person', name: 'Jane Doe' });
  assert.deepStrictEqual(R.addedBy({ createdById: 'acoms-email' }, staff, me), { kind: 'app', name: 'ACOMS Email' });
  // Someone not in the staff list, or a task with no creator: say nothing.
  assert.strictEqual(R.addedBy({ createdById: 'idn-gone' }, staff, me), null);
  assert.strictEqual(R.addedBy({}, staff, me), null);
});
