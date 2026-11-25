'use strict';

// ---------------------------------------------------------------------------
// Leave cards: the rules, no Electron
// ---------------------------------------------------------------------------
// Controller's GET /api/launcher/leave says what the signed-in person should
// see: `toDecide`, the leave requests FLAGGED to them, and `answers`, the
// decisions other people made on their own requests. This file turns that
// into what goes on a card and which cards should be open. It is kept free
// of Electron so `node --test` can run it.
//
// Two rules it exists to hold (Dion 2026-11-24):
//   1. A request card stays up until it is decided. It is not a toast.
//   2. An answer is shown once. Never again after a restart, and never as a
//      flood of week-old answers the first time this version runs.

const CARD_WIDTH = 380;
const CARD_GAP = 10;
const SCREEN_MARGIN = 16;
// A card grows to fit its text and its reject box, up to this.
const CARD_MIN_HEIGHT = 150;
const CARD_MAX_HEIGHT = 420;
// More than this many open cards is a wall, not a notification.
const MAX_OPEN_CARDS = 3;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-23" -> "Mon 23 Nov". The date is a calendar day, not a moment, so
// it is read as UTC and never shifted by the computer's time zone.
function formatDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

function formatRange(start, end) {
  return !end || end === start ? formatDay(start) : `${formatDay(start)} to ${formatDay(end)}`;
}

function formatPart(hours, startTime) {
  if (hours === null || hours === undefined) return null;
  return `Part day: ${hours} h${startTime ? ` from ${startTime}` : ''}`;
}

// One request, one card. A change to approved leave is a different question
// from the original request, so it gets its own key.
function cardKey(item) {
  return `${item.id}:${item.pending || 'REQUEST'}`;
}

// The lines a request card shows. Everything here came from Controller's
// approver view: who, type, dates, part-day hours, the note written for the
// approver, who else is off. Never evidence, never a medical reason.
function cardContent(item) {
  const change = item.pending === 'CHANGE' ? item.change : null;
  const part = formatPart(item.hours, item.startTime);
  const lines = [];
  lines.push(
    formatRange(item.startDate, item.endDate) +
      (!part && typeof item.workingDays === 'number'
        ? ` · ${item.workingDays} working day${item.workingDays === 1 ? '' : 's'}`
        : '')
  );
  if (part) lines.push(part);
  if (change) {
    lines.push(
      change.cancel
        ? 'Asks to cancel this approved leave'
        : `Asks to change it to ${formatRange(change.startDate, change.endDate)}` +
            (formatPart(change.hours, change.startTime) ? ` · ${formatPart(change.hours, change.startTime)}` : '')
    );
  }
  const note = change ? change.note : item.noteToManager;
  return {
    key: cardKey(item),
    id: item.id,
    name: item.employeeName || 'Someone',
    leaveType: item.leaveType || 'Leave',
    lines,
    note: note || null,
    othersOff: Array.isArray(item.othersOff) && item.othersOff.length ? `Also off: ${item.othersOff.join(', ')}` : null,
    escalated: item.escalated === true,
    firstName: String(item.employeeName || 'They').split(' ')[0]
  };
}

// Which cards should be open, given what Controller says is waiting and what
// is on screen now. `quiet` (quiet hours) holds NEW cards back; one already
// open stays open, and one that is no longer waiting always closes.
function planCards({ toDecide = [], extra = [], openKeys = [], hiddenKeys = [], quiet = false }) {
  // "Later" hides a card for a while; it is still waiting, just not shown.
  const hidden = new Set(hiddenKeys);
  // `extra` = cards another kind of request has already built (LAFHA).
  const wanted = [...toDecide.map(cardContent), ...extra].filter((c) => !hidden.has(c.key));
  const wantedKeys = new Set(wanted.map((c) => c.key));
  const open = new Set(openKeys);
  const close = openKeys.filter((k) => !wantedKeys.has(k));
  const staying = openKeys.filter((k) => wantedKeys.has(k));
  const room = Math.max(0, MAX_OPEN_CARDS - staying.length);
  const fresh = quiet ? [] : wanted.filter((c) => !open.has(c.key)).slice(0, room);
  return {
    open: fresh,
    close,
    // Still waiting but not shown because the screen is full.
    waiting: wanted.length - staying.length - fresh.length
  };
}

const ANSWER_WORDS = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CHANGE_APPROVED: 'change approved',
  CHANGE_REJECTED: 'change rejected',
  CANCELLED: 'cancelled as you asked'
};

function answerSeenId(answer) {
  return `leave-answer:${answer.id}`;
}

// The small card the person who asked gets back.
function answerContent(answer) {
  const word = ANSWER_WORDS[answer.kind] || 'decided';
  const when = formatRange(answer.startDate, answer.endDate);
  const rejected = answer.kind === 'REJECTED' || answer.kind === 'CHANGE_REJECTED';
  return {
    seenId: answerSeenId(answer),
    label: 'Leave',
    title: `Your leave was ${word}`,
    body:
      `${answer.leaveType || 'Leave'}, ${when}${answer.by ? `, by ${answer.by}` : ''}.` +
      (answer.comment ? ` ${rejected ? 'Reason' : 'Note'}: ${answer.comment}` : ''),
    rejected
  };
}

// Which answers to show now. The very first time this ever runs, everything
// already there is recorded and nothing is shown: a new version must not
// greet someone with a week of old answers.
function planAnswers({ answers = [], seen = {}, primed = true, quiet = false, content = answerContent }) {
  const all = answers.map(content);
  if (!primed) return { announce: [], markSeen: all.map((a) => a.seenId), baseline: true };
  const fresh = all.filter((a) => !seen[a.seenId]);
  if (quiet) return { announce: [], markSeen: [], baseline: false }; // shown when quiet hours end
  return { announce: fresh, markSeen: fresh.map((a) => a.seenId), baseline: false };
}

// ── LAFHA ──────────────────────────────────────────────────────────────────
// A LAFHA request rides on the same feed and the same card window as leave.
// The approver sets the amount a night, so the card has one Approve button
// per fixed rate (Controller sends them). Anything else (other dates, fewer
// nights, another amount) is done on the LAFHA page in ACOMS.OS.

function money(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

function nightsText(n) {
  return `${n} night${n === 1 ? '' : 's'}`;
}

function lafhaCardKey(item) {
  return `lafha:${item.id}`;
}

function lafhaCardContent(item, rates = []) {
  const lines = [`${formatDay(item.leaveDate)} to ${formatDay(item.homeDate)} · ${nightsText(item.nights)}`];
  lines.push(item.job && item.job.label ? item.job.label : `No job: ${item.noJobReason || ''}`);
  if (item.place) lines.push(`Staying: ${item.place}`);
  if (item.enteredByName) lines.push(`Asked by ${item.enteredByName}`);
  // What each button comes to, on the card itself, so nobody has to work it out.
  const priced = (Array.isArray(rates) ? rates : []).filter((r) => r && typeof r.dollars === 'number');
  if (priced.length) lines.push(priced.map((r) => `${money(r.dollars)} a night = ${money(r.dollars * item.nights)}`).join(' · '));
  // What they owe from LAFHA paid for nights not stayed, which comes off this one.
  const owed = (Array.isArray(item.owes) ? item.owes : [])
    .filter((o) => o && o.method === 'NEXT_LAFHA' && typeof o.remaining === 'number')
    .reduce((sum, o) => sum + o.remaining, 0);
  return {
    key: lafhaCardKey(item),
    kind: 'lafha',
    id: item.id,
    label: 'LAFHA request',
    name: item.employeeName || 'Someone',
    leaveType: 'LAFHA',
    lines,
    note: item.note || null,
    othersOff: owed > 0 ? `Owes ${money(owed)} from earlier LAFHA. It comes off this one.` : null,
    escalated: item.escalated === true,
    firstName: String(item.employeeName || 'They').split(' ')[0],
    approve: (Array.isArray(rates) ? rates : [])
      .filter((r) => r && typeof r.kind === 'string' && typeof r.dollars === 'number')
      .map((r) => ({
        rateKind: r.kind,
        text: `Approve ${money(r.dollars)}`,
        total: `${nightsText(item.nights)} at ${money(r.dollars)} = ${money(r.dollars * item.nights)}`
      })),
    openText: 'Change the dates or the amount'
  };
}

function lafhaAnswerSeenId(answer) {
  return `lafha-answer:${answer.id}`;
}

// The small card the person the LAFHA is for gets back.
function lafhaAnswerContent(answer) {
  const r = answer.request || {};
  const when = `${formatDay(r.leaveDate)} to ${formatDay(r.homeDate)}`;
  const by = answer.by ? `, by ${answer.by}` : '';
  const rejected = answer.kind === 'REJECTED';
  const note = answer.comment ? ` ${rejected ? 'Reason' : 'Note'}: ${answer.comment}` : '';
  const total = typeof r.total === 'number' ? `, ${money(r.total)}` : '';
  let title = 'The nights on your LAFHA were changed';
  let body = `Now ${when}, ${nightsText(r.nights)}${by}.${note}`;
  if (answer.kind === 'APPROVED') {
    title = 'Your LAFHA was approved';
    body = `${when}, ${nightsText(r.nights)}${total}${by}.${note}`;
  } else if (rejected) {
    title = 'Your LAFHA was not approved';
    body = `${when}${by}.${note}`;
  } else if (answer.kind === 'PAID') {
    title = 'Your LAFHA has been paid';
    body = `${when}${typeof answer.amount === 'number' ? `: ${money(answer.amount)}` : ''}.`;
  } else if (answer.kind === 'CANCELLED') {
    title = 'Your LAFHA was cancelled';
    body = `${when}${by}.${note}`;
  }
  return { seenId: lafhaAnswerSeenId(answer), label: 'LAFHA', title, body, rejected };
}

// Request cards stack down from the top-right corner, so they never sit on
// the ordinary pop-ups, which rise from the bottom-right.
function cardBounds(workArea, heights, index) {
  let y = workArea.y + SCREEN_MARGIN;
  for (let i = 0; i < index; i++) y += heights[i] + CARD_GAP;
  return {
    x: workArea.x + workArea.width - CARD_WIDTH - SCREEN_MARGIN,
    y,
    width: CARD_WIDTH,
    height: heights[index]
  };
}

// At most four people in the picker's leave strip (Dion 2026-11-24). Anyone
// past that becomes one more line: how many other people, and when the next
// of them starts.
const MAX_UPCOMING_LINES = 4;

// Upcoming leave, for the picker. Never the type of leave.
//
//   lines  the strip: ONE line per person (Dion 2026-11-25), their next leave,
//          with `extra` = how many more stretches they have after it. Four
//          people at most.
//   more   the fifth line, when there are more people than that.
//   all    everyone and every stretch, for the list a click on the strip opens.
//
// thisYear: leave in another year carries its year ("Tue 30 Mar to Fri 16 Apr 2027").
function upcomingLines(upcoming, thisYear = new Date().getFullYear()) {
  const list = Array.isArray(upcoming) ? upcoming : [];
  const yearOf = (ymd) => (Number(String(ymd || '').slice(0, 4)) !== thisYear ? ` ${String(ymd || '').slice(0, 4)}` : '');

  // People in the order of when they are next off (the list comes soonest first).
  const people = new Map();
  for (const u of list) {
    const name = u.employeeName || 'Someone';
    if (!people.has(name)) people.set(name, { name, items: [] });
    people.get(name).items.push({
      when:
        formatRange(u.startDate, u.endDate) +
        yearOf(u.endDate || u.startDate) +
        (u.partDay ? ` (part day${typeof u.hours === 'number' ? `, ${u.hours} h` : ''})` : ''),
      pending: u.pending === true,
      startDate: u.startDate
    });
  }
  const everyone = [...people.values()];
  const shown = everyone.slice(0, MAX_UPCOMING_LINES);
  const rest = everyone.slice(MAX_UPCOMING_LINES);
  const next = rest.length > 0 ? rest[0].items[0].startDate : null;
  return {
    lines: shown.map((p) => ({
      name: p.name,
      when: p.items[0].when,
      pending: p.items[0].pending,
      extra: p.items.length - 1
    })),
    more:
      rest.length > 0
        ? `plus ${rest.length} other ${rest.length === 1 ? 'person' : 'people'}, next one ${formatDay(next)}${yearOf(next)}`
        : '',
    all: everyone.map((p) => ({
      name: p.name,
      items: p.items.map(({ when, pending }) => ({ when, pending }))
    }))
  };
}

// The two dates beside the picker's cog: the next RDO, and the next public
// holiday when Controller sends one (it only does within a month). Short
// text; null for what there is nothing to say about.
function keyDates(dates, thisYear = new Date().getFullYear()) {
  const d = dates && typeof dates === 'object' ? dates : {};
  const yearOf = (ymd) => (Number(String(ymd).slice(0, 4)) !== thisYear ? ` ${String(ymd).slice(0, 4)}` : '');
  const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const h = d.nextHoliday && typeof d.nextHoliday === 'object' && isDay(d.nextHoliday.date) ? d.nextHoliday : null;
  return {
    rdo: isDay(d.nextRdo) ? formatDay(d.nextRdo) + yearOf(d.nextRdo) : null,
    holiday: h ? { name: String(h.name || 'Public holiday'), when: formatDay(h.date) + yearOf(h.date) } : null
  };
}

function clampHeight(h) {
  const n = Math.round(Number(h) || 0);
  return Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, n));
}

module.exports = {
  CARD_WIDTH,
  CARD_MIN_HEIGHT,
  CARD_MAX_HEIGHT,
  MAX_OPEN_CARDS,
  formatDay,
  formatRange,
  formatPart,
  cardKey,
  cardContent,
  lafhaCardContent,
  lafhaAnswerContent,
  planCards,
  answerSeenId,
  answerContent,
  planAnswers,
  cardBounds,
  clampHeight,
  MAX_UPCOMING_LINES,
  keyDates,
  upcomingLines
};
