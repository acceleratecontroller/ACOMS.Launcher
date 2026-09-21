'use strict';

// Renderer for the pop-up cards. Draws what it is given; all text goes on the
// page with textContent, so a message can never become markup.

const stackEl = document.getElementById('stack');
// Cards already drawn once — only a NEW card slides in; re-sending the list
// (one timed out, another arrived) must not re-animate the ones still there.
let known = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(cards) {
  stackEl.replaceChildren();

  for (const card of cards) {
    const node = el('div', `card card--${card.kind}${known.has(card.id) ? '' : ' card--in'}`);
    node.setAttribute('role', 'button');

    const text = el('div', 'card__text');
    if (card.label) text.append(el('div', 'card__label', card.label));
    text.append(el('div', 'card__title', card.title));
    if (card.body) text.append(el('div', 'card__body', card.body));

    const close = el('button', 'card__close', '×');
    close.type = 'button';
    close.title = 'Dismiss';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      window.acomsPopup.dismiss(card.id);
    });

    node.append(el('div', 'card__badge', card.initial), text, close);
    node.addEventListener('click', () => window.acomsPopup.click(card.id));
    stackEl.append(node);
  }

  known = new Set(cards.map((c) => c.id));
}

stackEl.addEventListener('mouseenter', () => window.acomsPopup.hover(true));
stackEl.addEventListener('mouseleave', () => window.acomsPopup.hover(false));

window.acomsPopup.onCards(render);
