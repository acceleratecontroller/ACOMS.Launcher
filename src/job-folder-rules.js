'use strict';

// Pure: where a job's SharePoint folder should be on THIS computer. Required
// by job-folder.js and the tests, and loaded by chat.html as a plain script
// (window.acomsJobFolderRules) for the messages; no fs, no Electron.
//
// Dion, 2026-10-13: "when we put that A number in chat it does what it does
// now but also provides like a local link that you can click and it opens the
// folder on your computer ... you point it where it is suposed to be and it'll
// either open a folder or come up with a think that says you need to sync
// that folder".
//
// OneDrive syncs each SharePoint library into one folder named after the
// organisation, one sub-folder per library, "<site> - <library>":
//
//   C:\Users\james\ACOMS\SEQ - Client Projects - Documents\UGL\NDM\A0939 - …
//   ~/Library/CloudStorage/OneDrive-SharedLibraries-ACOMS/SEQ - Client Projects - Documents/…
//
// The person points the launcher at that organisation folder once (the
// "ACOMS folder"). Controller says which library (SEQ / NQ) and the path
// inside it; this module turns that into candidate local paths.

(function (root) {
  const JOB_NUMBER_RE = /^A(\d{3,5})[A-Z]?$/i;

  // "A1016B" -> "A1016": a variation lives in its base job's folder.
  function baseJobNumber(number) {
    const m = JOB_NUMBER_RE.exec(String(number || '').trim());
    return m ? `A${m[1]}` : null;
  }

  // Is this folder name the job's folder? Job Creator names them "A0939" or
  // "A0939 - <hint>", so the number must be followed by nothing or by a
  // non-alphanumeric — "A09390" and "A0939B" are other folders.
  function isJobFolderName(name, number) {
    const base = baseJobNumber(number);
    if (!base) return false;
    const n = String(name || '');
    if (n.slice(0, base.length).toUpperCase() !== base) return false;
    return !/^[0-9A-Za-z]/.test(n.slice(base.length));
  }

  // The folder in the ACOMS folder that holds a region's library: "SEQ - …".
  // Prefers "Client Projects" when a region has more than one library synced.
  // `entries` are the names of the ACOMS folder's sub-folders.
  function libraryFolderName(library, entries) {
    const prefix = `${String(library || '').trim().toLowerCase()} - `;
    if (prefix === ' - ') return null;
    const hits = (entries || []).filter((e) => String(e).toLowerCase().startsWith(prefix));
    return hits.find((e) => /client projects/i.test(e)) || hits[0] || null;
  }

  // The sub-folders of the ACOMS folder that are synced libraries at all.
  function libraryFolderNames(entries) {
    return (entries || []).filter((e) => / - /.test(String(e)) && !String(e).startsWith('.'));
  }

  // "UGL/NDM/A0939 - …" -> ["UGL", "NDM", "A0939 - …"]. Null if the path tries
  // to climb out of the library or is empty.
  function pathSegments(sharepointPath) {
    const parts = String(sharepointPath || '')
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0 || parts.some((p) => p === '.' || p === '..' || /[\\:]/.test(p))) return null;
    return parts;
  }

  // What a click on "Open folder" says when there is nothing to open.
  function failureMessage(result) {
    const job = result.number || 'this job';
    switch (result.reason) {
      case 'no-root':
        return 'Show the launcher where your ACOMS SharePoint folder is, then try again.';
      case 'root-missing':
        return `Your ACOMS folder isn't there any more (${result.root}). Choose it again.`;
      case 'no-libraries':
        return `No synced SharePoint libraries in ${result.root}. Choose the folder that holds "SEQ - Client Projects - Documents".`;
      case 'not-synced':
        return `The ${result.library} library isn't synced on this computer. Sync it from SharePoint, then try again.`;
      case 'not-found':
        return `Couldn't find ${job}'s folder in what's synced on this computer. You may need to sync that folder from SharePoint, then try again.`;
      default:
        return `Couldn't open ${job}'s folder${result.error ? `: ${result.error}` : '.'}`;
    }
  }

  const api = {
    baseJobNumber,
    isJobFolderName,
    libraryFolderName,
    libraryFolderNames,
    pathSegments,
    failureMessage
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsJobFolderRules = api;
})(typeof window !== 'undefined' ? window : this);
