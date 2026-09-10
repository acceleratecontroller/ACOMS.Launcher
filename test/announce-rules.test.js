'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { decideAnnouncements, expiredSeenIds } = require('../src/announce-rules');

const NOW = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function decide(over = {}) {
  return decideAnnouncements({
    actionIds: [],
    seen: {},
    primed: true,
    quiet: false,
    now: NOW,
    ...over
  });
}

// ── The first poll ─────────────────────────────────────────────────────────
// The bug this exists to prevent: a fresh install greeting someone with
// "19 things need you", every one of them weeks old.

test('the very first poll announces nothing and records a baseline', () => {
  const r = decide({ actionIds: ['a', 'b', 'c'], primed: false });

  assert.deepStrictEqual(r.announce, []);
  assert.deepStrictEqual(r.markSeen.sort(), ['a', 'b', 'c']);
  assert.strictEqual(r.baseline, true);
});

test('the poll after the baseline announces only what is genuinely new', () => {
  const seen = { a: NOW, b: NOW, c: NOW };
  const r = decide({ actionIds: ['a', 'b', 'c', 'd'], seen });

  assert.deepStrictEqual(r.announce, ['d']);
  assert.strictEqual(r.baseline, false);
});

test('a first poll that finds nothing still primes, so the next new thing is news', () => {
  const r = decide({ actionIds: [], primed: false });

  assert.deepStrictEqual(r.markSeen, []);
  assert.strictEqual(r.baseline, true);
});

// ── Still-open items are not new again ─────────────────────────────────────

test('ids still present are touched, not re-announced', () => {
  const seen = { a: NOW - 40 * DAY };
  const r = decide({ actionIds: ['a'], seen });

  assert.deepStrictEqual(r.announce, []);
  assert.deepStrictEqual(r.touch, ['a']);
});

test('touching keeps a long-open item alive past the TTL', () => {
  // A task overdue since July, seen 40 days ago, still open today.
  const seen = { task: NOW - 40 * DAY };
  const ttl = 30 * DAY;

  // Without a touch it would be forgotten, and so announced again as new.
  assert.deepStrictEqual(expiredSeenIds(seen, NOW, ttl), ['task']);

  // The poll refreshes it because the item is still being returned.
  const r = decide({ actionIds: ['task'], seen });
  assert.deepStrictEqual(r.touch, ['task']);
  const refreshed = { task: NOW };
  assert.deepStrictEqual(expiredSeenIds(refreshed, NOW, ttl), []);
});

test('an item that genuinely went away does expire', () => {
  const seen = { gone: NOW - 40 * DAY };

  // It is not in actionIds any more, so nothing refreshes it.
  const r = decide({ actionIds: [], seen });
  assert.deepStrictEqual(r.touch, []);
  assert.deepStrictEqual(expiredSeenIds(seen, NOW, 30 * DAY), ['gone']);
});

test('a resolved item that comes back IS news again', () => {
  // Forgotten after being absent, then raised again — that is a new event.
  const r = decide({ actionIds: ['jr-1'], seen: {} });

  assert.deepStrictEqual(r.announce, ['jr-1']);
});

// ── Quiet hours ────────────────────────────────────────────────────────────

test('quiet hours announce nothing but still mark seen', () => {
  const r = decide({ actionIds: ['a'], quiet: true });

  assert.deepStrictEqual(r.announce, []);
  assert.deepStrictEqual(r.markSeen, ['a']);
});

test('quiet hours still touch what is already known', () => {
  const seen = { a: NOW - 40 * DAY };
  const r = decide({ actionIds: ['a', 'b'], seen, quiet: true });

  assert.deepStrictEqual(r.touch, ['a']);
  assert.deepStrictEqual(r.markSeen, ['b']);
});

// ── Defensive ──────────────────────────────────────────────────────────────

test('rubbish ids are ignored rather than announced', () => {
  const r = decide({ actionIds: ['ok', '', null, undefined, 7] });

  assert.deepStrictEqual(r.announce, ['ok']);
});

test('a missing or broken seen map is treated as empty', () => {
  assert.deepStrictEqual(decide({ actionIds: ['a'], seen: null }).announce, ['a']);
  assert.deepStrictEqual(expiredSeenIds(null, NOW, DAY), []);
});

test('a non-numeric timestamp is expired rather than trusted', () => {
  assert.deepStrictEqual(expiredSeenIds({ a: 'yesterday' }, NOW, DAY), ['a']);
});
