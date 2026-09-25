'use strict';

// Pure rules for files in chat (Dion, 2026-09-25: "drag and drop or ctrl paste
// image files/snips etc ... ideally any type of file ... view in chat in a nice
// little window you can click to expand for images"). Loaded by chat.html as a
// plain script (window.acomsChatFiles) and by the main process and tests
// through require.

(function (root) {
  // Mirrors ACOMS.Controller's MAX_ATTACHMENT_BYTES / MAX_ATTACHMENTS_PER_MESSAGE.
  // Checked here too so a 2 GB video is refused before it starts uploading.
  const MAX_BYTES = 25 * 1024 * 1024;
  const MAX_FILES = 10;

  // What Chromium draws in an <img>. HEIC/TIFF are images but not these, so
  // they arrive as a file to open instead of a broken thumbnail.
  const IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/avif'
  ]);

  function isImage(contentType) {
    return IMAGE_TYPES.has(String(contentType || '').toLowerCase());
  }

  function attachmentsOf(message) {
    const list = message && message.payload && message.payload.attachments;
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string') : [];
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  // One line standing in for a message's files, where text is expected: the
  // pop-up card, and the last line under a name in the people list.
  function summary(message) {
    const files = attachmentsOf(message);
    if (files.length === 0) return '';
    const images = files.filter((a) => isImage(a.contentType)).length;
    if (files.length === 1) return images === 1 ? '📷 Photo' : `📎 ${files[0].name || 'File'}`;
    if (images === files.length) return `📷 ${files.length} photos`;
    return `📎 ${files.length} files`;
  }

  // The text to show for a message where there is room for one line.
  function previewText(message) {
    if (message && message.deletedAt) return 'Message deleted';
    const body = String((message && message.body) || '').trim();
    return body || summary(message);
  }

  // Which of the files someone picked, dropped or pasted can be sent, and why
  // the rest can't. `already` is how many are waiting in the composer.
  function checkFiles(files, already = 0) {
    const accepted = [];
    const refused = [];
    for (const f of files || []) {
      if (!f || !(f.size > 0)) refused.push(`${(f && f.name) || 'A file'} is empty`);
      else if (f.size > MAX_BYTES) refused.push(`${f.name} is over ${MAX_BYTES / 1024 / 1024} MB`);
      else if (already + accepted.length >= MAX_FILES) refused.push(`Up to ${MAX_FILES} files per message`);
      else accepted.push(f);
    }
    return { accepted, refused: [...new Set(refused)] };
  }

  // A pasted screenshot arrives called "image.png" every time. Give it a name
  // that says what and when, so a folder of them can be told apart.
  function nameForPaste(name, contentType, now = new Date()) {
    const generic = !name || /^image\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
    if (!generic) return name;
    const ext = (String(contentType || '').split('/')[1] || 'png').replace('jpeg', 'jpg');
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
      now.getHours()
    )}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    return `Screenshot ${stamp}.${ext}`;
  }

  // A name safe to write to disk on Windows and macOS: the server already
  // strips paths, but a name like "CON" or "a:b" would still fail to save.
  function safeDiskName(name) {
    let n = String(name || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/, '')
      .trim();
    if (!n) n = 'file';
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = `_${n}`;
    return n.length > 150 ? n.slice(0, 150) : n;
  }

  // For a file that arrives with only a name (copied in Explorer). Only what
  // matters for showing it: pictures get a thumbnail, the rest open by name.
  const TYPES_BY_EXT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    mp4: 'video/mp4'
  };

  function typeFromName(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return TYPES_BY_EXT[ext] || 'application/octet-stream';
  }

  const api = {
    MAX_BYTES,
    MAX_FILES,
    isImage,
    attachmentsOf,
    formatSize,
    summary,
    previewText,
    checkFiles,
    nameForPaste,
    safeDiskName,
    typeFromName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatFiles = api;
})(typeof window !== 'undefined' ? window : this);
