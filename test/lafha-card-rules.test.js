'use strict';

const test = require('node:test');
const assert = require('node:assert');
const rules = require('../src/leave-rules');

const RATES = [
  { kind: 'STANDARD', dollars: 200 },
  { kind: 'ACCOMMODATION_PAID', dollars: 60 }
];

const request = (over = {}) => ({
  id: 'lf1',
  employeeName: 'James Denison',
  enteredByName: null,
  leaveDate: '2026-11-27',
  homeDate: '2026-12-01',
  nights: 4,
  place: null,
  job: { wipProjectId: 'p1', label: 'A1008 · 173 Nandroya Road, Cooroy' },
  noJobReason: null,
  note: null,
  owes: [],
  notified: true,
  escalated: false,
  ...over
});

// ── The card ───────────────────────────────────────────────────────────────

test('a LAFHA card says who, the dates and nights, the job, and what each rate comes to', () => {
  const c = rules.lafhaCardContent(request(), RATES);
  assert.strictEqual(c.kind, 'lafha');
  assert.strictEqual(c.key, 'lafha:lf1');
  assert.strictEqual(c.label, 'LAFHA request');
  assert.strictEqual(c.name, 'James Denison');
  assert.deepStrictEqual(c.lines, ['Fri 27 Nov to Tue 1 Dec · 4 nights', 'A1008 · 173 Nandroya Road, Cooroy', '$200 a night = $800 · $60 a night = $240']);
});

test('the approver sets the amount: one Approve button per fixed rate', () => {
  const c = rules.lafhaCardContent(request(), RATES);
  assert.deepStrictEqual(
    c.approve.map((a) => [a.rateKind, a.text, a.total]),
    [
      ['STANDARD', 'Approve $200', '4 nights at $200 = $800'],
      ['ACCOMMODATION_PAID', 'Approve $60', '4 nights at $60 = $240']
    ]
  );
  assert.strictEqual(c.openText, 'Change the dates or the amount');
});

test('one night reads as one night', () => {
  const c = rules.lafhaCardContent(request({ homeDate: '2026-11-28', nights: 1 }), RATES);
  assert.strictEqual(c.lines[0], 'Fri 27 Nov to Sat 28 Nov · 1 night');
  assert.strictEqual(c.approve[0].total, '1 night at $200 = $200');
});

test('no job shows the reason; where they stay, the note and who asked are shown when given', () => {
  const c = rules.lafhaCardContent(
    request({ job: null, noJobReason: 'Traineeship course', place: 'Townsville', note: 'Back Friday arvo', enteredByName: 'Rob Langridge' }),
    RATES
  );
  assert.deepStrictEqual(c.lines.slice(1, 4), ['No job: Traineeship course', 'Staying: Townsville', 'Asked by Rob Langridge']);
  assert.strictEqual(c.note, 'Back Friday arvo');
});

test('what the person owes from earlier LAFHA is on the card, only the part that comes off LAFHA', () => {
  const c = rules.lafhaCardContent(
    request({
      owes: [
        { remaining: 200, method: 'NEXT_LAFHA' },
        { remaining: 60, method: 'NEXT_LAFHA' },
        { remaining: 500, method: 'FROM_PAY' }
      ]
    }),
    RATES
  );
  assert.strictEqual(c.othersOff, 'Owes $260 from earlier LAFHA. It comes off this one.');
  assert.strictEqual(rules.lafhaCardContent(request(), RATES).othersOff, null);
});

test('a feed with no rates still makes a card, with no one-click approve', () => {
  const c = rules.lafhaCardContent(request());
  assert.deepStrictEqual(c.approve, []);
  assert.strictEqual(c.lines.length, 2);
});

// ── Sharing the screen with leave cards ────────────────────────────────────

test('LAFHA cards open beside leave cards and close when no longer waiting', () => {
  const lafha = [rules.lafhaCardContent(request(), RATES)];
  const first = rules.planCards({ toDecide: [], extra: lafha, openKeys: [], hiddenKeys: [], quiet: false });
  assert.deepStrictEqual(first.open.map((c) => c.key), ['lafha:lf1']);
  const decided = rules.planCards({ toDecide: [], extra: [], openKeys: ['lafha:lf1'], hiddenKeys: [], quiet: false });
  assert.deepStrictEqual(decided.close, ['lafha:lf1']);
});

test('Later and quiet hours hold a LAFHA card back the same way as leave', () => {
  const lafha = [rules.lafhaCardContent(request(), RATES)];
  assert.deepStrictEqual(rules.planCards({ extra: lafha, hiddenKeys: ['lafha:lf1'] }).open, []);
  assert.deepStrictEqual(rules.planCards({ extra: lafha, quiet: true }).open, []);
});

// ── The answer back ────────────────────────────────────────────────────────

const answer = (over = {}) => ({
  id: 'ev1',
  kind: 'APPROVED',
  by: 'Dion Harre',
  comment: null,
  amount: null,
  request: { leaveDate: '2026-11-27', homeDate: '2026-12-01', nights: 4, rate: 200, total: 800 },
  ...over
});

test('the person is told it was approved, with the nights and the amount', () => {
  const a = rules.lafhaAnswerContent(answer());
  assert.strictEqual(a.seenId, 'lafha-answer:ev1');
  assert.strictEqual(a.label, 'LAFHA');
  assert.strictEqual(a.title, 'Your LAFHA was approved');
  assert.strictEqual(a.body, 'Fri 27 Nov to Tue 1 Dec, 4 nights, $800, by Dion Harre.');
  assert.strictEqual(a.rejected, false);
});

test('an approval the approver changed carries their note', () => {
  const a = rules.lafhaAnswerContent(answer({ comment: 'Back Monday', request: { leaveDate: '2026-11-27', homeDate: '2026-11-30', nights: 3, rate: 200, total: 600 } }));
  assert.strictEqual(a.body, 'Fri 27 Nov to Mon 30 Nov, 3 nights, $600, by Dion Harre. Note: Back Monday');
});

test('not approved gives the reason and is marked as a refusal', () => {
  const a = rules.lafhaAnswerContent(answer({ kind: 'REJECTED', comment: 'Day trip' }));
  assert.strictEqual(a.title, 'Your LAFHA was not approved');
  assert.strictEqual(a.body, 'Fri 27 Nov to Tue 1 Dec, by Dion Harre. Reason: Day trip');
  assert.strictEqual(a.rejected, true);
});

test('paid says how much; a later change to the nights says what it is now', () => {
  assert.strictEqual(rules.lafhaAnswerContent(answer({ kind: 'PAID', by: 'Helen Gosper', amount: 600 })).body, 'Fri 27 Nov to Tue 1 Dec: $600.');
  const changed = rules.lafhaAnswerContent(answer({ kind: 'NIGHTS_CHANGED', comment: 'Home Monday', request: { leaveDate: '2026-11-27', homeDate: '2026-11-30', nights: 3, rate: 200, total: 600 } }));
  assert.strictEqual(changed.title, 'The nights on your LAFHA were changed');
  assert.strictEqual(changed.body, 'Now Fri 27 Nov to Mon 30 Nov, 3 nights, by Dion Harre. Note: Home Monday');
});

test('LAFHA answers are shown once, and a new install does not replay old ones', () => {
  const answers = [answer()];
  const fresh = rules.planAnswers({ answers, seen: {}, primed: true, content: rules.lafhaAnswerContent });
  assert.deepStrictEqual(fresh.announce.map((a) => a.seenId), ['lafha-answer:ev1']);
  const again = rules.planAnswers({ answers, seen: { 'lafha-answer:ev1': 1 }, primed: true, content: rules.lafhaAnswerContent });
  assert.deepStrictEqual(again.announce, []);
  const firstRun = rules.planAnswers({ answers, seen: {}, primed: false, content: rules.lafhaAnswerContent });
  assert.deepStrictEqual(firstRun.announce, []);
  assert.strictEqual(firstRun.baseline, true);
});
