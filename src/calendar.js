'use strict';

// The Calendar window. A month at a time, read-only. It asks the main process
// for a month and keeps every month it has seen, so going back and forth is
// instant; the months either side are fetched ahead.

const R = window.calendarRules;
const api = window.acomsCalendar;

const titleEl = document.getElementById('title');
const weeksEl = document.getElementById('weeks');
const dayEl = document.getElementById('day');
const statusEl = document.getElementById('status');

const MAX_CHIPS = 3;
const pad = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let today = localYmd(new Date());
let month = today.slice(0, 7);
let picked = today;
const cache = new Map(); // ym -> Map(ymd -> items)
const loading = new Set();

function dayHeading(ymd) {
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function chip(item) {
  const el = document.createElement('span');
  el.className = `chip chip--${item.kind}`;
  el.textContent = item.kind === 'pending' ? `${item.text} (pending)` : item.text;
  return el;
}

function renderDay() {
  dayEl.textContent = '';
  const h = document.createElement('h2');
  h.textContent = dayHeading(picked);
  dayEl.appendChild(h);
  const index = cache.get(picked.slice(0, 7)) || cache.get(month);
  const items = (index && index.get(picked)) || [];
  if (items.length === 0) {
    const none = document.createElement('div');
    none.className = 'day__none';
    none.textContent = index ? 'Nothing on this day.' : 'Loading…';
    dayEl.appendChild(none);
    return;
  }
  for (const item of items) dayEl.appendChild(chip(item));
}

function render() {
  titleEl.textContent = R.monthTitle(month);
  const grid = R.monthGrid(month);
  const index = cache.get(month);
  weeksEl.textContent = '';
  for (const week of grid.weeks) {
    week.forEach((cell, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className =
        'cell' +
        (cell.inMonth ? '' : ' cell--out') +
        (i >= 5 ? ' cell--weekend' : '') +
        (cell.ymd === today ? ' cell--today' : '') +
        (cell.ymd === picked ? ' cell--picked' : '');
      const num = document.createElement('span');
      num.className = 'cell__num';
      num.textContent = String(cell.day);
      el.appendChild(num);
      const items = (index && index.get(cell.ymd)) || [];
      for (const item of items.slice(0, MAX_CHIPS)) el.appendChild(chip(item));
      if (items.length > MAX_CHIPS) {
        const more = document.createElement('span');
        more.className = 'cell__more';
        more.textContent = `+${items.length - MAX_CHIPS} more`;
        el.appendChild(more);
      }
      el.title = items.map((x) => x.text).join('\n');
      el.addEventListener('click', () => {
        picked = cell.ymd;
        render();
      });
      weeksEl.appendChild(el);
    });
  }
  statusEl.textContent = index ? '' : loading.has(month) ? 'Loading…' : statusEl.textContent;
  renderDay();
}

// Fetch one month (its six-week grid). `fresh` re-reads a month already held.
async function load(ym, { fresh = false } = {}) {
  if (loading.has(ym) || (cache.has(ym) && !fresh)) return;
  loading.add(ym);
  if (ym === month && !cache.has(ym)) statusEl.textContent = 'Loading…';
  const grid = R.monthGrid(ym);
  let result = null;
  try {
    result = await api.getRange(grid.from, grid.to);
  } catch {
    result = { ok: false, message: 'Could not load the calendar.' };
  }
  loading.delete(ym);
  if (result && result.ok) {
    cache.set(ym, R.dayIndex(result.data));
    if (ym === month) statusEl.textContent = '';
  } else if (ym === month) {
    statusEl.textContent = (result && result.message) || 'Could not load the calendar.';
  }
  if (ym === month) render();
}

function show(ym) {
  month = ym;
  render();
  load(ym);
  load(R.shiftMonth(ym, 1));
  load(R.shiftMonth(ym, -1));
}

document.getElementById('prev').addEventListener('click', () => show(R.shiftMonth(month, -1)));
document.getElementById('next').addEventListener('click', () => show(R.shiftMonth(month, 1)));
document.getElementById('today').addEventListener('click', () => {
  today = localYmd(new Date());
  picked = today;
  show(today.slice(0, 7));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') show(R.shiftMonth(month, -1));
  if (event.key === 'ArrowRight') show(R.shiftMonth(month, 1));
});

// Coming back to the window: the month on screen is read again, quietly.
window.addEventListener('focus', () => {
  today = localYmd(new Date());
  load(month, { fresh: true });
});

show(month);
