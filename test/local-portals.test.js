'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isLoopback, normaliseLocal, visiblePortals, probeLocal } = require('../src/local-portals');

const WIP = { id: 'acoms-wip', url: 'https://acoms-wip.vercel.app', localOnly: false };
const BRAIN = { id: 'brain-console', url: 'http://127.0.0.1:4477', localOnly: true, probe: '/api/identity' };

test('only plain-http loopback addresses can be local-only', () => {
  assert.ok(isLoopback('http://127.0.0.1:4477'));
  assert.ok(isLoopback('http://localhost:4477/'));
  assert.ok(!isLoopback('https://acoms-wip.vercel.app'));
  assert.ok(!isLoopback('http://127.0.0.1.evil.com'));
  assert.ok(!isLoopback('not a url'));
});

test('a local-only portal pointing off this computer is dropped', () => {
  assert.strictEqual(normaliseLocal({ id: 'x', url: 'https://example.com', localOnly: true }), null);
  assert.deepStrictEqual(normaliseLocal({ id: 'b', url: 'http://127.0.0.1:4477', localOnly: true }).probe, '/');
  assert.strictEqual(normaliseLocal({ id: 'w', url: 'https://acoms-wip.vercel.app' }).localOnly, false);
});

test('a local-only tile shows only when it answered', () => {
  assert.deepStrictEqual(visiblePortals([WIP, BRAIN], []).map((p) => p.id), ['acoms-wip']);
  assert.deepStrictEqual(visiblePortals([WIP, BRAIN], ['brain-console']).map((p) => p.id), ['acoms-wip', 'brain-console']);
});

test('probing asks the probe path and counts only a 2xx answer', async () => {
  const asked = [];
  const ok = async (url) => { asked.push(url); return { ok: true }; };
  assert.deepStrictEqual(await probeLocal([WIP, BRAIN], ok), ['brain-console']);
  assert.deepStrictEqual(asked, ['http://127.0.0.1:4477/api/identity']); // ordinary portals are never probed
  assert.deepStrictEqual(await probeLocal([BRAIN], async () => ({ ok: false })), []);
  assert.deepStrictEqual(await probeLocal([BRAIN], async () => { throw new Error('ECONNREFUSED'); }), []);
});

test('a probe that hangs gives up at the timeout', async () => {
  const hang = (_url, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const t0 = Date.now();
  assert.deepStrictEqual(await probeLocal([BRAIN], hang, 50), []);
  assert.ok(Date.now() - t0 < 1000);
});
