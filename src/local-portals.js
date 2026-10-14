'use strict';

// Local-only portals (Dion, 2026-10-15: the Brain Console "for just those who have
// access to it"). A portal marked `localOnly` in portals.json runs on this computer
// (http://127.0.0.1:...), not on Vercel. Its tile is shown only when the portal answers
// on this machine, so access follows whether it is installed here: on Dion's and JD's
// computers the Brain Console runs at login; on everyone else's nothing answers and the
// tile never appears. No sign-in, no list of names to keep up to date.

const PROBE_TIMEOUT_MS = 1500;

// Only loopback addresses may be local-only: the rule must never make a remote site
// look like it is "on this computer".
function isLoopback(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

// Keep a portal's localOnly / probe fields only when they make sense.
function normaliseLocal(p) {
  if (!p.localOnly) return { ...p, localOnly: false };
  if (!isLoopback(p.url)) return null; // misconfigured: never shown
  const probe = typeof p.probe === 'string' && p.probe.startsWith('/') ? p.probe : '/';
  return { ...p, localOnly: true, probe };
}

// The portals to show: every ordinary portal, plus the local ones that answered.
function visiblePortals(all, reachableIds) {
  const up = new Set(reachableIds || []);
  return (all || []).filter((p) => !p.localOnly || up.has(p.id));
}

// Which local-only portals answer right now. fetchFn is Electron's net.fetch (or any
// fetch); a portal answers when its probe path returns 2xx within the timeout.
async function probeLocal(all, fetchFn, timeoutMs = PROBE_TIMEOUT_MS) {
  const local = (all || []).filter((p) => p.localOnly);
  const results = await Promise.all(
    local.map(async (p) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchFn(new URL(p.probe, p.url).toString(), { signal: ctrl.signal, cache: 'no-store' });
        return res && res.ok ? p.id : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return results.filter(Boolean);
}

module.exports = { isLoopback, normaliseLocal, visiblePortals, probeLocal, PROBE_TIMEOUT_MS };
