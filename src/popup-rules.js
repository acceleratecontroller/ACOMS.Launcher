'use strict';

// ---------------------------------------------------------------------------
// Pop-up rules
// ---------------------------------------------------------------------------
// The launcher draws its own pop-up cards instead of handing notifications to
// the operating system (see popup.js for why). These are the decisions that
// involves, kept free of Electron so they can be unit-tested: which cards are
// on screen, how long for, and where the window holding them sits.

const MAX_CARDS = 4;
const CARD_WIDTH = 360;
const CARD_HEIGHT = 96;
const CARD_GAP = 10;
// Room around the stack inside the (transparent) window for the cards' shadow.
const WINDOW_PAD = 14;
// Distance kept from the corner of the screen's work area.
const SCREEN_MARGIN = 6;

// Long enough to read two lines without hurrying; short enough that a quiet
// afternoon's messages don't pile up over what you're working on.
const DURATION_MS = 9 * 1000;
// After the mouse leaves a stack it was resting on, cards don't vanish at once.
const AFTER_HOVER_MS = 4 * 1000;

// Add a card to the stack, newest last (drawn at the bottom, nearest the
// corner). Over the limit, the oldest card that would have timed out anyway is
// the one to go — a sticky card is something the person was meant to deal with,
// so it is only dropped when there is nothing else left to drop.
function pushCard(cards, card, max = MAX_CARDS) {
  const next = [...cards.filter((c) => c.id !== card.id), card];
  while (next.length > max) {
    const victim = next.findIndex((c) => !c.sticky && c.id !== card.id);
    next.splice(victim === -1 ? 0 : victim, 1);
  }
  return next;
}

function removeCard(cards, id) {
  return cards.filter((c) => c.id !== id);
}

// Where the pop-up window goes: bottom-right of the work area (so above the
// taskbar, wherever the taskbar is), sized to exactly hold `count` cards.
function boundsFor(workArea, count) {
  const n = Math.max(1, count);
  const width = CARD_WIDTH + WINDOW_PAD * 2;
  const height = n * CARD_HEIGHT + (n - 1) * CARD_GAP + WINDOW_PAD * 2;
  return {
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - SCREEN_MARGIN),
    y: Math.round(workArea.y + workArea.height - height - SCREEN_MARGIN)
  };
}

// The letter in the round badge on a card. People get their initial; anything
// without a usable name gets a neutral dot rather than a stray symbol.
function initialOf(name) {
  const m = String(name || '').match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '•';
}

module.exports = {
  MAX_CARDS,
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_GAP,
  WINDOW_PAD,
  SCREEN_MARGIN,
  DURATION_MS,
  AFTER_HOVER_MS,
  pushCard,
  removeCard,
  boundsFor,
  initialOf
};
