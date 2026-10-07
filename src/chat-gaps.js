'use strict';

// Pure: how long a quiet spell in a chat was, in words. Loaded by chat.html as
// a plain script (window.acomsChatGaps) and by the tests through require.
//
// Dion, 2026-10-07: "if there is a gap between conversations of like more than
// 15 minutes it puts a little faint line across the chat window then a note in
// the middle" — "when sitting between say 2 hours later but if its the last msg
// say last msg 2 hours ago".

(function (root) {
  const GAP_MS = 15 * 60 * 1000;
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  // A duration in the words a person would say: "20 mins", "2 hours",
  // "4 days", "3 weeks", "2 months". Always rounded down.
  function spanWords(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < HOUR) return plural(Math.max(1, Math.floor(ms / MIN)), 'min');
    if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour');
    if (ms < 14 * DAY) return plural(Math.floor(ms / DAY), 'day');
    if (ms < 60 * DAY) return plural(Math.floor(ms / (7 * DAY)), 'week');
    return plural(Math.floor(ms / (30 * DAY)), 'month');
  }

  function between(earlierIso, laterIso) {
    const a = Date.parse(earlierIso);
    const b = Date.parse(laterIso);
    return Number.isFinite(a) && Number.isFinite(b) ? b - a : NaN;
  }

  // Between two messages: "2 hours later", or null when the gap is under 15 min.
  function gapBetween(earlierIso, laterIso) {
    const ms = between(earlierIso, laterIso);
    return ms >= GAP_MS ? `${spanWords(ms)} later` : null;
  }

  // Under the newest message: "last msg 2 hours ago", or null while it is fresh.
  function sinceLast(lastIso, nowMs) {
    const last = Date.parse(lastIso);
    if (!Number.isFinite(last)) return null;
    const ms = nowMs - last;
    return ms >= GAP_MS ? `last msg ${spanWords(ms)} ago` : null;
  }

  const api = { GAP_MS, spanWords, gapBetween, sinceLast };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatGaps = api;
})(typeof window !== 'undefined' ? window : this);
