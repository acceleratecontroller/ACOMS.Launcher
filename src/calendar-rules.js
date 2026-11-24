'use strict';

// The Calendar window's rules: which days a month shows, and what is on each
// day. Pure (no Electron, no DOM), so it is tested on its own; the window
// loads the same file with a script tag.

// Wrapped so its names stay its own: the window loads this file and
// calendar.js as plain scripts, which share one scope.
(function () {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_MS = 86400000;

  const pad = (n) => String(n).padStart(2, '0');
  const ymdOf = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  const msOf = (ymd) => Date.parse(`${ymd}T00:00:00Z`);

  // "2026-11" one month on or back.
  function shiftMonth(ym, by) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }

  function monthTitle(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }

  // The six Monday-to-Sunday weeks that hold a month, with the days either side.
  // { from, to, weeks: [[{ ymd, day, inMonth }] x7] x6 }
  function monthGrid(ym) {
    const [y, m] = ym.split('-').map(Number);
    const first = Date.UTC(y, m - 1, 1);
    const dow = (new Date(first).getUTCDay() + 6) % 7; // Monday = 0
    const start = first - dow * DAY_MS;
    const weeks = [];
    for (let w = 0; w < 6; w += 1) {
      const week = [];
      for (let d = 0; d < 7; d += 1) {
        const ms = start + (w * 7 + d) * DAY_MS;
        const date = new Date(ms);
        week.push({ ymd: ymdOf(ms), day: date.getUTCDate(), inMonth: date.getUTCMonth() === m - 1 });
      }
      weeks.push(week);
    }
    return { from: weeks[0][0].ymd, to: weeks[5][6].ymd, weeks };
  }

  function eachDay(start, end, fn) {
    const a = msOf(start);
    const b = msOf(end || start);
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    for (let ms = a, n = 0; ms <= b && n < 400; ms += DAY_MS, n += 1) fn(ymdOf(ms), new Date(ms).getUTCDay());
  }

  // What is on each day: ymd -> [{ kind, text }], in a fixed order (holiday,
  // RDO, event, leave, pending leave). Leave is a name only, never a type, and
  // sits on working days: a stretch that runs over a weekend skips Sat and Sun.
  const ORDER = { holiday: 0, rdo: 1, event: 2, leave: 3, pending: 4 };

  function dayIndex(data) {
    const d = data && typeof data === 'object' ? data : {};
    const index = new Map();
    const add = (ymd, item) => {
      if (!index.has(ymd)) index.set(ymd, []);
      index.get(ymd).push(item);
    };
    for (const h of Array.isArray(d.holidays) ? d.holidays : []) add(h.date, { kind: 'holiday', text: h.name || 'Public holiday' });
    for (const r of Array.isArray(d.rdoDays) ? d.rdoDays : []) add(r, { kind: 'rdo', text: 'RDO' });
    for (const e of Array.isArray(d.events) ? d.events : []) {
      eachDay(e.date, e.endDate, (ymd) => add(ymd, { kind: 'event', text: e.name || 'Event' }));
    }
    for (const l of Array.isArray(d.leave) ? d.leave : []) {
      const text =
        (l.employeeName || 'Someone') + (l.partDay ? ` (part day${typeof l.hours === 'number' ? `, ${l.hours} h` : ''})` : '');
      eachDay(l.startDate, l.endDate, (ymd, dow) => {
        if (dow === 0 || dow === 6) return;
        add(ymd, { kind: l.pending ? 'pending' : 'leave', text });
      });
    }
    for (const items of index.values()) {
      items.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.text.localeCompare(b.text));
    }
    return index;
  }

  const api = { MONTHS, shiftMonth, monthTitle, monthGrid, dayIndex };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.calendarRules = api;
})();
