'use strict';

// The leave card's page. It draws what it is given, sends the decision, and
// tells the main process how tall it is so the window fits it. All text goes
// in with textContent, so nothing a person typed can become markup.

(function () {
  const api = window.acomsLeaveCard;
  const $ = (id) => document.getElementById(id);
  const card = $('card');
  let busy = false;
  let firstName = 'They';

  function fit() {
    // After the browser has laid the change out.
    requestAnimationFrame(() => api.height(Math.ceil(card.getBoundingClientRect().height)));
  }

  function say(text, ok) {
    const el = $('message');
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('ok', !!ok);
    fit();
  }

  function setBusy(on) {
    busy = on;
    for (const id of ['approve', 'reject', 'back']) $(id).disabled = on;
    $('send-reject').disabled = on || !$('why').value.trim();
  }

  async function decide(decision) {
    if (busy) return;
    const comment = $('why').value.trim();
    if (decision === 'reject' && !comment) {
      say('Say why it is rejected. One line is enough.');
      return;
    }
    setBusy(true);
    say('');
    let result;
    try {
      result = await api.decide(decision, comment);
    } catch {
      result = { ok: false, message: 'That did not go through. Try again.' };
    }
    if (!result || !result.ok) {
      setBusy(false);
      say((result && result.message) || 'That did not go through. Try again.');
      return;
    }
    // Done. The main process closes the card in a moment.
    $('buttons').hidden = true;
    $('rejecting').hidden = true;
    say(result.message || (decision === 'approve' ? 'Approved.' : 'Rejected.'), true);
  }

  api.onShow((c) => {
    firstName = c.firstName || 'They';
    const who = $('who');
    who.textContent = '';
    who.append(c.name || 'Someone');
    const type = document.createElement('span');
    type.className = 'type';
    type.textContent = ` · ${c.leaveType || 'Leave'}`;
    who.append(type);

    const lines = $('lines');
    lines.textContent = '';
    (c.lines || []).forEach((text) => {
      const div = document.createElement('div');
      div.textContent = text;
      if (/^Asks to /.test(text)) div.className = 'change';
      lines.append(div);
    });

    $('note').textContent = c.note ? `Note: ${c.note}` : '';
    $('note').hidden = !c.note;
    $('others').textContent = c.othersOff || '';
    $('others').hidden = !c.othersOff;
    $('escalated').hidden = !c.escalated;
    $('why-label').textContent = `Why is it rejected? ${firstName} will see this.`;
    fit();
  });

  $('approve').addEventListener('click', () => decide('approve'));
  $('reject').addEventListener('click', () => {
    if (busy) return;
    $('buttons').hidden = true;
    $('rejecting').hidden = false;
    say('');
    $('why').focus();
    fit();
  });
  $('back').addEventListener('click', () => {
    if (busy) return;
    $('rejecting').hidden = true;
    $('buttons').hidden = false;
    $('why').value = '';
    $('send-reject').disabled = true;
    say('');
  });
  $('why').addEventListener('input', () => {
    $('send-reject').disabled = busy || !$('why').value.trim();
  });
  $('send-reject').addEventListener('click', () => decide('reject'));
  $('later').addEventListener('click', () => api.later());
  $('open').addEventListener('click', () => api.openPage());
})();
