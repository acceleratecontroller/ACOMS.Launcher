'use strict';

const test = require('node:test');
const assert = require('node:assert');
const rules = require('../src/leave-rules');

const request = (over = {}) => ({
  id: 'req1',
  pending: 'REQUEST',
  employeeName: 'Hendrik de Wet',
  leaveType: 'Sick leave',
  startDate: '2026-11-23',
  endDate: '2026-11-23',
  hours: null,
  startTime: null,
  workingDays: 1,
  noteToManager: null,
  othersOff: [],
  change: null,
  notified: true,
  escalated: false,
  ...over
});

// ── Dates ──────────────────────────────────────────────────────────────────
// A leave date is a calendar day. Reading it as a local moment shifts it a
// day on a computer set to another time zone.

test('a date reads as that calendar day whatever the computer time zone', () => {
  assert.strictEqual(rules.formatDay('2026-11-23'), 'Mon 23 Nov');
  assert.strictEqual(rules.formatDay('2027-01-01'), 'Fri 1 Jan');
  assert.strictEqual(rules.formatRange('2026-12-07', '2026-12-11'), 'Mon 7 Dec to Fri 11 Dec');
  assert.strictEqual(rules.formatRange('2026-12-07', '2026-12-07'), 'Mon 7 Dec');
  assert.strictEqual(rules.formatRange('2026-12-07', null), 'Mon 7 Dec');
});

test('a date that is not a date is shown as it came, never as "Invalid Date"', () => {
  assert.strictEqual(rules.formatDay('next Tuesday'), 'next Tuesday');
  assert.strictEqual(rules.formatDay(null), '');
});

// ── What a card says ───────────────────────────────────────────────────────

test('a whole-day request shows who, the type, the dates and the working days', () => {
  const c = rules.cardContent(request({ startDate: '2026-12-07', endDate: '2026-12-11', workingDays: 5, leaveType: 'Annual leave' }));
  assert.strictEqual(c.name, 'Hendrik de Wet');
  assert.strictEqual(c.leaveType, 'Annual leave');
  assert.deepStrictEqual(c.lines, ['Mon 7 Dec to Fri 11 Dec · 5 working days']);
  assert.strictEqual(c.firstName, 'Hendrik');
});

test('a part day shows the hours and where they start, not a working-day count', () => {
  const c = rules.cardContent(request({ hours: 4, startTime: '11:30' }));
  assert.deepStrictEqual(c.lines, ['Mon 23 Nov', 'Part day: 4 h from 11:30']);
});

test('the note written for the approver and who else is off are shown', () => {
  const c = rules.cardContent(request({ noteToManager: 'Home from lunch', othersOff: ['Omkar Gogna', 'Shane Elliott'] }));
  assert.strictEqual(c.note, 'Home from lunch');
  assert.strictEqual(c.othersOff, 'Also off: Omkar Gogna, Shane Elliott');
});

test('a change to approved leave says what is asked, and shows the change note', () => {
  const change = { cancel: false, startDate: '2026-12-08', endDate: '2026-12-10', hours: null, startTime: null, note: 'Back early' };
  const c = rules.cardContent(request({ pending: 'CHANGE', startDate: '2026-12-07', endDate: '2026-12-11', workingDays: 5, noteToManager: 'old note', change }));
  assert.deepStrictEqual(c.lines, ['Mon 7 Dec to Fri 11 Dec · 5 working days', 'Asks to change it to Tue 8 Dec to Thu 10 Dec']);
  assert.strictEqual(c.note, 'Back early');
  assert.strictEqual(c.key, 'req1:CHANGE');
});

test('a cancel says so', () => {
  const c = rules.cardContent(request({ pending: 'CHANGE', change: { cancel: true, note: null } }));
  assert.strictEqual(c.lines[1], 'Asks to cancel this approved leave');
});

test('an escalated request is marked', () => {
  assert.strictEqual(rules.cardContent(request({ escalated: true })).escalated, true);
  assert.strictEqual(rules.cardContent(request()).escalated, false);
});

test('the card carries only the fields it shows: nothing else from the feed rides along', () => {
  const c = rules.cardContent(request({ evidence: 'certificate.pdf', decisionComment: 'private', calendarNote: 'private' }));
  assert.deepStrictEqual(
    Object.keys(c).sort(),
    ['escalated', 'firstName', 'id', 'key', 'leaveType', 'lines', 'name', 'note', 'othersOff'].sort()
  );
  assert.ok(!/private|certificate/.test(JSON.stringify(c)));
});

// ── Which cards are open ───────────────────────────────────────────────────

test('a new request opens a card; one already open is left alone', () => {
  const a = request({ id: 'a' });
  const b = request({ id: 'b' });
  const p = rules.planCards({ toDecide: [a, b], openKeys: ['a:REQUEST'] });
  assert.deepStrictEqual(p.open.map((c) => c.key), ['b:REQUEST']);
  assert.deepStrictEqual(p.close, []);
});

test('a request that is no longer waiting closes its card: decided, or decided by someone else', () => {
  const p = rules.planCards({ toDecide: [], openKeys: ['a:REQUEST'] });
  assert.deepStrictEqual(p.close, ['a:REQUEST']);
  assert.deepStrictEqual(p.open, []);
});

test('quiet hours hold new cards back but never keep a stale one open', () => {
  const p = rules.planCards({ toDecide: [request({ id: 'b' })], openKeys: ['a:REQUEST'], quiet: true });
  assert.deepStrictEqual(p.open, []);
  assert.deepStrictEqual(p.close, ['a:REQUEST']);
});

test('no more than three cards at once; the rest wait their turn', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => request({ id }));
  const p = rules.planCards({ toDecide: many, openKeys: [] });
  assert.strictEqual(p.open.length, rules.MAX_OPEN_CARDS);
  assert.strictEqual(p.waiting, 2);
  const next = rules.planCards({ toDecide: many.slice(1), openKeys: ['b:REQUEST', 'c:REQUEST'] });
  assert.deepStrictEqual(next.open.map((c) => c.key), ['d:REQUEST']);
});

test('"Later" keeps a card away while it is hidden, and it comes back afterwards', () => {
  const a = request({ id: 'a' });
  assert.deepStrictEqual(rules.planCards({ toDecide: [a], openKeys: [], hiddenKeys: ['a:REQUEST'] }).open, []);
  assert.deepStrictEqual(rules.planCards({ toDecide: [a], openKeys: [], hiddenKeys: [] }).open.map((c) => c.key), ['a:REQUEST']);
});

// ── Answers ────────────────────────────────────────────────────────────────

const answer = (over = {}) => ({
  id: 'ev1',
  requestId: 'req1',
  kind: 'APPROVED',
  by: 'Dion Harre',
  comment: null,
  leaveType: 'Annual leave',
  startDate: '2026-12-07',
  endDate: '2026-12-11',
  hours: null,
  ...over
});

test('an approval says who approved what', () => {
  const a = rules.answerContent(answer());
  assert.strictEqual(a.title, 'Your leave was approved');
  assert.strictEqual(a.body, 'Annual leave, Mon 7 Dec to Fri 11 Dec, by Dion Harre.');
  assert.strictEqual(a.rejected, false);
});

test('a rejection carries the reason', () => {
  const a = rules.answerContent(answer({ kind: 'REJECTED', comment: 'No cover that week' }));
  assert.strictEqual(a.title, 'Your leave was rejected');
  assert.ok(a.body.endsWith('Reason: No cover that week'));
  assert.strictEqual(a.rejected, true);
});

test('the first time this ever runs, old answers are recorded and none is shown', () => {
  const r = rules.planAnswers({ answers: [answer({ id: 'x' }), answer({ id: 'y' })], seen: {}, primed: false });
  assert.deepStrictEqual(r.announce, []);
  assert.deepStrictEqual(r.markSeen.sort(), ['leave-answer:x', 'leave-answer:y']);
  assert.strictEqual(r.baseline, true);
});

test('after that, a new answer is shown once and never again', () => {
  const first = rules.planAnswers({ answers: [answer({ id: 'x' })], seen: {}, primed: true });
  assert.deepStrictEqual(first.announce.map((a) => a.seenId), ['leave-answer:x']);
  const again = rules.planAnswers({ answers: [answer({ id: 'x' })], seen: { 'leave-answer:x': 1 }, primed: true });
  assert.deepStrictEqual(again.announce, []);
});

test('quiet hours hold an answer back without marking it seen, so it shows afterwards', () => {
  const r = rules.planAnswers({ answers: [answer({ id: 'x' })], seen: {}, primed: true, quiet: true });
  assert.deepStrictEqual(r.announce, []);
  assert.deepStrictEqual(r.markSeen, []);
});

// ── Where the cards sit ────────────────────────────────────────────────────

test('cards stack down from the top-right corner without overlapping', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const heights = [200, 160, 240];
  const a = rules.cardBounds(area, heights, 0);
  const b = rules.cardBounds(area, heights, 1);
  const c = rules.cardBounds(area, heights, 2);
  assert.strictEqual(a.x + a.width, 1920 - 16);
  assert.strictEqual(a.y, 16);
  assert.ok(b.y >= a.y + a.height);
  assert.ok(c.y >= b.y + b.height);
  assert.strictEqual(c.height, 240);
});

test('a card is never shorter than its buttons or taller than the limit', () => {
  assert.strictEqual(rules.clampHeight(20), rules.CARD_MIN_HEIGHT);
  assert.strictEqual(rules.clampHeight(9999), rules.CARD_MAX_HEIGHT);
  assert.strictEqual(rules.clampHeight('nonsense'), rules.CARD_MIN_HEIGHT);
});

// ── Upcoming leave, soonest first (the picker strip) ───────────────

const upcoming = (over = {}) => ({
  employeeName: 'Hendrik de Wet',
  startDate: '2026-12-07',
  endDate: '2026-12-11',
  partDay: false,
  hours: null,
  pending: false,
  ...over
});

// The tests read as if it is 2026, whatever year they run in.
const lines2026 = (u) => rules.upcomingLines(u, 2026);

test('one person, one stretch: a name and when, nothing about the type', () => {
  const r = lines2026([upcoming()]);
  assert.deepStrictEqual(r.lines, [{ name: 'Hendrik de Wet', when: 'Mon 7 Dec to Fri 11 Dec', pending: false, extra: 0 }]);
  assert.strictEqual(r.more, '');
  assert.deepStrictEqual(r.all, [{ name: 'Hendrik de Wet', items: [{ when: 'Mon 7 Dec to Fri 11 Dec', pending: false }] }]);
});

test('a single day, a part day and pending leave each read plainly', () => {
  const r = lines2026([
    upcoming({ employeeName: 'A', endDate: '2026-12-07' }),
    upcoming({ employeeName: 'B', endDate: '2026-12-07', partDay: true, hours: 4 }),
    upcoming({ employeeName: 'C', pending: true })
  ]);
  assert.strictEqual(r.lines[0].when, 'Mon 7 Dec');
  assert.strictEqual(r.lines[1].when, 'Mon 7 Dec (part day, 4 h)');
  assert.strictEqual(r.lines[2].pending, true);
});

test('nobody on leave gives no lines', () => {
  for (const none of [[], undefined, null]) {
    assert.deepStrictEqual(lines2026(none), { lines: [], more: '', all: [] });
  }
});

test('a person with several stretches gets ONE line: the next one, and how many more', () => {
  const r = lines2026([
    upcoming({ employeeName: 'James Denison', startDate: '2026-12-01', endDate: '2026-12-01' }),
    upcoming({ employeeName: 'James Denison', startDate: '2026-12-02', endDate: '2026-12-02', partDay: true, hours: 4 }),
    upcoming({ employeeName: 'Hendrik de Wet' }),
    upcoming({ employeeName: 'James Denison', startDate: '2026-12-07', endDate: '2026-12-07', partDay: true, hours: 4 }),
    upcoming({ employeeName: 'James Denison', startDate: '2026-12-16', endDate: '2026-12-16', pending: true })
  ]);
  assert.deepStrictEqual(r.lines, [
    { name: 'James Denison', when: 'Tue 1 Dec', pending: false, extra: 3 },
    { name: 'Hendrik de Wet', when: 'Mon 7 Dec to Fri 11 Dec', pending: false, extra: 0 }
  ]);
  assert.strictEqual(r.more, '');
});

test('the full list keeps every stretch, grouped by person', () => {
  const r = lines2026([
    upcoming({ employeeName: 'James Denison', startDate: '2026-12-01', endDate: '2026-12-01' }),
    upcoming({ employeeName: 'Hendrik de Wet' }),
    upcoming({ employeeName: 'James Denison', startDate: '2026-12-16', endDate: '2026-12-16', pending: true })
  ]);
  assert.deepStrictEqual(r.all, [
    {
      name: 'James Denison',
      items: [
        { when: 'Tue 1 Dec', pending: false },
        { when: 'Wed 16 Dec', pending: true }
      ]
    },
    { name: 'Hendrik de Wet', items: [{ when: 'Mon 7 Dec to Fri 11 Dec', pending: false }] }
  ]);
});

test('four people or fewer: every person, and no fifth line', () => {
  const four = Array.from({ length: 4 }, (_, i) => upcoming({ employeeName: `Person ${i}` }));
  const r = lines2026(four);
  assert.strictEqual(r.lines.length, 4);
  assert.strictEqual(r.more, '');
});

test('more than four people: four lines, then how many other people and when the next one starts', () => {
  const nine = Array.from({ length: 9 }, (_, i) =>
    upcoming({ employeeName: `Person ${i}`, startDate: `2026-12-${String(7 + i).padStart(2, '0')}`, endDate: `2026-12-${String(7 + i).padStart(2, '0')}` })
  );
  const r = lines2026(nine);
  assert.strictEqual(rules.MAX_UPCOMING_LINES, 4);
  assert.deepStrictEqual(r.lines.map((l) => l.name), ['Person 0', 'Person 1', 'Person 2', 'Person 3']);
  assert.strictEqual(r.more, 'plus 5 other people, next one Fri 11 Dec');
  assert.strictEqual(r.all.length, 9, 'the full list still has everyone');
});

test('one more person reads as "1 other person"', () => {
  const five = Array.from({ length: 5 }, (_, i) => upcoming({ employeeName: `Person ${i}` }));
  assert.strictEqual(lines2026(five).more, 'plus 1 other person, next one Mon 7 Dec');
});

test('leave in another year carries its year, in the strip and in the fifth line', () => {
  const r = lines2026([upcoming({ employeeName: 'Dion Harre', startDate: '2027-03-30', endDate: '2027-04-16' })]);
  assert.strictEqual(r.lines[0].when, 'Tue 30 Mar to Fri 16 Apr 2027');
  const five = [
    ...Array.from({ length: 4 }, (_, i) => upcoming({ employeeName: `Person ${i}` })),
    upcoming({ employeeName: 'Dion Harre', startDate: '2027-03-30', endDate: '2027-04-16' })
  ];
  assert.strictEqual(lines2026(five).more, 'plus 1 other person, next one Tue 30 Mar 2027');
});
