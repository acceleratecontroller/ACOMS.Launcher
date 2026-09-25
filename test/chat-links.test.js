'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { splitMessage, jobLinkBaseFor } = require('../src/chat-links');

const BASE = 'https://acoms-wip.vercel.app/jobs/';
const links = (parts) => parts.filter((p) => p.href).map((p) => [p.text, p.href]);

test('an A-number becomes a link to that job in WIP', () => {
  assert.deepStrictEqual(links(splitMessage('can you look at A1174 today', BASE)), [
    ['A1174', BASE + 'A1174']
  ]);
});

test('a suffixed A-number keeps its letter; lower case is tidied', () => {
  assert.deepStrictEqual(links(splitMessage('A1016B and a1016b', BASE)), [
    ['A1016B', BASE + 'A1016B'],
    ['a1016b', BASE + 'A1016B']
  ]);
});

test('the message reads exactly as typed', () => {
  const text = 'A1174, (A0023) and A1016B. See https://x.test/a?b=A1174 too';
  assert.strictEqual(
    splitMessage(text, BASE)
      .map((p) => p.text)
      .join(''),
    text
  );
});

test('not job numbers: too short, too long, inside a word, two letters', () => {
  for (const text of ['A117', 'A11745', 'XA1174', 'A1174BC', 'A4 paper', 'SCOMA1234567']) {
    assert.deepStrictEqual(links(splitMessage(text, BASE)), [], text);
  }
});

test('an A-number inside a URL stays part of the URL', () => {
  assert.deepStrictEqual(links(splitMessage('https://acoms-gis.vercel.app/p/A1016B', BASE)), [
    ['https://acoms-gis.vercel.app/p/A1016B', 'https://acoms-gis.vercel.app/p/A1016B']
  ]);
});

test('with no job link configured, A-numbers stay plain text but URLs still link', () => {
  assert.deepStrictEqual(links(splitMessage('A1174 https://a.test', null)), [
    ['https://a.test', 'https://a.test']
  ]);
});

test('the job link base comes from the chat.jobs block and the portal list', () => {
  const portals = [{ id: 'acoms-wip', url: 'https://acoms-wip.vercel.app/' }];
  assert.strictEqual(jobLinkBaseFor({ portal: 'acoms-wip', path: '/jobs/' }, portals), BASE);
  assert.strictEqual(jobLinkBaseFor({ portal: 'acoms-wip', path: '/jobs' }, portals), BASE);
  assert.strictEqual(jobLinkBaseFor({ portal: 'acoms-wip' }, portals), BASE);
  assert.strictEqual(jobLinkBaseFor({ portal: 'nope' }, portals), null);
  assert.strictEqual(jobLinkBaseFor(undefined, portals), null);
});
