'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_CARDS,
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_GAP,
  WINDOW_PAD,
  SCREEN_MARGIN,
  pushCard,
  removeCard,
  boundsFor,
  initialOf
} = require('../src/popup-rules');

const card = (id, over = {}) => ({ id, title: id, body: '', sticky: false, ...over });
const ids = (cards) => cards.map((c) => c.id);

// ── The stack ──────────────────────────────────────────────────────────────

test('newest card goes last, which is drawn nearest the corner', () => {
  assert.deepStrictEqual(ids(pushCard([card('a')], card('b'))), ['a', 'b']);
});

test('re-showing a card replaces it rather than doubling it', () => {
  const next = pushCard([card('a'), card('b')], card('a', { body: 'updated' }));
  assert.deepStrictEqual(ids(next), ['b', 'a']);
  assert.strictEqual(next[1].body, 'updated');
});

test('over the limit, the oldest ordinary card goes', () => {
  let cards = [];
  for (let i = 0; i < MAX_CARDS + 1; i += 1) cards = pushCard(cards, card(`c${i}`));
  assert.strictEqual(cards.length, MAX_CARDS);
  assert.ok(!ids(cards).includes('c0'));
});

test('a sticky card outlives ordinary ones when the stack is full', () => {
  // The reminder is the card someone was MEANT to deal with; a burst of chat
  // must not be what pushes it off the screen.
  let cards = [card('reminder', { sticky: true })];
  for (let i = 0; i < MAX_CARDS + 2; i += 1) cards = pushCard(cards, card(`c${i}`));
  assert.ok(ids(cards).includes('reminder'));
  assert.strictEqual(cards.length, MAX_CARDS);
});

test('a stack of nothing but sticky cards still respects the limit', () => {
  let cards = [];
  for (let i = 0; i < MAX_CARDS + 1; i += 1) cards = pushCard(cards, card(`s${i}`, { sticky: true }));
  assert.strictEqual(cards.length, MAX_CARDS);
  assert.ok(ids(cards).includes(`s${MAX_CARDS}`), 'the card just shown is never the one dropped');
});

test('removing a card that is not there changes nothing', () => {
  assert.deepStrictEqual(ids(removeCard([card('a')], 'zzz')), ['a']);
  assert.deepStrictEqual(removeCard([card('a')], 'a'), []);
});

// ── Where it sits ──────────────────────────────────────────────────────────

test('the window hugs the bottom-right of the WORK AREA, not the screen', () => {
  // Work area excludes the taskbar — here a 48px one along the bottom.
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const b = boundsFor(workArea, 1);
  assert.strictEqual(b.x + b.width, 1920 - SCREEN_MARGIN);
  assert.strictEqual(b.y + b.height, 1032 - SCREEN_MARGIN);
  assert.strictEqual(b.width, CARD_WIDTH + WINDOW_PAD * 2);
});

test('it grows upward by one card and one gap at a time', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const one = boundsFor(workArea, 1);
  const three = boundsFor(workArea, 3);
  assert.strictEqual(three.height - one.height, 2 * (CARD_HEIGHT + CARD_GAP));
  assert.strictEqual(three.y + three.height, one.y + one.height, 'bottom edge stays put');
});

test('a second monitor to the left (negative origin) is handled', () => {
  const b = boundsFor({ x: -1920, y: 0, width: 1920, height: 1040 }, 2);
  assert.strictEqual(b.x + b.width, 0 - SCREEN_MARGIN);
});

// ── The badge ──────────────────────────────────────────────────────────────

test('the badge is the first letter, upper-cased', () => {
  assert.strictEqual(initialOf('jordan'), 'J');
  assert.strictEqual(initialOf('  Émile'), 'É');
  assert.strictEqual(initialOf('ACOMS.Controller'), 'A');
});

test('no usable name gives a neutral dot, not a stray symbol', () => {
  assert.strictEqual(initialOf(''), '•');
  assert.strictEqual(initialOf(null), '•');
  assert.strictEqual(initialOf('— —'), '•');
});
