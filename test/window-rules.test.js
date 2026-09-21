'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  windowKey,
  portalIdOfKey,
  normaliseViews,
  viewUrl,
  decideNewWindow,
  sameUrl
} = require('../src/window-rules');

const PORTALS = [
  { id: 'acoms-wip', url: 'https://acoms-wip.vercel.app' },
  { id: 'acoms-gis', url: 'https://acoms-gis.vercel.app/' }
];

// ── Keys ───────────────────────────────────────────────────────────────────

test('a view window is keyed under its portal', () => {
  assert.strictEqual(windowKey('acoms-wip'), 'acoms-wip');
  assert.strictEqual(windowKey('acoms-wip', 'scheduler'), 'acoms-wip#scheduler');
  assert.strictEqual(portalIdOfKey('acoms-wip#scheduler'), 'acoms-wip');
  assert.strictEqual(portalIdOfKey('acoms-wip'), 'acoms-wip');
});

// ── Views from portals.json ────────────────────────────────────────────────

test('views need an id and a root-relative path; the rest has defaults', () => {
  const views = normaliseViews([
    { id: 'scheduler', label: 'Scheduler', path: '/scheduler', maximize: true },
    { id: 'bare', path: '/x' },
    { id: 'no-path' },
    { id: 'bad#id', path: '/y' },
    { id: 'relative', path: 'scheduler' },
    null
  ]);
  assert.deepStrictEqual(views, [
    { id: 'scheduler', label: 'Scheduler', tagline: '', path: '/scheduler', maximize: true },
    { id: 'bare', label: 'bare', tagline: '', path: '/x', maximize: false }
  ]);
  assert.deepStrictEqual(normaliseViews(undefined), []);
});

test('a view URL is the portal URL plus the path, whatever the trailing slash', () => {
  const view = { path: '/scheduler' };
  assert.strictEqual(viewUrl(PORTALS[0], view), 'https://acoms-wip.vercel.app/scheduler');
  assert.strictEqual(viewUrl(PORTALS[1], view), 'https://acoms-gis.vercel.app/scheduler');
});

// ── New-window links ───────────────────────────────────────────────────────
// The bug this exists to prevent: "Open job in WIP" from the scheduler
// replacing the board, because the launcher routed every same-portal link
// back into the one window that portal had.

test('a link to one of our portals opens a brand-new window', () => {
  const r = decideNewWindow('https://acoms-wip.vercel.app/projects/123', PORTALS, [
    { key: 'acoms-wip#scheduler', url: 'https://acoms-wip.vercel.app/scheduler' }
  ]);
  assert.deepStrictEqual(r, {
    action: 'new',
    portalId: 'acoms-wip',
    url: 'https://acoms-wip.vercel.app/projects/123'
  });
});

test('a page that is already showing in one of our windows is focused, not twinned', () => {
  const r = decideNewWindow('https://acoms-gis.vercel.app/projects/A1016', PORTALS, [
    { key: 'acoms-gis', url: 'https://acoms-gis.vercel.app/projects/A1016/' }
  ]);
  assert.deepStrictEqual(r, { action: 'focus', key: 'acoms-gis' });
});

test('anything that is not one of ours goes to the default browser', () => {
  const r = decideNewWindow('https://example.com/doc', PORTALS, []);
  assert.deepStrictEqual(r, { action: 'external', url: 'https://example.com/doc' });
});

test('non-http URLs are ignored', () => {
  assert.deepStrictEqual(decideNewWindow('mailto:x@y.z', PORTALS, []), { action: 'ignore' });
  assert.deepStrictEqual(decideNewWindow('', PORTALS, []), { action: 'ignore' });
});

test('same page: trailing slash and fragment do not count, the path does', () => {
  assert.ok(sameUrl('https://a.b/c/', 'https://a.b/c#top'));
  assert.ok(!sameUrl('https://a.b/c', 'https://a.b/c?d=1'));
  assert.ok(!sameUrl('https://a.b/c', 'https://a.b/d'));
});
