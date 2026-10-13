'use strict';

// What the right-click menu shows, worked out from Electron's context-menu
// params. Pure so it can be tested without Electron; context-menu.js turns
// the result into a real Menu.
//
// Electron underlines misspelled words but ships no right-click menu, so
// without this the underline was all anyone got — no way to fix the word.

const MAX_SUGGESTIONS = 5;

// Items are plain descriptors:
//   { kind: 'replace', label, word }  swap the misspelled word for `word`
//   { kind: 'learn', label, word }    add `word` to the spellcheck dictionary
//   { kind: 'note', label }           greyed-out text
//   { kind: 'role', role, label, enabled }  cut / copy / paste / selectAll
//   { kind: 'separator' }
function menuItems(params) {
  const p = params || {};
  const flags = p.editFlags || {};
  const items = [];

  if (p.isEditable && p.misspelledWord) {
    const suggestions = (p.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    if (suggestions.length === 0) {
      items.push({ kind: 'note', label: 'No spelling suggestions' });
    }
    for (const word of suggestions) {
      items.push({ kind: 'replace', label: word, word });
    }
    items.push({ kind: 'separator' });
    items.push({ kind: 'learn', label: 'Add to dictionary', word: p.misspelledWord });
    items.push({ kind: 'separator' });
  }

  if (p.isEditable) {
    items.push({ kind: 'role', role: 'cut', label: 'Cut', enabled: !!flags.canCut });
    items.push({ kind: 'role', role: 'copy', label: 'Copy', enabled: !!flags.canCopy });
    items.push({ kind: 'role', role: 'paste', label: 'Paste', enabled: !!flags.canPaste });
    items.push({ kind: 'separator' });
    items.push({ kind: 'role', role: 'selectAll', label: 'Select all', enabled: !!flags.canSelectAll });
  } else if (p.selectionText && p.selectionText.trim()) {
    items.push({ kind: 'role', role: 'copy', label: 'Copy', enabled: true });
  }

  return items;
}

module.exports = { MAX_SUGGESTIONS, menuItems };
