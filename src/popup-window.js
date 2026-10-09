'use strict';

// Renderer for one pop-up card (each card has its own window). Draws what it
// is given; all text goes on the page with textContent, so a message can never
// become markup.

const stackEl = document.getElementById('stack');
// Matches DRAG_THRESHOLD_PX in popup-rules.js.
const DRAG_THRESHOLD_PX = 5;

let current = null; // id of the card drawn
let press = null; // { x, y, dragging } while the button is down on the card
let swallowClick = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function point(event) {
  return { x: event.screenX, y: event.screenY };
}

function render({ card, animate }) {
  // Only a card new to the screen slides in; an update to the one already
  // here, or a fresh window taking over from an old one, must not re-animate.
  const node = el('div', `card card--${card.kind}${animate && current !== card.id ? ' card--in' : ''}`);
  node.setAttribute('role', 'button');
  current = card.id;

  const text = el('div', 'card__text');
  if (card.label) text.append(el('div', 'card__label', card.label));
  text.append(el('div', 'card__title', card.title));
  if (card.body) text.append(el('div', 'card__body', card.body));

  const close = el('button', 'card__close', '×');
  close.type = 'button';
  close.title = 'Dismiss';
  close.addEventListener('pointerdown', (event) => event.stopPropagation());
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    window.acomsPopup.dismiss(card.id);
  });

  node.append(el('div', 'card__badge', card.initial), text, close);

  // Click and hold, then move, drags the card; a press that barely moves is
  // still a click.
  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    swallowClick = false;
    press = { ...point(event), dragging: false };
    node.setPointerCapture(event.pointerId);
  });
  node.addEventListener('pointermove', (event) => {
    if (!press) return;
    const at = point(event);
    if (!press.dragging) {
      if (Math.hypot(at.x - press.x, at.y - press.y) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      node.classList.add('card--dragging');
      window.acomsPopup.dragStart(card.id, { x: press.x, y: press.y });
    }
    window.acomsPopup.dragMove(card.id, at);
  });
  const release = () => {
    if (!press) return;
    if (press.dragging) {
      swallowClick = true;
      node.classList.remove('card--dragging');
      window.acomsPopup.dragEnd(card.id);
    }
    press = null;
  };
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('lostpointercapture', release);
  node.addEventListener('click', () => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    window.acomsPopup.click(card.id);
  });

  stackEl.replaceChildren(node);
}

stackEl.addEventListener('mouseenter', () => current && window.acomsPopup.hover(current, true));
stackEl.addEventListener('mouseleave', () => current && window.acomsPopup.hover(current, false));

window.acomsPopup.onCard(render);
