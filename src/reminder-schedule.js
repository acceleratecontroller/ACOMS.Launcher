'use strict';

// ---------------------------------------------------------------------------
// When the task reminders fire
// ---------------------------------------------------------------------------
// Tasks are not like approvals. An approval is an EVENT — it happened once,
// you get told once. A task due today is a STATE, and it is still true
// tomorrow. So tasks get reminders on a clock rather than an announcement on
// arrival, and they keep coming until the list is dealt with.
//
// Two rules shape this, both Dion's:
//
//   "I want it to be annoying and force me to keep these things up to date"
//
//   "I almost want the notifications to be somewhat random, so maybe one
//    happens around like 7am and then another one around 1pm, but not exactly
//    the same time every time"
//
// The randomness is the interesting part and it is not a gimmick. A toast
// that arrives at 08:00:00 every single day becomes furniture: you learn to
// dismiss it at 08:00 without reading it. A time that moves inside a window
// has to be read to be dismissed.
//
// Kept free of Electron so the clock behaviour can be tested rather than
// waited for.

/** Windows the two daily reminders land inside, in local minutes past midnight. */
const DEFAULT_SLOTS = [
  { id: 'morning', fromMinute: 6 * 60 + 45, toMinute: 7 * 60 + 45 },   // ~7am
  { id: 'afternoon', fromMinute: 12 * 60 + 30, toMinute: 13 * 60 + 30 } // ~1pm
];

/** Local YYYY-MM-DD. Reminders belong to a person's day, not to UTC. */
function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function atLocalMinute(day, minute) {
  const d = new Date(day.getTime());
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minute);
  return d.getTime();
}

/**
 * Roll today's actual firing times.
 *
 * Called once per local day. `rng` is injectable so tests are not at the mercy
 * of Math.random.
 *
 * @returns {{day: string, slots: Array<{id: string, at: number, fired: boolean}>}}
 */
function planDay(now, { slots = DEFAULT_SLOTS, rng = Math.random } = {}) {
  return {
    day: localDayKey(now),
    slots: slots.map((s) => {
      const span = Math.max(0, s.toMinute - s.fromMinute);
      // Clamped: Math.random() never returns exactly 1, but a stubbed or
      // broken rng that does must not place a reminder outside its window.
      const offset = Math.min(span, Math.floor(rng() * (span + 1)));
      const minute = s.fromMinute + offset;
      return { id: s.id, at: atLocalMinute(now, minute), fired: false };
    })
  };
}

/**
 * Which slots are due to fire now.
 *
 * A slot whose moment has passed and which has not fired is due — INCLUDING
 * one missed while the machine was off or asleep. Skipping it silently would
 * mean a laptop opened at 9am hears nothing about a 7am reminder, which is
 * the opposite of the point.
 *
 * Quiet hours DEFER rather than cancel: `quietUntil` (epoch ms, or null) moves
 * the slot rather than dropping it, so an "annoying, forces action" reminder
 * cannot be quietly swallowed by a setting made for a different purpose.
 */
function dueSlots(plan, now, { quietUntil = null } = {}) {
  if (!plan || !Array.isArray(plan.slots)) return [];
  const t = now.getTime();
  return plan.slots.filter((s) => {
    if (s.fired) return false;
    if (s.at > t) return false;
    if (quietUntil && t < quietUntil) return false;
    return true;
  });
}

/** True when the plan is for a different local day and should be re-rolled. */
function planIsStale(plan, now) {
  return !plan || plan.day !== localDayKey(now);
}

/**
 * The next moment worth waking up for, or null if today has nothing left.
 * Used to arm a timer rather than poll the clock.
 */
function nextFireAt(plan, now) {
  if (!plan || !Array.isArray(plan.slots)) return null;
  const t = now.getTime();
  const pending = plan.slots.filter((s) => !s.fired && s.at > t).map((s) => s.at);
  return pending.length ? Math.min(...pending) : null;
}

module.exports = {
  DEFAULT_SLOTS,
  localDayKey,
  planDay,
  dueSlots,
  planIsStale,
  nextFireAt
};
