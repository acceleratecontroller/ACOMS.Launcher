'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { split, decideNag, hoursWaiting } = require('../src/chat-questions');

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-10-07T00:00:00.000Z');
const q = (id, senderId, minutesAgoAtT0 = 0, over = {}) => ({
  id,
  conversationId: 'c1',
  senderId,
  senderName: senderId === 'jd' ? 'JD' : 'Dion',
  body: `Question ${id}?`,
  createdAt: new Date(T0 - minutesAgoAtT0 * 60 * 1000).toISOString(),
  ...over
});

test('both ways: waiting on me, and waiting on them', () => {
  const r = split([q('a', 'jd'), q('b', 'dion'), q('c', 'jd')], 'dion');
  assert.deepStrictEqual(r.forMe.map((x) => x.id), ['a', 'c']);
  assert.deepStrictEqual(r.byMe.map((x) => x.id), ['b']);
});

test('no nag in the first hour, then once per hour', () => {
  const list = [q('a', 'jd')];
  let r = decideNag({ openQuestions: list, meId: 'dion', nowMs: T0 + 59 * 60 * 1000, shown: {} });
  assert.strictEqual(r.show, null);

  r = decideNag({ openQuestions: list, meId: 'dion', nowMs: T0 + HOUR + 1000, shown: r.shown });
  assert.ok(r.show);
  assert.strictEqual(r.show.title, '❓ JD is waiting on an answer');
  assert.strictEqual(r.show.body, 'JD: Question a?');

  // Same hour, next poll: quiet.
  r = decideNag({ openQuestions: list, meId: 'dion', nowMs: T0 + HOUR + 60 * 1000, shown: r.shown });
  assert.strictEqual(r.show, null);

  r = decideNag({ openQuestions: list, meId: 'dion', nowMs: T0 + 2 * HOUR + 1000, shown: r.shown });
  assert.ok(r.show);
});

test('questions I asked never nag me', () => {
  const r = decideNag({ openQuestions: [q('b', 'dion', 300)], meId: 'dion', nowMs: T0, shown: {} });
  assert.strictEqual(r.show, null);
  assert.strictEqual(r.clear, true);
});

test('several share one card, oldest quoted', () => {
  const r = decideNag({
    openQuestions: [q('a', 'jd', 120), q('c', 'jd', 90, { senderName: 'Bob' })],
    meId: 'dion',
    nowMs: T0,
    shown: {}
  });
  assert.strictEqual(r.show.title, '❓ 2 important questions waiting on you');
  assert.strictEqual(r.show.body, 'JD: Question a? (+1 more)');
  assert.deepStrictEqual(r.show.message, { id: 'a', createdAt: q('a', 'jd', 120).createdAt });
});

test('all answered clears the card', () => {
  const r = decideNag({ openQuestions: [], meId: 'dion', nowMs: T0, shown: { a: 3 } });
  assert.strictEqual(r.clear, true);
  assert.deepStrictEqual(r.shown, {});
});

test('hours waiting', () => {
  assert.strictEqual(hoursWaiting(q('a', 'jd', 0), T0 + 2.5 * HOUR), 2);
  assert.strictEqual(hoursWaiting({ createdAt: 'junk' }, T0), 0);
});
