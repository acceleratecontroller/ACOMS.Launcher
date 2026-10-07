'use strict';

// Pure: read a due date, a time, a job number and a category out of a task
// typed in chat, so task mode can fill its fields in. Loaded by chat.html as a
// plain script (window.acomsChatTaskParse) and by the tests through require.
//
// Dion, 2026-10-07: "if a date or category or Accelerate number is added
// ensure it picks those up correctly. so if i said i need this done by next
// thursday or by 2pm 8/10 etc it can create the task correctly ... i want it
// to be pretty good". What it finds only FILLS the fields — the date picker is
// still there and still required, so a wrong guess is seen and fixed before
// the task goes.
//
// Conventions (Australian):
//   8/10, 8/10/26, 8.10.2026  day/month[/year]. No year = this year, or next
//                             year if that date has already gone.
//   8 oct, 8th October, oct 8 likewise.
//   thursday, this thursday   the next Thursday after today (today excluded).
//   next thursday             Thursday of NEXT week (weeks start Monday).
//   next week                 Monday of next week.
//   end of week / eow         this Friday.
//   end of month / eom        the last day of this month.
//   today, tonight, eod, cob, end of day   today.
//   tomorrow, tmrw, tmr       tomorrow.   day after tomorrow  +2.
//   in 3 days, in 2 weeks, in a week, in a fortnight.
//   2pm, 2:30pm, 2.30 pm, 14:00, noon, midday   the time.

(function (root) {
  const WEEKDAYS = [
    ['sunday'],
    ['monday', 'mon'],
    ['tuesday', 'tue', 'tues'],
    ['wednesday', 'wed', 'weds'],
    ['thursday', 'thu', 'thur', 'thurs'],
    ['friday', 'fri'],
    ['saturday']
  ];
  const MONTHS = [
    ['january', 'jan'],
    ['february', 'feb'],
    ['march', 'mar'],
    ['april', 'apr'],
    ['may'],
    ['june', 'jun'],
    ['july', 'jul'],
    ['august', 'aug'],
    ['september', 'sep', 'sept'],
    ['october', 'oct'],
    ['november', 'nov'],
    ['december', 'dec']
  ];
  const WD = WEEKDAYS.flat().sort((a, b) => b.length - a.length).join('|');
  const MO = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');

  function weekdayIndex(word) {
    return WEEKDAYS.findIndex((names) => names.includes(word));
  }
  function monthIndex(word) {
    return MONTHS.findIndex((names) => names.includes(word));
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function iso(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  // A real calendar date, or null (31/2 is not a date).
  function makeDate(year, month, day) {
    const d = new Date(year, month, day);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null;
  }
  // A day and month with no year: this year unless that has already gone.
  function nextDayMonth(today, month, day, year) {
    if (year !== undefined) return makeDate(year, month, day);
    const thisYear = makeDate(today.getFullYear(), month, day);
    if (thisYear && thisYear >= today) return thisYear;
    return makeDate(today.getFullYear() + 1, month, day);
  }
  function fullYear(raw) {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return raw.length <= 2 ? 2000 + n : n;
  }
  function mondayOf(d) {
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function findDate(text, today) {
    let m;

    // Explicit numbers first: they are the least ambiguous thing anyone types.
    // Not inside a longer number or an A-number, and not a time (2.30pm).
    m = /(?:^|[^\w/.:])(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?![\w/.:]|\s*[ap]\.?m\b)/.exec(text);
    if (m) {
      const d = nextDayMonth(today, Number(m[2]) - 1, Number(m[1]), fullYear(m[3]));
      if (d) return d;
    }

    m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MO})\\b\\.?(?:\\s+(\\d{4}))?`).exec(text);
    if (m) {
      const d = nextDayMonth(today, monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined);
      if (d) return d;
    }
    m = new RegExp(`\\b(${MO})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(text);
    if (m) {
      const d = nextDayMonth(today, monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
      if (d) return d;
    }

    if (/\bday after tomorrow\b/.test(text)) return addDays(today, 2);
    if (/\b(tomorrow|tmrw|tmr|tomoz)\b/.test(text)) return addDays(today, 1);
    if (/\b(today|tonight|eod|cob|end of (the )?day|close of business)\b/.test(text)) return today;

    m = new RegExp(`\\bnext\\s+(${WD})\\b`).exec(text);
    if (m) return addDays(mondayOf(today), 7 + ((weekdayIndex(m[1]) + 6) % 7));

    m = new RegExp(`\\b(${WD})\\b`).exec(text);
    if (m) {
      const ahead = (weekdayIndex(m[1]) - today.getDay() + 7) % 7 || 7;
      return addDays(today, ahead);
    }

    if (/\b(end of (the )?week|eow)\b/.test(text)) {
      const ahead = (5 - today.getDay() + 7) % 7;
      return addDays(today, today.getDay() === 6 ? 6 : ahead);
    }
    if (/\b(end of (the )?month|eom)\b/.test(text)) {
      return new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }
    if (/\bnext week\b/.test(text)) return addDays(mondayOf(today), 7);

    m = /\bin\s+(a|an|one|two|three|four|five|six|seven|\d{1,2})\s+(day|days|week|weeks|fortnight|fortnights)\b/.exec(text);
    if (m) {
      const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
      const n = words[m[1]] || Number(m[1]);
      const unit = m[2].startsWith('fortnight') ? 14 : m[2].startsWith('week') ? 7 : 1;
      return addDays(today, n * unit);
    }
    return null;
  }

  function hhmm(h, min) {
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  function findTime(text) {
    let m = /\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?(?![a-z])/.exec(text);
    if (m) {
      let h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      if (h >= 1 && h <= 12 && min < 60) {
        if (m[3] === 'p' && h !== 12) h += 12;
        if (m[3] === 'a' && h === 12) h = 0;
        return hhmm(h, min);
      }
    }
    if (/\b(noon|midday|lunchtime)\b/.test(text)) return '12:00';
    m = /(?:^|[^\d/.:])([01]?\d|2[0-3]):([0-5]\d)(?![\d/])/.exec(text);
    if (m) return hhmm(Number(m[1]), Number(m[2]));
    return null;
  }

  function findJob(text) {
    const m = /\bA(\d{3,5})([A-Z]?)\b/i.exec(text);
    return m ? `A${m[1]}${m[2].toUpperCase()}` : null;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // A category the Task Manager already uses, named in the message — the
  // longest one that appears as a whole word. "Task" is the default anyway.
  function findLabel(text, labels) {
    const candidates = (labels || [])
      .filter((l) => typeof l === 'string' && l.trim() && l.trim().toLowerCase() !== 'task')
      .sort((a, b) => b.length - a.length);
    for (const label of candidates) {
      const re = new RegExp(`(^|[^\\w])#?${escapeRe(label.trim().toLowerCase())}(?![\\w])`);
      if (re.test(text)) return label.trim();
    }
    return null;
  }

  // { dueDate: 'YYYY-MM-DD'|null, dueTime: 'HH:MM'|null, job, label }.
  function parseTask(raw, now = new Date(), labels = []) {
    const original = String(raw || '');
    const text = original.toLowerCase();
    const today = startOfDay(now);
    // Job numbers are read from the original (case kept) and blanked before
    // dates are looked for, so A1016 never reads as a date or a time.
    const job = findJob(original);
    const scrubbed = text.replace(/\ba\d{3,5}[a-z]?\b/g, ' ');
    const date = findDate(scrubbed, today);
    return {
      dueDate: date ? iso(date) : null,
      dueTime: findTime(scrubbed),
      job,
      label: findLabel(text, labels)
    };
  }

  // "Thu 8 Oct" — how the chosen date is read back beside the picker, so
  // "next thursday" resolving to the 15th is seen, not assumed.
  function dayWords(isoDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDay || ''));
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return `${WEEKDAYS[d.getDay()][0].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${d.getDate()} ${MONTHS[d.getMonth()][0].slice(0, 3).replace(/^./, (c) => c.toUpperCase())}`;
  }

  // "2:00 pm" for "14:00".
  function timeWords(hm) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hm || ''));
    if (!m) return '';
    const h = Number(m[1]);
    return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
  }

  const api = { parseTask, dayWords, timeWords, isoDay: iso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatTaskParse = api;
})(typeof window !== 'undefined' ? window : this);
