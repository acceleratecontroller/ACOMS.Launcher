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
function planCards({ toDecide = [], openKeys = [], hiddenKeys = [], quiet = false }) {
  // "Later" hides a card for a while; it is still waiting, just not shown.
  const hidden = new Set(hiddenKeys);
  const wanted = toDecide.map(cardContent).filter((c) => !hidden.has(c.key));
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
function planAnswers({ answers = [], seen = {}, primed = true, quiet = false }) {
  const all = answers.map(answerContent);
  if (!primed) return { announce: [], markSeen: all.map((a) => a.seenId), baseline: true };
  const fresh = all.filter((a) => !seen[a.seenId]);
  if (quiet) return { announce: [], markSeen: [], baseline: false }; // shown when quiet hours end
  return { announce: fresh, markSeen: fresh.map((a) => a.seenId), baseline: false };
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

// At most four lines of leave in the picker (Dion 2026-11-24). Anything past
// that becomes one more line: how many other people, and when the next of
// them starts.
const MAX_UPCOMING_LINES = 4;

// "Who is on leave in the next two weeks", as the lines the picker shows:
// a name and when. Never the type of leave. Nobody off = no lines, and the
// picker then shows nothing at all for it.
function upcomingLines(upcoming) {
  const list = Array.isArray(upcoming) ? upcoming : [];
  const all = list.map((u) => ({
    name: u.employeeName || 'Someone',
    when:
      formatRange(u.startDate, u.endDate) +
      (u.partDay ? ` (part day${typeof u.hours === 'number' ? `, ${u.hours} h` : ''})` : ''),
    pending: u.pending === true,
    startDate: u.startDate
  }));
  const shown = all.slice(0, MAX_UPCOMING_LINES);
  const rest = all.slice(MAX_UPCOMING_LINES);
  let more = '';
  if (rest.length > 0) {
    // "Other people" means people not already on the four lines above; someone
    // shown who is also off again later is not another person.
    const shownNames = new Set(shown.map((l) => l.name));
    const others = new Set(rest.map((l) => l.name).filter((n) => !shownNames.has(n)));
    // "Next one" is the next of those other people, not a later stretch for
    // someone already listed.
    const nextOther = rest.find((l) => others.has(l.name));
    more =
      others.size > 0
        ? `plus ${others.size} other ${others.size === 1 ? 'person' : 'people'}, next one ${formatDay(nextOther.startDate)}`
        : `plus ${rest.length} more, next one ${formatDay(rest[0].startDate)}`;
  }
  return {
    lines: shown.map(({ name, when, pending }) => ({ name, when, pending })),
    more
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
  planCards,
  answerSeenId,
  answerContent,
  planAnswers,
  cardBounds,
  clampHeight,
  MAX_UPCOMING_LINES,
  upcomingLines
};
