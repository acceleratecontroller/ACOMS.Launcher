'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseTask, dayWords, timeWords } = require('../src/chat-task-parse');

// Wednesday 7 October 2026, mid-morning — the day this was written.
const NOW = new Date(2026, 9, 7, 10, 30);
const due = (text, now = NOW) => parseTask(text, now).dueDate;
const at = (text) => parseTask(text, NOW).dueTime;

test("Dion's own examples", () => {
  assert.deepStrictEqual(parseTask('need this done by 2pm 8/10', NOW), {
    dueDate: '2026-10-08',
    dueTime: '14:00',
    job: null,
    label: null
  });
  assert.strictEqual(due('need this done by next thursday'), '2026-10-15');
});

test('weekdays: bare = the coming one, "next" = next week', () => {
  assert.strictEqual(due('by thursday'), '2026-10-08');
  assert.strictEqual(due('this thursday'), '2026-10-08');
  assert.strictEqual(due('by wednesday'), '2026-10-14'); // today is Wednesday
  assert.strictEqual(due('fri'), '2026-10-09');
  assert.strictEqual(due('next monday'), '2026-10-12');
  assert.strictEqual(due('next fri'), '2026-10-16');
  assert.strictEqual(due('thurs arvo'), '2026-10-08');
  // "sat" and "sun" are ordinary words too often to mean a day.
  assert.strictEqual(due('sat down with bob in the sun'), null);
  assert.strictEqual(due('saturday'), '2026-10-10');
});

test('words for days', () => {
  assert.strictEqual(due('today please'), '2026-10-07');
  assert.strictEqual(due('by cob'), '2026-10-07');
  assert.strictEqual(due('tomorrow'), '2026-10-08');
  assert.strictEqual(due('tmrw'), '2026-10-08');
  assert.strictEqual(due('the day after tomorrow'), '2026-10-09');
  assert.strictEqual(due('end of week'), '2026-10-09');
  assert.strictEqual(due('eom'), '2026-10-31');
  assert.strictEqual(due('sometime next week'), '2026-10-12');
  assert.strictEqual(due('in 3 days'), '2026-10-10');
  assert.strictEqual(due('in a fortnight'), '2026-10-21');
  assert.strictEqual(due('in two weeks'), '2026-10-21');
});

test('dates are day/month (Australian), rolling to next year once gone', () => {
  assert.strictEqual(due('8/10'), '2026-10-08');
  assert.strictEqual(due('due 1/11'), '2026-11-01');
  assert.strictEqual(due('3/2'), '2027-02-03'); // February has gone this year
  assert.strictEqual(due('8/10/26'), '2026-10-08');
  assert.strictEqual(due('08.10.2026'), '2026-10-08');
  assert.strictEqual(due('31/2'), null); // not a date
  assert.strictEqual(due('8 oct'), '2026-10-08');
  assert.strictEqual(due('the 12th of November'), '2026-11-12');
  assert.strictEqual(due('Oct 20'), '2026-10-20');
  assert.strictEqual(due('5 jan'), '2027-01-05');
});

test('times', () => {
  assert.strictEqual(at('by 2pm'), '14:00');
  assert.strictEqual(at('at 2:30 pm'), '14:30');
  assert.strictEqual(at('9.15am'), '09:15');
  assert.strictEqual(at('12pm'), '12:00');
  assert.strictEqual(at('12am'), '00:00');
  assert.strictEqual(at('by 14:00'), '14:00');
  assert.strictEqual(at('noon'), '12:00');
  assert.strictEqual(at('by 8/10'), null); // a date, not a time
  assert.strictEqual(at('call bob'), null);
});

test('job numbers are found and never read as dates or times', () => {
  const r = parseTask('chase the PO for a1016b by friday', NOW);
  assert.strictEqual(r.job, 'A1016B');
  assert.strictEqual(r.dueDate, '2026-10-09');
  assert.strictEqual(parseTask('A1234', NOW).dueDate, null);
  assert.strictEqual(parseTask('book A12 hire', NOW).job, null); // too short
});

test('a category already used in the Task Manager, longest match wins', () => {
  const labels = ['Task', 'Quote', 'Admin', 'Site visit', 'Invoice follow up'];
  assert.strictEqual(parseTask('quote for Smith St', NOW, labels).label, 'Quote');
  assert.strictEqual(parseTask('do the site visit at A1234', NOW, labels).label, 'Site visit');
  assert.strictEqual(parseTask('#admin rego renewal', NOW, labels).label, 'Admin');
  assert.strictEqual(parseTask('quoted already', NOW, labels).label, null); // whole words only
  assert.strictEqual(parseTask('a task', NOW, labels).label, null); // Task is the default anyway
});

test('nothing found is nothing, not a guess', () => {
  assert.deepStrictEqual(parseTask('sort out the trailer', NOW), {
    dueDate: null,
    dueTime: null,
    job: null,
    label: null
  });
});

test('read-back words', () => {
  assert.strictEqual(dayWords('2026-10-15'), 'Thu 15 Oct');
  assert.strictEqual(timeWords('14:00'), '2:00 pm');
  assert.strictEqual(timeWords('00:05'), '12:05 am');
  assert.strictEqual(dayWords('junk'), '');
});
