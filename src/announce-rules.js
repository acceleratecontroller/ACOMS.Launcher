'use strict';

// ---------------------------------------------------------------------------
// What is actually worth a pop-up
// ---------------------------------------------------------------------------
// Deciding what to announce is the whole product. Get it wrong in the noisy
// direction and the person turns notifications off, at which point every
// portal's badge stops being read too.
//
// Kept free of Electron on purpose — same reason as quiet-hours.js — so the
// rules can be unit-tested rather than reasoned about.
//
// Two rules live here, both learned the hard way from the first version:
//
//   1. THE FIRST POLL ANNOUNCES NOTHING. On a fresh install every open item
//      is "new", so the first version greeted Dion with "19 things need you"
//      — nineteen things, most of them weeks old, none of them news. The
//      first successful poll of a portal establishes a BASELINE: everything
//      present is recorded as seen, silently. You are told about what happens
//      next, not about the backlog you already knew you had.
//
//   2. A THING THAT IS STILL OPEN IS NOT NEW AGAIN. Seen ids were pruned
//      after 30 days on the reasoning that anything that old "is either
//      resolved or so stale that re-announcing it is the right call". It
//      isn't: a task overdue since July is not news in September, it is the
//      same task. Every poll now refreshes the timestamp of ids still present,
//      so the TTL only ever expires things that genuinely went away.

/**
 * Decide what to announce, and how the seen-set should be updated.
 *
 * Pure: give it the current state and it tells you what to do. It does not
 * write anything.
 *
 * @param {object} args
 * @param {string[]} args.actionIds  ids of every current "action" item
 * @param {object} args.seen         { id: epochMs } already announced
 * @param {boolean} args.primed      has this portal ever polled successfully?
 * @param {boolean} args.quiet       is it quiet hours right now?
 * @param {number} args.now          epoch ms
 * @returns {{announce: string[], markSeen: string[], touch: string[], baseline: boolean}}
 *   announce  — ids to raise a pop-up for (empty during quiet hours)
 *   markSeen  — ids to record as seen (superset of announce)
 *   touch     — ids already seen and still present, whose timestamp to refresh
 *   baseline  — true when this call established the first-poll baseline
 */
function decideAnnouncements({ actionIds, seen, primed, quiet, now }) {
  const ids = Array.isArray(actionIds) ? actionIds.filter((id) => typeof id === 'string' && id) : [];
  const seenMap = seen && typeof seen === 'object' ? seen : {};

  const fresh = ids.filter((id) => !(id in seenMap));
  // Still open, already known. Refreshed so it never ages out and comes back
  // around as though it were new.
  const touch = ids.filter((id) => id in seenMap);

  // First successful poll: record the world as it stands, say nothing.
  if (!primed) {
    return { announce: [], markSeen: ids, touch: [], baseline: true };
  }

  // Quiet hours: the person is choosing not to be told NOW, not asking to be
  // told at 7am about everything that happened overnight. Mark seen anyway;
  // the badge still carries the count.
  if (quiet) {
    return { announce: [], markSeen: fresh, touch, baseline: false };
  }

  return { announce: fresh, markSeen: fresh, touch, baseline: false };
}

/**
 * Which seen ids may be forgotten.
 *
 * An id is only ever dropped once it has been ABSENT long enough — the
 * timestamp is refreshed while the item is still being returned, so age here
 * means "gone this long", not "known this long".
 */
function expiredSeenIds(seen, now, ttlMs) {
  const out = [];
  const cutoff = now - ttlMs;
  for (const [id, at] of Object.entries(seen || {})) {
    if (typeof at !== 'number' || at < cutoff) out.push(id);
  }
  return out;
}

module.exports = { decideAnnouncements, expiredSeenIds };
