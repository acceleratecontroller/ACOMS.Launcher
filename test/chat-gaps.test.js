'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spanWords, gapBetween, sinceLast } = require('../src/chat-gaps');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('a span is said the way a person says it, rounded down', () => {
  assert.strictEqual(spanWords(20 * MIN), '20 mins');
  assert.strictEqual(spanWords(1 * MIN + 59 * 1000), '1 min');
  assert.strictEqual(spanWords(HOUR), '1 hour');
  assert.strictEqual(spanWords(2 * HOUR + 59 * MIN), '2 hours');
  assert.strictEqual(spanWords(DAY), '1 day');
  assert.strictEqual(spanWords(4 * DAY + 5 * HOUR), '4 days');
  assert.strictEqual(spanWords(15 * DAY), '2 weeks');
  assert.strictEqual(spanWords(90 * DAY), '3 months');
  assert.strictEqual(spanWords(NaN), '');
});

test('a line between messages only for a gap of 15 minutes or more', () => {
  const t = '2026-10-07T01:00:00.000Z';
  assert.strictEqual(gapBetween(t, '2026-10-07T01:14:59.000Z'), null);
  assert.strictEqual(gapBetween(t, '2026-10-07T01:15:00.000Z'), '15 mins later');
  assert.strictEqual(gapBetween(t, '2026-10-07T03:10:00.000Z'), '2 hours later');
  assert.strictEqual(gapBetween(t, '2026-10-11T01:00:00.000Z'), '4 days later');
  assert.strictEqual(gapBetween(t, 'not a date'), null);
});

test('the newest message says how long ago it was once it is 15 minutes old', () => {
  const last = '2026-10-07T01:00:00.000Z';
  const at = Date.parse(last);
  assert.strictEqual(sinceLast(last, at + 10 * MIN), null);
  assert.strictEqual(sinceLast(last, at + 20 * MIN), 'last msg 20 mins ago');
  assert.strictEqual(sinceLast(last, at + 2 * HOUR), 'last msg 2 hours ago');
  assert.strictEqual(sinceLast(undefined, at), null);
});
