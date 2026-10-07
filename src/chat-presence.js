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

  // ── Who is on an old Launcher (Dion 2026-10-07: "something that shows what
  // version of the app someone is on if they're not on the latest") ──────

  function parts(v) {
    return String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  }

  // -1 / 0 / 1, numerically: 1.0.10 is newer than 1.0.9.
  function compareVersions(a, b) {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // The newest version known: anyone's report, mine, or one my updater found.
  function latestVersion(people, extra = []) {
    const all = [...(people || []).map((p) => p && p.appVersion), ...extra].filter(
      (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)
    );
    return all.reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
  }

  // "v1.0.18" when this person runs an older Launcher than the latest, else null.
  function behindLabel(person, latest) {
    if (!person || !person.appVersion || !latest) return null;
    return compareVersions(person.appVersion, latest) < 0 ? `v${person.appVersion}` : null;
  }

  const api = { IDLE_SHOW_MS, shortSpan, presenceOf, compareVersions, latestVersion, behindLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatPresence = api;
})(typeof window !== 'undefined' ? window : this);
