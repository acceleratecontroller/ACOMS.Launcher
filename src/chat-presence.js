'use strict';

// Pure: is a person active, idle or offline, and what to call it. Loaded by
// chat.html as a plain script (window.acomsChatPresence) and by the tests
// through require. The same rule as ACOMS.Controller's presenceOf (web chat).
//
// Dion, 2026-10-07: "right now there is just a little green dot but all that
// does is shows a person has the program on and their pc is running, it'd be
// cool if it went orange or something if they're idle ... so next to their
// name it'd say like inactive 15m". Idle comes from each Launcher reporting
// Windows' own keyboard/mouse idle clock with its chat sync.

(function (root) {
  const IDLE_SHOW_MS = 5 * 60 * 1000;

  // "15m", "2h", "3d" — rounded down.
  function shortSpan(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${Math.max(1, min)}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  // { state: 'active' | 'idle' | 'offline', label }
  function presenceOf(person, nowMs = Date.now()) {
    if (!person || !person.online) return { state: 'offline', label: 'offline' };
    const since = person.idleSince ? Date.parse(person.idleSince) : NaN;
    if (Number.isFinite(since) && nowMs - since >= IDLE_SHOW_MS) {
      return { state: 'idle', label: `inactive ${shortSpan(nowMs - since)}` };
    }
    return { state: 'active', label: 'online' };
  }

  const api = { IDLE_SHOW_MS, shortSpan, presenceOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatPresence = api;
})(typeof window !== 'undefined' ? window : this);
