'use strict';

// ---------------------------------------------------------------------------
// Pop-up rules
// ---------------------------------------------------------------------------
// The launcher draws its own pop-up cards instead of handing notifications to
// the operating system (see popup.js for why). These are the decisions that
// involves, kept free of Electron so they can be unit-tested: which cards are
// on screen, how long for, and where each card's window sits.
//
// Every card has a window of its own (so one can be dragged away on its own).
// The windows abut; the visible gap between two cards is their padding.

const MAX_CARDS = 4;
const CARD_WIDTH = 360;
const CARD_HEIGHT = 96;
// Room around the card inside its (transparent) window for the card's shadow.
// Two neighbouring windows' padding makes the gap between cards. Windows must
// not overlap: a transparent window still takes the clicks over its padding.
const WINDOW_PAD = 12;
// Distance kept from the corner of the screen's work area.
const SCREEN_MARGIN = 6;

// Long enough to read two lines without hurrying; short enough that a quiet
// afternoon's messages don't pile up over what you're working on.
const DURATION_MS = 9 * 1000;
// After the mouse leaves a stack it was resting on, cards don't vanish at once.
const AFTER_HOVER_MS = 4 * 1000;
// A card's window older than this is quietly swapped for a fresh one (see
// popup.js: a long-lived pop-up window on Windows can stop taking clicks).
const REFRESH_MS = 5 * 60 * 1000;
// How far the mouse must travel with the button down before a press on a card
// is a drag rather than a click.
const DRAG_THRESHOLD_PX = 5;

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

// Where a docked card's window goes: bottom-right of the work area (so above the
// taskbar, wherever the taskbar is). Slot 0 is nearest the corner; each next
// slot sits one window higher.
function slotBounds(workArea, slot) {
  const width = CARD_WIDTH + WINDOW_PAD * 2;
  const height = CARD_HEIGHT + WINDOW_PAD * 2;
  return {
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - SCREEN_MARGIN),
    y: Math.round(workArea.y + workArea.height - height * (Math.max(0, slot) + 1) - SCREEN_MARGIN)
  };
}

// Where a dragged window goes: where it started, moved by however far the
// mouse has moved since the press. Size never changes, even crossing onto a
// monitor with different scaling.
function dragBounds(start, pressAt, mouseAt) {
  return {
    width: start.width,
    height: start.height,
    x: Math.round(start.x + mouseAt.x - pressAt.x),
    y: Math.round(start.y + mouseAt.y - pressAt.y)
  };
}

// Is a moved card still somewhere it can be seen and reached? Its centre must
// be on one of the screens' work areas — a monitor unplugged, or a card let go
// half under the taskbar, sends it back to the corner.
function onSomeScreen(bounds, workAreas) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return workAreas.some(
    (a) => cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height
  );
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
  WINDOW_PAD,
  SCREEN_MARGIN,
  DURATION_MS,
  AFTER_HOVER_MS,
  REFRESH_MS,
  DRAG_THRESHOLD_PX,
  pushCard,
  removeCard,
  slotBounds,
  dragBounds,
  onSomeScreen,
  initialOf
};
