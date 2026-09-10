'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildTaskReminder, buildToastXml, splitByDueness } = require('../src/task-reminder');

const NOW = new Date(2026, 8, 10, 9, 0, 0); // 10 Sep 2026, 9am local

function task(id, title, daysAgo) {
  const at = new Date(NOW.getTime());
  at.setDate(at.getDate() - daysAgo);
  at.setHours(0, 0, 0, 0);
  return { id, kind: 'task', severity: 'action', title, path: '/tasks', at: at.toISOString() };
}

test('nothing to say when there are no tasks', () => {
  assert.strictEqual(buildTaskReminder({ items: [], now: NOW }), null);
});

test('approvals and info items are not task reminders', () => {
  const items = [
    { id: 'jr:1', kind: 'approval', severity: 'action', title: 'Job request' },
    { id: 't:1', kind: 'task', severity: 'info', title: 'Heads up' }
  ];

  assert.strictEqual(buildTaskReminder({ items, now: NOW }), null);
});

// ── Overdue vs due today, from the DATE not the wording ────────────────────

test('splits on the due date rather than the subtitle text', () => {
  const items = [
    { ...task('a', 'Late one', 5), subtitle: 'anything at all' },
    { ...task('b', 'Today one', 0), subtitle: 'wording is for humans' }
  ];

  const { overdue, dueToday } = splitByDueness(items, NOW);

  assert.deepStrictEqual(overdue.map((i) => i.id), ['a']);
  assert.deepStrictEqual(dueToday.map((i) => i.id), ['b']);
});

test('a task with no date counts as due today, never as overdue', () => {
  const items = [{ id: 'x', kind: 'task', severity: 'action', title: 'Undated', at: null }];

  const r = buildTaskReminder({ items, now: NOW });

  assert.strictEqual(r.overdue, 0);
  assert.strictEqual(r.dueToday, 1);
});

test('the headline counts both kinds', () => {
  const items = [task('a', 'A', 5), task('b', 'B', 2), task('c', 'C', 0)];

  const r = buildTaskReminder({ items, now: NOW });

  assert.strictEqual(r.title, '2 tasks overdue, 1 due today');
});

test('singular reads properly', () => {
  const r = buildTaskReminder({ items: [task('a', 'A', 3)], now: NOW });

  assert.strictEqual(r.title, '1 task overdue');
});

test('the worst overdue is named first', () => {
  const items = [task('recent', 'Recent', 1), task('ancient', 'Ancient', 60)];

  const r = buildTaskReminder({ items, now: NOW });

  assert.ok(r.body.startsWith('Ancient'), r.body);
});

// ── The twenty-overdue case ────────────────────────────────────────────────

test('twenty overdue tasks become one notification, not twenty', () => {
  const items = Array.from({ length: 20 }, (_, i) => task(`t${i}`, `Task ${i}`, 20 - i));

  const r = buildTaskReminder({ items, now: NOW });

  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.title, '20 tasks overdue');
  // Three named, then the remainder counted.
  assert.strictEqual(r.body.split('\n').length, 4);
  assert.ok(r.body.endsWith('…and 17 more'), r.body);
});

// ── Truthfulness when the payload is capped ────────────────────────────────
// The summary caps its item list, so counting the array alone would
// under-report — the same class of bug that put a wrong number on the badge.

test('a true count from the portal wins over the visible list', () => {
  const items = Array.from({ length: 10 }, (_, i) => task(`t${i}`, `Task ${i}`, 5));

  const r = buildTaskReminder({ items, trueCount: 34, now: NOW });

  assert.strictEqual(r.total, 34);
  assert.ok(r.body.endsWith('…and 31 more'), r.body);
  assert.strictEqual(r.approx, false);
  // The headline must state 34, not the 10 we happen to be holding.
  assert.strictEqual(r.title, '34 tasks need attention');
});

test('the headline never reports the visible count as if it were the total', () => {
  const items = Array.from({ length: 10 }, (_, i) => task(`t${i}`, `Task ${i}`, 5));

  const r = buildTaskReminder({ items, trueCount: 13, now: NOW });

  assert.ok(!r.title.includes('10'), `headline leaked the visible count: ${r.title}`);
  assert.ok(r.title.includes('13'), r.title);
});

test('the split headline is used when the whole list is visible', () => {
  const items = [task('a', 'A', 3), task('b', 'B', 0)];

  const r = buildTaskReminder({ items, trueCount: 2, now: NOW });

  assert.strictEqual(r.title, '1 task overdue, 1 due today');
});

test('a capped list with no true count says "at least" rather than a wrong number', () => {
  const items = Array.from({ length: 10 }, (_, i) => task(`t${i}`, `Task ${i}`, 5));

  const r = buildTaskReminder({ items, capped: true, now: NOW });

  assert.ok(r.title.startsWith('At least '), r.title);
  assert.strictEqual(r.approx, true);
});

test('an uncapped list states the number plainly', () => {
  const r = buildTaskReminder({ items: [task('a', 'A', 1)], capped: false, now: NOW });

  assert.strictEqual(r.approx, false);
  assert.ok(!r.title.startsWith('At least'));
});

// ── The toast XML ──────────────────────────────────────────────────────────

test('the toast asks Windows for the reminder scenario', () => {
  const xml = buildToastXml({ title: 'T', body: 'one\ntwo' });

  // This attribute is the whole reason for hand-writing XML: without it the
  // toast files itself away after ~25 seconds instead of waiting to be dealt
  // with.
  assert.ok(xml.includes('scenario="reminder"'), xml);
  assert.ok(xml.includes('<text>one</text>'));
  assert.ok(xml.includes('<text>two</text>'));
  assert.ok(xml.includes('Open Task Manager'));
});

test('task titles cannot break the XML', () => {
  const xml = buildToastXml({
    title: 'Chase <invoice> & "sign off"',
    body: "O'Brien & Sons <ltd>"
  });

  assert.ok(!/<text>[^<]*<invoice>/.test(xml), 'raw angle brackets leaked into the XML');
  assert.ok(xml.includes('&amp;'), xml);
  assert.ok(xml.includes('&lt;invoice&gt;'), xml);
});

test('an empty body still produces valid XML', () => {
  const xml = buildToastXml({ title: 'T', body: '' });

  assert.ok(xml.includes('<toast'));
  assert.ok(xml.trim().endsWith('</toast>'));
});
