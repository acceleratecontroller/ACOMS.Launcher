'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  companyTaskItems,
  taskIdFromFeedId,
  cardKey,
  cardsToRetire,
  clickOutcome,
  retiredMessage
} = require('../src/company-task-rules');

const item = (over = {}) => ({
  id: 'company:t1:0',
  kind: 'company-task',
  severity: 'action',
  title: 'A1191 needs a From Plan view',
  subtitle: 'ACOMS task · unclaimed · A1191',
  path: '/tasks?tab=acoms&task=t1',
  taskId: 't1',
  category: 'GIS_VIEW_REQUEST',
  ...over
});

// ── Which feed items are company tasks ─────────────────────────────────────

test('picks only action company-task items and carries the task id', () => {
  const out = companyTaskItems([
    item(),
    { id: 'task:x', kind: 'task', severity: 'action', title: 'mine' },
    { id: 'jobrequest:1', kind: 'approval', severity: 'action', title: 'JR' },
    item({ id: 'company:t2:3', taskId: 't2', severity: 'info' })
  ]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], {
    id: 'company:t1:0',
    taskId: 't1',
    title: 'A1191 needs a From Plan view',
    subtitle: 'ACOMS task · unclaimed · A1191',
    path: '/tasks?tab=acoms&task=t1',
    category: 'GIS_VIEW_REQUEST'
  });
});

test('falls back to the task id inside the feed id for an older Controller', () => {
  const out = companyTaskItems([item({ taskId: undefined, id: 'company:abc-123:7' })]);
  assert.strictEqual(out[0].taskId, 'abc-123');
  assert.strictEqual(taskIdFromFeedId('company:abc-123:7'), 'abc-123');
  assert.strictEqual(taskIdFromFeedId('task:abc'), null);
});

test('tolerates a missing or non-array items list', () => {
  assert.deepStrictEqual(companyTaskItems(undefined), []);
  assert.deepStrictEqual(companyTaskItems(null), []);
});

// ── The card key ignores the nag generation ───────────────────────────────
// The 4-hour re-pop works by Controller changing the FEED id. The card must
// stay the same card (replaced, re-beeped), never a second one stacked up.

test('the card key is per task, not per feed id', () => {
  assert.strictEqual(cardKey('t1'), 'company-task:t1');
  const gen0 = companyTaskItems([item({ id: 'company:t1:0' })])[0];
  const gen1 = companyTaskItems([item({ id: 'company:t1:1' })])[0];
  assert.notStrictEqual(gen0.id, gen1.id);
  assert.strictEqual(cardKey(gen0.taskId), cardKey(gen1.taskId));
});

// ── Cards whose task left the feed ────────────────────────────────────────

test('a card whose task is no longer in the feed is retired', () => {
  const feed = companyTaskItems([item({ taskId: 't1' }), item({ id: 'company:t3:0', taskId: 't3' })]);
  assert.deepStrictEqual(cardsToRetire(['t1', 't2', 't3'], feed), ['t2']);
});

test('nothing is retired when nothing is shown, and everything when the feed is empty', () => {
  assert.deepStrictEqual(cardsToRetire([], companyTaskItems([item()])), []);
  assert.deepStrictEqual(cardsToRetire(['t1'], []), ['t1']);
});

// ── The click ─────────────────────────────────────────────────────────────

test('unclaimed → open', () => {
  assert.deepStrictEqual(clickOutcome({ state: { open: true, claimed: false, mine: false } }), {
    action: 'open'
  });
});

test('already mine → open', () => {
  assert.deepStrictEqual(
    clickOutcome({ state: { open: true, claimed: true, mine: true, claimedByName: 'Dion H' } }),
    { action: 'open' }
  );
});

test("someone else's → a note naming them, and the app does not open", () => {
  const r = clickOutcome({
    state: { open: true, claimed: true, mine: false, claimedByName: 'JD Smith' }
  });
  assert.deepStrictEqual(r, { action: 'note', message: 'JD Smith has claimed this' });
});

test('claimed by an unnamed person still says someone', () => {
  const r = clickOutcome({ state: { open: true, claimed: true, mine: false, claimedByName: null } });
  assert.strictEqual(r.message, 'Someone has claimed this');
});

test('done → a note', () => {
  const r = clickOutcome({ state: { open: false, claimed: true, mine: false } });
  assert.deepStrictEqual(r, { action: 'note', message: 'This task is already done' });
});

test('404 (gone) → a note; a FAILED request → open anyway', () => {
  assert.strictEqual(clickOutcome({ state: null }).action, 'note');
  // The app is still the right place to go when Controller cannot be asked;
  // a click that does nothing is the worse failure.
  assert.deepStrictEqual(clickOutcome({ state: null, error: true }), { action: 'open' });
  assert.deepStrictEqual(clickOutcome(), { action: 'note', message: 'This task is no longer in the queue' });
});

// ── The retire note ───────────────────────────────────────────────────────

test('retired note says who claimed it, or that it is done, or that it went', () => {
  assert.strictEqual(retiredMessage({ open: true, claimed: true, claimedByName: 'JD Smith' }), 'JD Smith has claimed this');
  assert.strictEqual(retiredMessage({ open: false, claimed: true }), 'This task is done');
  assert.strictEqual(retiredMessage(null), 'This task is no longer in the queue');
});
