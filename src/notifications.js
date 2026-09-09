'use strict';

// ---------------------------------------------------------------------------
// Portal notifications
// ---------------------------------------------------------------------------
// The launcher asks each portal that offers one for a small summary of what is
// waiting on the signed-in person, and raises a native notification when
// something NEW turns up.
//
// Why this can work without any credential handling here: the request goes out
// through the app's own session, the same one the portal windows use, so the
// portal's normal login cookie rides along. The launcher never sees a token.
//
// Two rules this module exists to enforce, both learned the hard way in the
// design conversation:
//
//   1. A 401 IS VISIBLE. If a session has expired, the portal's card says
//      "Sign in to ACOMS.WIP" rather than the launcher quietly going dark and
//      pretending nothing is waiting. Silent failure is worse than no feature.
//   2. Nothing is announced twice. Item ids are remembered across restarts, so
//      the same approval doesn't toast every time the app starts.

const { Notification, net } = require('electron');
const store = require('./store');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FIRST_POLL_DELAY_MS = 8 * 1000; // let the picker paint first
const REQUEST_TIMEOUT_MS = 15 * 1000;

// Per-portal state the picker renders:
//   ok       — answered, `badge` and `items` are current
//   signIn   — 401/redirect to login; the person needs to open that portal
//   error    — unreachable or a bad response; shown quietly, not shouted about
//   off      — this portal doesn't offer a summary endpoint
const results = new Map();

let portals = [];
let timer = null;
let listeners = [];
let openPortalAt = null; // injected by main.js: (portalId, url) => void

function snapshot() {
  const out = {};
  for (const [id, r] of results) out[id] = { ...r };
  return out;
}

function emit() {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (err) {
      console.error('notification listener failed:', err.message);
    }
  }
}

function onChanged(fn) {
  listeners.push(fn);
  fn(snapshot());
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

// Total across every portal that answered — what the tray badge shows.
function totalBadge() {
  let total = 0;
  for (const r of results.values()) {
    if (r.state === 'ok' && !store.isMuted(r.portalId)) total += r.badge || 0;
  }
  return total;
}

function summaryUrl(portal) {
  if (!portal.summary) return null;
  try {
    return new URL(portal.summary, portal.url).toString();
  } catch {
    return null;
  }
}

// Fetch through Electron's net module so the request uses the app session and
// its cookies — the same session the portal windows are logged in to.
async function fetchSummary(portal) {
  const url = summaryUrl(portal);
  if (!url) return { state: 'off' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await net.fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      // A login redirect must be visible as a redirect, not followed into an
      // HTML page that then fails to parse as JSON.
      redirect: 'manual',
      signal: controller.signal
    });

    // A login redirect is the normal way these portals say "your session
    // expired". With redirect:'manual' the Fetch spec hands back an OPAQUE
    // redirect — type 'opaqueredirect', status 0 — not the 3xx itself, so
    // checking only for 30x would miss every one of them.
    const isRedirect =
      res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400);
    if (isRedirect || res.status === 401 || res.status === 403) {
      return { state: 'signIn' };
    }
    if (!res.ok) {
      return { state: 'error', message: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    return {
      state: 'ok',
      badge: Number.isFinite(data.badge) ? data.badge : items.length,
      summary: typeof data.summary === 'string' ? data.summary : '',
      items,
      at: Date.now()
    };
  } catch (err) {
    return { state: 'error', message: (err && err.message) || 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

function notify(portal, title, body, targetUrl) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => {
    if (openPortalAt) openPortalAt(portal.id, targetUrl);
  });
  n.show();
}

// Decide what, if anything, to say about one portal's new items.
// One new thing gets named. Several get counted — a burst of six separate
// toasts is how a person learns to ignore them.
function announce(portal, result) {
  if (result.state !== 'ok') return;
  if (store.isMuted(portal.id)) return;

  const actionItems = result.items.filter((i) => i && i.severity === 'action' && i.id);
  if (actionItems.length === 0) return;

  const fresh = store.unseen(actionItems.map((i) => i.id));
  if (fresh.length === 0) return;

  // Mark seen regardless of whether we're about to show anything: during quiet
  // hours the person is choosing not to be told now, not asking to be told
  // about it at 7am along with everything else that happened overnight. The
  // badge still carries the count.
  store.markSeen(fresh);

  if (store.inQuietHours()) return;

  const freshSet = new Set(fresh);
  const newItems = actionItems.filter((i) => freshSet.has(i.id));

  if (newItems.length === 1) {
    const item = newItems[0];
    const url = resolveItemUrl(portal, item);
    notify(portal, portal.name, [item.title, item.subtitle].filter(Boolean).join(' — '), url);
  } else {
    notify(
      portal,
      portal.name,
      `${newItems.length} things need you${result.summary ? ` — ${result.summary}` : ''}`,
      portal.url
    );
  }
}

// Items carry a RELATIVE path, so the portal's own base URL resolves it. That
// keeps the portal free to move (preview deployments included) without the
// launcher knowing its hostname.
function resolveItemUrl(portal, item) {
  const p = item && (item.path || item.url);
  if (!p) return portal.url;
  try {
    return new URL(p, portal.url).toString();
  } catch {
    return portal.url;
  }
}

async function pollOne(portal) {
  const result = await fetchSummary(portal);
  result.portalId = portal.id;
  results.set(portal.id, result);
  announce(portal, result);
}

async function pollAll() {
  const withSummary = portals.filter((p) => p.summary);
  if (withSummary.length === 0) return;
  await Promise.all(withSummary.map((p) => pollOne(p).catch(() => {})));
  emit();
}

function init({ portals: list, intervalMs, openPortalAt: opener }) {
  portals = Array.isArray(list) ? list : [];
  openPortalAt = opener || null;

  for (const p of portals) {
    results.set(p.id, { portalId: p.id, state: p.summary ? 'idle' : 'off', badge: 0, items: [] });
  }

  const every = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
  setTimeout(() => pollAll(), FIRST_POLL_DELAY_MS);
  timer = setInterval(() => pollAll(), every);
  emit();
}

function dispose() {
  if (timer) clearInterval(timer);
  timer = null;
  listeners = [];
}

module.exports = {
  init,
  dispose,
  pollAll,
  onChanged,
  snapshot,
  totalBadge,
  resolveItemUrl
};
