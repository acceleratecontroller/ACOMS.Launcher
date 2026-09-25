'use strict';

// Pure decisions about portal windows — no Electron in here, so they can be
// tested (see test/window-rules.test.js). main.js owns the actual windows.
//
// Since 2026-09-22 a portal can have MORE THAN ONE window (Dion: "open more
// than one window of an app from the Launcher"), and a portal can declare
// `views` — named pages that get a tile half and a window of their own, the
// first being WIP's Scheduler ("a full-screen, nothing-but-the-scheduler
// window"). Windows are grouped under a KEY: the portal id for its ordinary
// windows, `<portal id>#<view id>` for a view's.

function windowKey(portalId, viewId) {
  return viewId ? `${portalId}#${viewId}` : portalId;
}

function portalIdOfKey(key) {
  return String(key).split('#')[0];
}

// Normalise a portal's optional `views` from portals.json. Anything malformed
// is dropped rather than crashing the picker.
function normaliseViews(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (v) =>
        v &&
        typeof v.id === 'string' &&
        v.id &&
        !v.id.includes('#') &&
        typeof v.path === 'string' &&
        v.path.startsWith('/')
    )
    .map((v) => ({
      id: v.id,
      label: typeof v.label === 'string' && v.label ? v.label : v.id,
      tagline: typeof v.tagline === 'string' ? v.tagline : '',
      path: v.path,
      // A view that asks for the whole screen opens maximised.
      maximize: v.maximize === true
    }));
}

function viewUrl(portal, view) {
  return String(portal.url).replace(/\/$/, '') + view.path;
}

// What to do when a page inside a portal window asks for a NEW window
// (target="_blank" / window.open):
//   external  — not one of ours: hand to the default browser
//   focus     — one of our windows already shows exactly that page: bring it
//               forward rather than opening a twin
//   new       — one of our portals, page not open anywhere: a brand-new window
//               (Dion, 2026-09-21: links inside the scheduler open a NEW window,
//               not replace the board; decision 7 — new windows may pile up)
//   ignore    — not an http(s) URL at all
//
// `openWindows` is [{ key, url }] for every live portal window.
function decideNewWindow(url, portals, openWindows) {
  if (!url || !/^https?:\/\//i.test(url)) return { action: 'ignore' };
  const portal = findPortalForUrl(url, portals);
  if (!portal) return { action: 'external', url };
  const same = (openWindows || []).find((w) => sameUrl(w.url, url));
  if (same) return { action: 'focus', key: same.key };
  return { action: 'new', portalId: portal.id, url };
}

// Match a URL to one of the configured portals by host, so a cross-app link
// (e.g. WIP linking a job into GIS) can be recognised as "one of ours".
function findPortalForUrl(url, portals) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (
    (portals || []).find((p) => {
      try {
        return new URL(p.url).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    }) || null
  );
}

// The same page, ignoring a trailing slash and the fragment.
function sameUrl(a, b) {
  const norm = (u) => {
    try {
      const x = new URL(u);
      x.hash = '';
      return x.href.replace(/\/$/, '');
    } catch {
      return String(u);
    }
  };
  return norm(a) === norm(b);
}

// The picture viewer: nearly the whole of the screen it opens on, centred,
// whatever size the chat window is (Dion, 2026-09-25). `workArea` is Electron's
// display.workArea — the screen minus the taskbar.
function viewerBounds(workArea, fraction = 0.92) {
  const width = Math.round(workArea.width * fraction);
  const height = Math.round(workArea.height * fraction);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  };
}

module.exports = {
  viewerBounds,
  windowKey,
  portalIdOfKey,
  normaliseViews,
  viewUrl,
  decideNewWindow,
  findPortalForUrl,
  sameUrl
};
