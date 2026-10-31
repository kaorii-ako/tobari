// Assistant panel. The shell streams replies back through T.aiText / T.aiDone; chats live only in this page.
'use strict';
(() => {
  const log = $('#ai-log'), input = $('.ai-input textarea'), setup = $('#ai-setup'), skillsEl = $('#ai-skills');
  const SKILLS = [
    ['summarize', 'Summarize', 'Summarize this page in a short paragraph, then list the main points.'],
    ['explain', 'Explain simply', 'Explain this page so someone new to the topic understands it.'],
    ['keypoints', 'Key points', 'List the key points and any numbers, dates or names worth remembering.'],
    ['english', 'Translate to English', 'Translate the main text of this page into English.'],
    ['thai', 'แปลเป็นไทย', 'แปลเนื้อหาหลักของหน้านี้เป็นภาษาไทย'],
    ['japanese', '日本語に翻訳', 'このページの本文を日本語に翻訳してください。'],
    ['questions', 'Questions to ask', 'What questions should I ask to check whether this page is right?'],
    ['critique', 'Check the claims', 'Which claims on this page are unsupported, one-sided or likely wrong? Say why.'],
    ['reply', 'Draft a reply', 'Draft a short, polite reply to this page (email, post or comment).'],
    ['actions', 'To-do list', 'Turn this page into a list of concrete next steps.'],
  ];
  let chat = [], busy = false, reply = null, cfg = null, pick = 0;

  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  const activeTab = () => T.s.tabs.find((t) => t.id === (T.s.focus || T.s.active));
  const pageOk = () => /^https?:/.test(activeTab()?.url || '');

  async function loadCfg() {
    cfg = await T.api('ai.config');
    const b = $('#ai-model');
    b.textContent = cfg.model ? `${cfg.model} · ${cfg.local ? 'on this device' : cfg.host}` : 'Choose a model';
    b.title = cfg.local ? 'Prompts stay on this computer' : `Prompts and the page are sent to ${cfg.host}`;
  }

  function openSetup() {
    setup.hidden = false;
    $('#ai-url').value = cfg.url;
    $('#ai-m').value = cfg.model;
    $('#ai-key').value = '';
    $('#ai-key').placeholder = cfg.hasKey ? 'Saved. Type to replace' : 'Not needed on this computer';
    $('#ai-err').textContent = '';
    where();
    T.api('ai.models');
    $('#ai-url').focus();
  }
  function where() {
    const u = $('#ai-url').value;
    $('#ai-where').textContent = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(u)
      ? 'Runs on this computer. Nothing leaves it.'
      : `Your messages, and the page when "Use this page" is on, are sent to ${u.replace(/^https?:\/\//, '').split('/')[0] || 'this server'}.`;
  }
  T.aiModels = (ids) => {
    $('#ai-ms').replaceChildren(...ids.map((id) => Object.assign(document.createElement('option'), { value: id })));
    if (!$('#ai-m').value && ids.length) $('#ai-m').value = ids[0];
  };
  $('#ai-url').addEventListener('input', where);
  $('#ai-url').addEventListener('change', async () => {  // list the new server's models
    await T.api('ai.set', { url: $('#ai-url').value, model: $('#ai-m').value });
    T.api('ai.models');
  });
  $('#ai-model').addEventListener('click', () => (setup.hidden ? openSetup() : (setup.hidden = true)));
  $('#ai-cancel').addEventListener('click', () => { setup.hidden = true; input.focus(); });
  setup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const arg = { url: $('#ai-url').value.trim(), model: $('#ai-m').value.trim() };
    if ($('#ai-key').value) arg.key = $('#ai-key').value.trim();
    const r = await T.api('ai.set', arg);
    if (r.error) { $('#ai-err').textContent = r.error; return; }
    setup.hidden = true;
    await loadCfg();
    input.focus();
  });

  function add(role, text) {
    log.querySelectorAll('.ai-hint').forEach((h) => h.remove());
    const m = el('div', 'msg ' + role, text);
    log.append(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }
  function setBusy(b) {
    busy = b;
    $('#ai-stop').hidden = !b;
    input.placeholder = b ? 'Answering…' : 'Ask about this page';
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    if (!cfg?.model) { openSetup(); return; }
    const page = $('#ai-page').checked && pageOk();
    add('user', text).dataset.page = page ? activeTab().title || activeTab().url : '';
    chat.push({ role: 'user', content: text });
    reply = add('assistant', '');
    reply.classList.add('pending');
    setBusy(true);
    T.api('ai.send', { messages: chat, page });
  }
  T.aiText = (t) => {
    if (!reply) return;
    reply.classList.remove('pending');
    reply.textContent += t;
    log.scrollTop = log.scrollHeight;
  };
  T.aiDone = (err) => {
    if (!reply) return;
    reply.classList.remove('pending');
    if (reply.textContent) chat.push({ role: 'assistant', content: reply.textContent });
    if (err) reply.append(el('span', 'ai-err', (reply.textContent ? '\n' : '') + err));
    reply = null;
    setBusy(false);
  };
  function stop() {
    T.api('ai.stop');
    T.aiDone('Stopped.');
  }
  $('#ai-stop').addEventListener('click', stop);
  $('#ai-new').addEventListener('click', () => {
    if (busy) stop();
    chat = [];
    log.replaceChildren(el('p', 'ai-hint', 'New chat. Type / for a skill.'));
    input.focus();
  });

  // "/" skills: a filtered list above the input; Enter or Tab picks one.
  function matches() {
    const q = input.value.slice(1).toLowerCase();
    return SKILLS.filter(([k, name]) => k.startsWith(q) || name.toLowerCase().includes(q));
  }
  function showSkills() {
    const list = input.value.startsWith('/') && !input.value.includes('\n') ? matches() : [];
    skillsEl.hidden = !list.length;
    pick = Math.min(pick, Math.max(0, list.length - 1));
    skillsEl.replaceChildren(...list.map(([k, name], i) => {
      const li = el('li', i === pick ? 'on' : '', '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === pick);
      li.append(el('b', '', '/' + k), el('span', '', name));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); useSkill(list[i]); });
      return li;
    }));
    return list;
  }
  function useSkill(s) {
    input.value = '';
    skillsEl.hidden = true;
    send(s[2]);
  }
  input.addEventListener('input', () => { pick = 0; showSkills(); });
  input.addEventListener('keydown', (e) => {
    const list = skillsEl.hidden ? [] : matches();
    if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      pick = (pick + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
      showSkills();
    } else if (list.length && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      e.preventDefault();
      useSkill(list[pick]);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const t = input.value;
      input.value = '';
      send(t);
    } else if (e.key === 'Escape') {
      if (busy) stop();
      else if (!skillsEl.hidden) skillsEl.hidden = true;
    }
  });
  $('#ai-form').addEventListener('submit', (e) => e.preventDefault());

  // Called by render() on every state push: the page switch only applies to web pages.
  T.aiRender = () => {
    $('#ai-page').disabled = !pageOk();
    $('.ai-page').title = pageOk() ? activeTab().title || '' : 'Built-in pages are never sent';
  };
  T.aiSend = send;
  loadCfg();
})();
