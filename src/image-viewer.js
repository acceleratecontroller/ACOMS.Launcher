'use strict';

// Renderer for the picture viewer window (Dion, 2026-09-25: clicking a picture
// in a small chat window gave a small picture — "it'd be good if when you
// clicked on it it went bigger than chat"). The window itself is sized by the
// main process; this page shows one picture and lets you look at it:
//
//   - opens fitted to the window (never enlarged past actual size);
//   - click zooms in around where you clicked (to actual size, or to double
//     when it already shows at actual size), and a second click fits again;
//   - mouse wheel zooms around the pointer; drag pans once it is bigger than
//     the window;
//   - Esc closes, 0 fits, 1 actual size, + and - zoom (buttons too).
//
// Dion, 2026-10-14: on a big screen a snip already showed at actual size, so
// clicking it went "back to fit" — nothing happened, and it looked like the
// picture couldn't be zoomed. A click now always zooms in.

const stageEl = document.getElementById('stage');
const imgEl = document.getElementById('img');
const nameEl = document.getElementById('name');
const zoomEl = document.getElementById('zoom');
const statusEl = document.getElementById('status');

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const WHEEL_STEP = 1.15;

let file = null;
let scale = 1;
let fitted = true; // follow the window size until the person zooms

function naturalSize() {
  return { w: imgEl.naturalWidth || 1, h: imgEl.naturalHeight || 1 };
}

function fitScale() {
  const { w, h } = naturalSize();
  const pad = 24;
  const sx = (stageEl.clientWidth - pad) / w;
  const sy = (stageEl.clientHeight - pad) / h;
  return Math.max(MIN_SCALE, Math.min(1, sx, sy));
}

// Set the zoom, keeping the picture point under (x, y) — stage coordinates —
// where it was. With no point, keep the middle of the view.
function setScale(next, x, y) {
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  const px = x ?? stageEl.clientWidth / 2;
  const py = y ?? stageEl.clientHeight / 2;
  const imgX = (stageEl.scrollLeft + px - imgEl.offsetLeft) / scale;
  const imgY = (stageEl.scrollTop + py - imgEl.offsetTop) / scale;

  scale = clamped;
  const { w, h } = naturalSize();
  imgEl.style.width = `${Math.round(w * scale)}px`;
  imgEl.style.height = `${Math.round(h * scale)}px`;

  stageEl.scrollLeft = imgX * scale + imgEl.offsetLeft - px;
  stageEl.scrollTop = imgY * scale + imgEl.offsetTop - py;

  const zoomed = imgEl.offsetWidth > stageEl.clientWidth || imgEl.offsetHeight > stageEl.clientHeight;
  stageEl.classList.toggle('stage--zoomed', zoomed);
  zoomEl.textContent = `${Math.round(scale * 100)}%`;
}

function fit() {
  fitted = true;
  setScale(fitScale());
}

function actual(x, y) {
  fitted = false;
  setScale(1, x, y);
}

// What a click on a fitted picture zooms to: actual size when the window
// shrank it, double when it already shows at actual size.
function zoomIn(x, y) {
  fitted = false;
  setScale(fitScale() < 1 ? 1 : 2, x, y);
}

function step(factor) {
  if (imgEl.hidden) return;
  fitted = false;
  setScale(scale * factor);
}

function stagePoint(event) {
  const r = stageEl.getBoundingClientRect();
  return { x: event.clientX - r.left, y: event.clientY - r.top };
}

// ── Showing a picture ──────────────────────────────────────────────────────

function show(next) {
  file = next;
  nameEl.textContent = next.name;
  document.title = next.name;
  statusEl.hidden = false;
  statusEl.className = 'status';
  statusEl.textContent = 'Loading…';
  imgEl.hidden = true;
  imgEl.alt = next.name;
  const src = `acoms-file://attachment/${encodeURIComponent(next.id)}`;
  // The window is reused: the same picture again fires no 'load', so show it
  // from here rather than leave it on "Loading…".
  if (imgEl.getAttribute('src') === src && imgEl.complete && imgEl.naturalWidth > 0) shown();
  else imgEl.src = src;
}

function shown() {
  statusEl.hidden = true;
  imgEl.hidden = false;
  stageEl.scrollLeft = 0;
  stageEl.scrollTop = 0;
  fit();
}

imgEl.addEventListener('load', shown);

imgEl.addEventListener('error', () => {
  imgEl.hidden = true;
  statusEl.hidden = false;
  statusEl.className = 'status status--error';
  statusEl.textContent = 'This picture couldn’t be loaded.';
});

window.addEventListener('resize', () => {
  if (fitted && !imgEl.hidden) fit();
});

// ── Mouse ──────────────────────────────────────────────────────────────────

stageEl.addEventListener(
  'wheel',
  (event) => {
    if (imgEl.hidden) return;
    event.preventDefault();
    const { x, y } = stagePoint(event);
    fitted = false;
    setScale(scale * (event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP), x, y);
  },
  { passive: false }
);

// A press either becomes a drag (pan) or, if the mouse barely moved, a click
// (toggle fit / actual size).
let press = null;

stageEl.addEventListener('mousedown', (event) => {
  if (event.button !== 0 || imgEl.hidden) return;
  press = {
    x: event.clientX,
    y: event.clientY,
    left: stageEl.scrollLeft,
    top: stageEl.scrollTop,
    moved: false
  };
});

window.addEventListener('mousemove', (event) => {
  if (!press) return;
  const dx = event.clientX - press.x;
  const dy = event.clientY - press.y;
  if (!press.moved && Math.hypot(dx, dy) < 4) return;
  press.moved = true;
  stageEl.classList.add('stage--dragging');
  stageEl.scrollLeft = press.left - dx;
  stageEl.scrollTop = press.top - dy;
});

window.addEventListener('mouseup', (event) => {
  if (!press) return;
  const wasClick = !press.moved;
  press = null;
  stageEl.classList.remove('stage--dragging');
  if (!wasClick || !stageEl.contains(event.target)) return;

  const { x, y } = stagePoint(event);
  // Zoomed: back to fitted. Fitted: zoom in around the click.
  if (fitted) zoomIn(x, y);
  else fit();
});

// ── Keys and buttons ───────────────────────────────────────────────────────

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.acomsViewer.close();
  else if (event.key === '0') fit();
  else if (event.key === '1') actual();
  else if (event.key === '+' || event.key === '=') step(WHEEL_STEP * WHEEL_STEP);
  else if (event.key === '-') step(1 / (WHEEL_STEP * WHEEL_STEP));
});

document.getElementById('zoom-out').addEventListener('click', () => step(1 / (WHEEL_STEP * WHEEL_STEP)));
document.getElementById('zoom-in').addEventListener('click', () => step(WHEEL_STEP * WHEEL_STEP));
document.getElementById('fit').addEventListener('click', fit);
document.getElementById('actual').addEventListener('click', () => actual());
document.getElementById('close').addEventListener('click', () => window.acomsViewer.close());
document.getElementById('open').addEventListener('click', () => file && window.acomsViewer.open(file));
document.getElementById('save').addEventListener('click', () => file && window.acomsViewer.save(file));

window.acomsViewer.onShow(show);
