'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_INDIVIDUAL,
  companyTaskItems,
  taskIdFromFeedId,
  generationFromFeedId,
  cardKey,
  planCompanyCards,
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

const feedOf = (...items) => companyTaskItems(items);
const plan = (over = {}) =>
  planCompanyCards({ feedItems: [], shown: {}, dismissed: {}, summary: null, quiet: false, ...over });
const ids = (list) => list.map((i) => i.taskId);

// ── Which feed items are company tasks ─────────────────────────────────────

test('picks only action company-task items and carries task id + generation', () => {
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
    generation: 0,
    title: 'A1191 needs a From Plan view',
    subtitle: 'ACOMS task · unclaimed · A1191',
    path: '/tasks?tab=acoms&task=t1',
    category: 'GIS_VIEW_REQUEST'
  });
});

test('reads the task id and generation out of the feed id', () => {
  assert.strictEqual(taskIdFromFeedId('company:abc-123:7'), 'abc-123');
  assert.strictEqual(generationFromFeedId('company:abc-123:7'), 7);
  assert.strictEqual(taskIdFromFeedId('task:abc'), null);
  assert.strictEqual(generationFromFeedId('task:abc'), 0);
  const out = companyTaskItems([item({ taskId: undefined, id: 'company:abc-123:7' })]);
  assert.strictEqual(out[0].taskId, 'abc-123');
});

test('tolerates a missing or non-array items list', () => {
  assert.deepStrictEqual(companyTaskItems(undefined), []);
  assert.deepStrictEqual(companyTaskItems(null), []);
});

test('the card key is per task, not per feed id', () => {
  assert.strictEqual(cardKey('t1'), 'company-task:t1');
});

// ── The plan: a card is on screen WHILE the task is unclaimed ─────────────

test('a task in the feed with no card up → show it (also after a restart)', () => {
  const p = plan({ feedItems: feedOf(item()) });
  assert.strictEqual(p.mode, 'individual');
  assert.deepStrictEqual(ids(p.show), ['t1']);
  assert.deepStrictEqual(p.retire, []);
});

test('a card already up for the same generation → nothing to do', () => {
  const p = plan({ feedItems: feedOf(item()), shown: { t1: 0 } });
  assert.deepStrictEqual(p.show, []);
});

test('the generation moved on → show it again (the 4-hour re-pop)', () => {
  const p = plan({ feedItems: feedOf(item({ id: 'company:t1:1' })), shown: { t1: 0 } });
  assert.deepStrictEqual(ids(p.show), ['t1']);
});

test('closed with × → stays down for THAT generation, comes back on the next', () => {
  const down = plan({ feedItems: feedOf(item({ id: 'company:t1:2' })), dismissed: { t1: 2 } });
  assert.deepStrictEqual(down.show, []);
  const back = plan({ feedItems: feedOf(item({ id: 'company:t1:3' })), dismissed: { t1: 2 } });
  assert.deepStrictEqual(ids(back.show), ['t1']);
});

test('a card whose task left the feed → retire it', () => {
  const p = plan({ feedItems: feedOf(item()), shown: { t1: 0, t2: 1 } });
  assert.deepStrictEqual(p.retire, ['t2']);
});

test('quiet hours: raise nothing new, still retire what is gone', () => {
  const p = plan({ feedItems: feedOf(item()), shown: { t9: 0 }, quiet: true });
  assert.deepStrictEqual(p.show, []);
  assert.deepStrictEqual(p.retire, ['t9']);
});

test('an empty feed retires every card', () => {
  const p = plan({ feedItems: [], shown: { t1: 0, t2: 0 } });
  assert.deepStrictEqual(p.retire.sort(), ['t1', 't2']);
});

// ── Too many: one summary card, never a self-evicting stack ──────────────

function many(n) {
  return Array.from({ length: n }, (_, i) =>
    item({ id: `company:t${i}:0`, taskId: `t${i}`, title: `task ${i}` })
  );
}

test(`more than ${MAX_INDIVIDUAL} unclaimed → summary mode with a count, individual cards folded`, () => {
  const p = plan({ feedItems: feedOf(...many(MAX_INDIVIDUAL + 1)), shown: { t0: 0, t1: 0 } });
  assert.strictEqual(p.mode, 'summary');
  assert.deepStrictEqual(p.show, []);
  assert.strictEqual(p.summary.count, MAX_INDIVIDUAL + 1);
  assert.deepStrictEqual(p.fold.sort(), ['t0', 't1']);
  assert.deepStrictEqual(p.retire, []);
});

test('the summary card re-pops when any task or generation in it changes, not otherwise', () => {
  const feed = feedOf(...many(5));
  const first = plan({ feedItems: feed });
  const same = plan({ feedItems: feed, summary: first.summary.signature });
  assert.strictEqual(same.summary, null);
  const rolled = plan({
    feedItems: feedOf(...many(5).map((i, n) => (n === 2 ? { ...i, id: 'company:t2:1' } : i))),
    summary: first.summary.signature
  });
  assert.strictEqual(rolled.summary.count, 5);
  assert.notStrictEqual(rolled.summary.signature, first.summary.signature);
});

test('summary mode in quiet hours shows nothing new', () => {
  const p = plan({ feedItems: feedOf(...many(5)), quiet: true });
  assert.strictEqual(p.mode, 'summary');
  assert.strictEqual(p.summary, null);
});

test('back under the limit → the summary comes down and individual cards show', () => {
  const p = plan({ feedItems: feedOf(...many(2)), summary: 'old-signature' });
  assert.strictEqual(p.mode, 'individual');
  assert.strictEqual(p.dropSummary, true);
  assert.deepStrictEqual(ids(p.show).sort(), ['t0', 't1']);
});

// ── The click ─────────────────────────────────────────────────────────────

test('unclaimed → open; already mine → open', () => {
  assert.deepStrictEqual(clickOutcome({ state: { open: true, claimed: false, mine: false } }), { action: 'open' });
  assert.deepStrictEqual(clickOutcome({ state: { open: true, claimed: true, mine: true } }), { action: 'open' });
});

test("someone else's → a note naming them, and the app does not open", () => {
  const r = clickOutcome({ state: { open: true, claimed: true, mine: false, claimedByName: 'JD Smith' } });
  assert.deepStrictEqual(r, { action: 'note', message: 'JD Smith has claimed this' });
  assert.strictEqual(
    clickOutcome({ state: { open: true, claimed: true, mine: false, claimedByName: null } }).message,
    'Someone has claimed this'
  );
});

test('done → a note; gone (404) → a note; a FAILED request → open anyway', () => {
  assert.deepStrictEqual(clickOutcome({ state: { open: false, claimed: true } }), {
    action: 'note',
    message: 'This task is already done'
  });
  assert.strictEqual(clickOutcome({ state: null }).action, 'note');
  // The app is still the right place to go when Controller cannot be asked.
  assert.deepStrictEqual(clickOutcome({ state: null, error: true }), { action: 'open' });
});

// ── The retire note ───────────────────────────────────────────────────────

test('retired note: who claimed it / done / gone — and SILENT when it is still open and unclaimed', () => {
  assert.strictEqual(retiredMessage({ open: true, claimed: true, claimedByName: 'JD Smith' }), 'JD Smith has claimed this');
  assert.strictEqual(retiredMessage({ open: false, claimed: true }), 'This task is done');
  assert.strictEqual(retiredMessage(null), 'This task is no longer in the queue');
  // The feed said gone but the task is still up for grabs (a rollback, a
  // role change): take the card down quietly, there is nothing to announce.
  assert.strictEqual(retiredMessage({ open: true, claimed: false }), null);
});
