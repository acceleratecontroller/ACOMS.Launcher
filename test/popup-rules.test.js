'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_CARDS,
  CARD_WIDTH,
  CARD_HEIGHT,
  WINDOW_PAD,
  SCREEN_MARGIN,
  pushCard,
  removeCard,
  slotBounds,
  dragBounds,
  onSomeScreen,
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

test('the first card hugs the bottom-right of the WORK AREA, not the screen', () => {
  // Work area excludes the taskbar — here a 48px one along the bottom.
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const b = slotBounds(workArea, 0);
  assert.strictEqual(b.x + b.width, 1920 - SCREEN_MARGIN);
  assert.strictEqual(b.y + b.height, 1032 - SCREEN_MARGIN);
  assert.strictEqual(b.width, CARD_WIDTH + WINDOW_PAD * 2);
  assert.strictEqual(b.height, CARD_HEIGHT + WINDOW_PAD * 2);
});

test('each next card sits one window higher, touching but never overlapping', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const s0 = slotBounds(workArea, 0);
  const s1 = slotBounds(workArea, 1);
  const s2 = slotBounds(workArea, 2);
  assert.strictEqual(s1.y + s1.height, s0.y);
  assert.strictEqual(s2.y + s2.height, s1.y);
  assert.strictEqual(s2.x, s0.x);
});

test('a second monitor to the left (negative origin) is handled', () => {
  const b = slotBounds({ x: -1920, y: 0, width: 1920, height: 1040 }, 1);
  assert.strictEqual(b.x + b.width, 0 - SCREEN_MARGIN);
});

// ── Dragging ───────────────────────────────────────────────────────────────

test('a dragged card follows the mouse and keeps its size', () => {
  const start = { x: 1500, y: 900, width: 384, height: 120 };
  const b = dragBounds(start, { x: 1600, y: 950 }, { x: 400, y: 120 });
  assert.deepStrictEqual(b, { x: 300, y: 70, width: 384, height: 120 });
});

test('a card let go on a screen stays; one off every screen goes home', () => {
  const screens = [
    { x: 0, y: 0, width: 1920, height: 1032 },
    { x: -1920, y: 0, width: 1920, height: 1040 }
  ];
  const w = { width: 384, height: 120 };
  assert.ok(onSomeScreen({ ...w, x: 100, y: 100 }, screens));
  assert.ok(onSomeScreen({ ...w, x: -1000, y: 500 }, screens), 'left monitor');
  assert.ok(!onSomeScreen({ ...w, x: 100, y: 1000 }, screens), 'mostly under the taskbar');
  assert.ok(!onSomeScreen({ ...w, x: 3000, y: 100 }, screens), 'a monitor since unplugged');
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
