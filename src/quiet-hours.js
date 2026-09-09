'use strict';

// ---------------------------------------------------------------------------
// Quiet hours — pure time maths, deliberately free of Electron
// ---------------------------------------------------------------------------
// Split out from store.js so it can be tested directly. The interesting case
// is a window that CROSSES MIDNIGHT ("18:00 to 07:00"), which is the normal
// way a person expresses "don't bother me overnight" and the easy thing to get
// backwards. Getting it wrong fails invisibly: notifications are suppressed
// around the clock and that looks identical to nothing being waiting.

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Accepts "HH:MM" in 24-hour time. Anything else is not a time.
function isValidTime(value) {
  return typeof value === 'string' && HHMM.test(value);
}

// Minutes since midnight, or null if the input isn't a valid time.
function toMinutes(value) {
  if (!isValidTime(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Is `now` inside the quiet window?
 *
 * - Either bound missing or invalid → never quiet. Half a range is not a
 *   range, and defaulting to "quiet" would silence the app on bad input.
 * - from === to → never quiet, rather than a 24-hour blackout from what is
 *   almost certainly a mis-set field.
 * - from < to → a window inside one day (09:00–17:00).
 * - from > to → a window crossing midnight (18:00–07:00): quiet at or after
 *   `from`, OR before `to`.
 */
function inQuietWindow(now, from, to) {
  const f = toMinutes(from);
  const t = toMinutes(to);
  if (f === null || t === null) return false;
  if (f === t) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  return f < t ? minutes >= f && minutes < t : minutes >= f || minutes < t;
}

module.exports = { isValidTime, toMinutes, inQuietWindow };
