'use strict';

// ---------------------------------------------------------------------------
// The task reminder itself
// ---------------------------------------------------------------------------
// Twenty overdue tasks must never be twenty notifications. One goes up, it
// names the worst few, it counts the rest, and clicking it lands in the Task
// Manager where the whole list already lives.
//
// Two things are deliberate:
//
//   ONE TOAST, NOT A BURST. A pile of separate toasts is how a person learns
//   to dismiss the whole app without reading it.
//
//   IT STAYS UNTIL IT IS DEALT WITH. A normal Windows toast shows for a few
//   seconds and files itself away, which is fine for "a job request arrived"
//   and useless for "you are behind". Windows has a `reminder` scenario for
//   exactly this — it stays on screen until the person acts — and Electron
//   exposes it through raw toast XML. See buildToastXml.

/** Most tasks named in the body. Windows gives about three lines. */
const MAX_NAMED = 3;

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function startOfLocalDay(now) {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Split task items into overdue and due-today.
 *
 * Uses the item's own `at` (the due date the portal sent) rather than sniffing
 * its subtitle text — the wording is for humans and is free to change.
 * An item with no date is treated as due today rather than overdue: it is
 * waiting on you, but claiming it is late would be inventing a fact.
 */
function splitByDueness(items, now) {
  const dayStart = startOfLocalDay(now).getTime();
  const overdue = [];
  const dueToday = [];

  for (const item of items) {
    const at = item && item.at ? Date.parse(item.at) : NaN;
    if (Number.isFinite(at) && at < dayStart) overdue.push(item);
    else dueToday.push(item);
  }

  // Worst first, undated last.
  overdue.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { overdue, dueToday };
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build the reminder, or null when there is nothing to say.
 *
 * @param {object} args
 * @param {Array} args.items    the portal's task-ish action items
 * @param {number|null} args.trueCount  the portal's real task count when it
 *   reports one. `items` is capped for payload size, so counting the array
 *   would quietly under-report anyone with a long list — the exact class of
 *   bug that put a wrong number on the badge in the first place. When no true
 *   count is available and the list looks capped, the text says "at least".
 * @param {Date} args.now
 */
function buildTaskReminder({ items = [], trueCount = null, capped = false, now = new Date() }) {
  const tasks = items.filter((i) => i && i.severity === 'action' && i.kind === 'task');
  if (tasks.length === 0) return null;

  const { overdue, dueToday } = splitByDueness(tasks, now);
  const shown = tasks.length;
  const total = Number.isFinite(trueCount) && trueCount > 0 ? trueCount : shown;
  const approx = !Number.isFinite(trueCount) && capped;

  let title;
  if (total > shown) {
    // The portal says there are more than it sent. We cannot split a number we
    // cannot see into overdue and due-today without inventing the breakdown,
    // so the headline states the total and stops there. Saying "10 tasks
    // overdue" when 13 are waiting is the same bug as counting the visible
    // list — a confident number that happens to be wrong.
    title = plural(total, 'task needs attention', 'tasks need attention');
  } else {
    const headlineParts = [];
    if (overdue.length) headlineParts.push(plural(overdue.length, 'task overdue', 'tasks overdue'));
    if (dueToday.length) headlineParts.push(`${dueToday.length} due today`);
    title = headlineParts.join(', ');
    // Capped with no true count: we know there are at least this many.
    if (approx) title = `At least ${title}`;
  }

  // Name the worst few — overdue first, since those are the ones being nagged
  // about — then count whatever is left.
  const named = [...overdue, ...dueToday].slice(0, MAX_NAMED);
  const lines = named.map((t) => t.title).filter(Boolean);
  const remaining = total - named.length;
  if (remaining > 0) lines.push(`…and ${remaining} more`);

  return {
    title,
    body: lines.join('\n'),
    total,
    overdue: overdue.length,
    dueToday: dueToday.length,
    approx
  };
}

/**
 * Windows toast XML for a reminder that does not go away on its own.
 *
 * `scenario="reminder"` is what makes it stay on screen until the person acts
 * — the same class Windows uses for calendar alerts. Electron's plain
 * Notification cannot do this: its longest timeout is about 25 seconds, after
 * which the toast files itself into the Action Centre and stops being an
 * interruption. That is fine for "a job request arrived" and useless for
 * "you are behind on six things".
 *
 * `launch` + `activationType="foreground"` mean clicking the toast body
 * activates the app, which is what the existing click handler hangs off.
 */
function buildToastXml({ title, body, buttonText = 'Open Task Manager' }) {
  const lines = String(body || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => `      <text>${escapeXml(line)}</text>`)
    .join('\n');

  return [
    '<toast scenario="reminder" activationType="foreground" launch="tasks">',
    '  <visual>',
    '    <binding template="ToastGeneric">',
    `      <text>${escapeXml(title)}</text>`,
    lines,
    '    </binding>',
    '  </visual>',
    '  <actions>',
    `    <action content="${escapeXml(buttonText)}" activationType="foreground" arguments="tasks"/>`,
    '    <action content="Dismiss" activationType="system" arguments="dismiss"/>',
    '  </actions>',
    '</toast>'
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = { buildTaskReminder, buildToastXml, splitByDueness, MAX_NAMED };
