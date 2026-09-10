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
const { decideAnnouncements } = require('./announce-rules');
const {
  planDay,
  dueSlots,
  planIsStale,
  nextFireAt
} = require('./reminder-schedule');
const { buildTaskReminder, buildToastXml } = require('./task-reminder');

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
      // Optional per-kind totals. `items` is capped, so without these a
      // reminder can only ever count what it can see — it says "at least"
      // rather than stating a number that is wrong.
      counts: data.counts && typeof data.counts === 'object' ? data.counts : null,
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
//
// The rules for WHICH ids count as new live in announce-rules.js, free of
// Electron and unit-tested: the first poll of a portal is a silent baseline,
// and anything still open is refreshed rather than re-announced.
function announce(portal, result) {
  if (result.state !== 'ok') return;

  const actionItems = result.items.filter((i) => i && i.severity === 'action' && i.id);

  const decision = decideAnnouncements({
    actionIds: actionItems.map((i) => i.id),
    seen: store.seenMap(),
    primed: store.isPrimed(portal.id),
    // A muted portal is treated as permanently quiet: its items are still
    // recorded, so un-muting shows what happens NEXT rather than replaying
    // everything that piled up while it was off.
    quiet: store.isMuted(portal.id) || store.inQuietHours(),
    now: Date.now()
  });

  store.recordSeen(decision);
  if (decision.baseline) store.markPrimed(portal.id);

  if (decision.announce.length === 0) return;

  const freshSet = new Set(decision.announce);
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

// ---------------------------------------------------------------------------
// Task reminders
// ---------------------------------------------------------------------------
// Approvals are events: they arrive, you are told once. Tasks are a STATE —
// due today is still due tomorrow — so they get reminded on a clock instead,
// twice a day, until the list is dealt with. Dion: "I want it to be annoying
// and force me to keep these things up to date."
//
// The times move within a window each day rather than sitting at 08:00
// forever, because a toast that arrives at exactly the same moment every day
// becomes furniture. The schedule maths lives in reminder-schedule.js.

let reminderTimer = null;

// A portal's items are capped for payload size. If we got exactly the cap,
// the real number may be higher — say "at least" rather than state a figure
// that is only the part we can see.
const ITEM_CAP_HINT = 10;

function taskItemsFor(result) {
  if (!result || result.state !== 'ok' || !Array.isArray(result.items)) return [];
  return result.items.filter((i) => i && i.severity === 'action' && i.kind === 'task');
}

function fireTaskReminder(portal, result) {
  const items = taskItemsFor(result);
  if (items.length === 0) return false;

  const counts = result.counts && typeof result.counts === 'object' ? result.counts : null;
  const trueCount = counts && Number.isFinite(counts.task) ? counts.task : null;

  const reminder = buildTaskReminder({
    items,
    trueCount,
    capped: trueCount === null && items.length >= ITEM_CAP_HINT,
    now: new Date()
  });
  if (!reminder) return false;

  if (!Notification.isSupported()) return false;

  const target = new URL('/tasks', portal.url).toString();
  const n = new Notification({
    title: reminder.title,
    body: reminder.body,
    // Windows only: a reminder-scenario toast stays on screen until it is
    // dealt with, rather than filing itself away after ~25 seconds. Ignored
    // on macOS, which falls back to title/body above.
    toastXml:
      process.platform === 'win32'
        ? buildToastXml({ title: reminder.title, body: reminder.body })
        : undefined
  });
  n.on('click', () => {
    if (openPortalAt) openPortalAt(portal.id, target);
  });
  n.show();
  return true;
}

// Run any reminder slot that is now owed, then arm the next one.
async function runDueReminders() {
  const now = new Date();
  let plan = store.getReminderPlan();

  if (planIsStale(plan, now)) {
    plan = planDay(now);
    store.setReminderPlan(plan);
  }

  // Quiet hours defer a reminder rather than cancelling it — otherwise the
  // one notification meant to be unmissable is the one most easily silenced.
  const quietUntil = store.inQuietHours(now) ? now.getTime() + 60 * 1000 : null;
  const owed = dueSlots(plan, now, { quietUntil });

  if (owed.length > 0) {
    // Reminders must speak for the CURRENT state, not whatever the last poll
    // happened to leave behind.
    await pollAll();

    for (const portal of portals.filter((p) => p.summary)) {
      if (store.isMuted(portal.id)) continue;
      fireTaskReminder(portal, results.get(portal.id));
    }

    for (const slot of owed) slot.fired = true;
    store.setReminderPlan(plan);
  }

  armReminderTimer();
}

function armReminderTimer() {
  if (reminderTimer) clearTimeout(reminderTimer);
  const now = new Date();
  const plan = store.getReminderPlan();

  const at = nextFireAt(plan, now);
  // Nothing left today: look again just after midnight to roll a fresh day.
  const midnight = new Date(now.getTime());
  midnight.setHours(24, 0, 30, 0);
  const wake = at || midnight.getTime();

  // setTimeout overflows past ~24.8 days; nothing here is close, but clamp
  // anyway so a bad clock cannot turn the delay negative and spin.
  const delay = Math.max(1000, Math.min(wake - now.getTime(), 24 * 60 * 60 * 1000));
  reminderTimer = setTimeout(() => {
    runDueReminders().catch(() => armReminderTimer());
  }, delay);
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

  // Catches up any slot missed while the machine was off, then arms the next.
  setTimeout(() => runDueReminders().catch(() => {}), FIRST_POLL_DELAY_MS + 5000);

  emit();
}

function dispose() {
  if (timer) clearInterval(timer);
  if (reminderTimer) clearTimeout(reminderTimer);
  timer = null;
  reminderTimer = null;
  listeners = [];
}

module.exports = {
  init,
  dispose,
  pollAll,
  onChanged,
  snapshot,
  totalBadge,
  resolveItemUrl,
  runDueReminders
};
