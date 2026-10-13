'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MAX_SUGGESTIONS, menuItems } = require('../src/context-menu-rules');

const allFlags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const kinds = (items) => items.map((i) => i.kind);

test('a misspelled word offers its suggestions first, then add-to-dictionary', () => {
  const items = menuItems({
    isEditable: true,
    misspelledWord: 'recieve',
    dictionarySuggestions: ['receive', 'relieve'],
    editFlags: allFlags
  });
  assert.deepStrictEqual(items.slice(0, 2), [
    { kind: 'replace', label: 'receive', word: 'receive' },
    { kind: 'replace', label: 'relieve', word: 'relieve' }
  ]);
  assert.deepStrictEqual(items[3], { kind: 'learn', label: 'Add to dictionary', word: 'recieve' });
  assert.ok(items.some((i) => i.role === 'paste'), 'still offers paste');
});

test('suggestions are capped', () => {
  const items = menuItems({
    isEditable: true,
    misspelledWord: 'teh',
    dictionarySuggestions: ['the', 'ten', 'tea', 'tech', 'tee', 'tel', 'Te'],
    editFlags: allFlags
  });
  assert.strictEqual(items.filter((i) => i.kind === 'replace').length, MAX_SUGGESTIONS);
});

test('a misspelled word with no suggestions says so and can still be learned', () => {
  const items = menuItems({ isEditable: true, misspelledWord: 'ACOMS', dictionarySuggestions: [], editFlags: allFlags });
  assert.deepStrictEqual(items[0], { kind: 'note', label: 'No spelling suggestions' });
  assert.ok(items.some((i) => i.kind === 'learn' && i.word === 'ACOMS'));
});

test('a correctly spelled text box gets cut/copy/paste/select all, enabled per Electron', () => {
  const items = menuItems({
    isEditable: true,
    misspelledWord: '',
    editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true }
  });
  assert.deepStrictEqual(kinds(items), ['role', 'role', 'role', 'separator', 'role']);
  assert.deepStrictEqual(items.filter((i) => i.kind === 'role').map((i) => [i.role, i.enabled]), [
    ['cut', false], ['copy', false], ['paste', true], ['selectAll', true]
  ]);
});

test('selected text on the page (not a text box) offers copy only', () => {
  assert.deepStrictEqual(menuItems({ isEditable: false, selectionText: 'A1221' }), [
    { kind: 'role', role: 'copy', label: 'Copy', enabled: true }
  ]);
});

test('right-clicking plain page with nothing selected shows no menu', () => {
  assert.deepStrictEqual(menuItems({ isEditable: false, selectionText: '  ' }), []);
  assert.deepStrictEqual(menuItems(undefined), []);
});
