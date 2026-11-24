'use strict';

const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/calendar-rules');

test('a month is six Monday-to-Sunday weeks holding it', () => {
  const g = R.monthGrid('2026-11');
  assert.strictEqual(g.weeks.length, 6);
  assert.ok(g.weeks.every((w) => w.length === 7));
  assert.strictEqual(g.from, '2026-10-26'); // the Monday before Sun 1 Nov
  assert.strictEqual(g.to, '2026-12-06');
  assert.deepStrictEqual(g.weeks[0][6], { ymd: '2026-11-01', day: 1, inMonth: true });
  assert.strictEqual(g.weeks[0][0].inMonth, false);
});

test('a month that starts on a Monday starts on its own first day', () => {
  assert.strictEqual(R.monthGrid('2027-02').from, '2027-02-01');
});

test('months step across the year, and read as words', () => {
  assert.strictEqual(R.shiftMonth('2026-12', 1), '2027-01');
  assert.strictEqual(R.shiftMonth('2027-01', -1), '2026-12');
  assert.strictEqual(R.monthTitle('2026-11'), 'November 2026');
});

test('each day lists holiday, RDO, event, leave, pending, in that order', () => {
  const index = R.dayIndex({
    holidays: [{ date: '2026-12-25', name: 'Christmas Day' }],
    rdoDays: ['2026-12-25'],
    events: [{ name: 'Christmas Break', date: '2026-12-24', endDate: '2026-12-26' }],
    leave: [
      { employeeName: 'Zed', startDate: '2026-12-25', endDate: '2026-12-25', pending: true },
      { employeeName: 'Amy', startDate: '2026-12-25', endDate: '2026-12-25', pending: false }
    ]
  });
  assert.deepStrictEqual(index.get('2026-12-25'), [
    { kind: 'holiday', text: 'Christmas Day' },
    { kind: 'rdo', text: 'RDO' },
    { kind: 'event', text: 'Christmas Break' },
    { kind: 'leave', text: 'Amy' },
    { kind: 'pending', text: 'Zed' }
  ]);
  assert.deepStrictEqual(index.get('2026-12-26'), [{ kind: 'event', text: 'Christmas Break' }], 'an event runs over the weekend');
});

test('leave is a name on working days only; a part day says so', () => {
  const index = R.dayIndex({
    leave: [
      { employeeName: 'Hendrik de Wet', startDate: '2026-12-11', endDate: '2026-12-14' },
      { employeeName: 'James Denison', startDate: '2026-12-07', endDate: '2026-12-07', partDay: true, hours: 4 }
    ]
  });
  assert.deepStrictEqual(index.get('2026-12-11'), [{ kind: 'leave', text: 'Hendrik de Wet' }]);
  assert.strictEqual(index.get('2026-12-12'), undefined, 'Saturday');
  assert.strictEqual(index.get('2026-12-13'), undefined, 'Sunday');
  assert.deepStrictEqual(index.get('2026-12-14'), [{ kind: 'leave', text: 'Hendrik de Wet' }]);
  assert.deepStrictEqual(index.get('2026-12-07'), [{ kind: 'leave', text: 'James Denison (part day, 4 h)' }]);
});

test('nothing sent: an empty calendar, not an error', () => {
  for (const none of [undefined, null, {}, { leave: 'x' }]) assert.strictEqual(R.dayIndex(none).size, 0);
});
