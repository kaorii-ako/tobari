// Frame UI. The shell pushes state with T.state(); everything the user does goes back through T.api().
'use strict';

const $ = (s) => document.querySelector(s);
const app = $('#app');

const T = (window.T = {
  s: { tabs: [], active: 0, split: 0, focus: 0, ws: 'main', maximized: false },
  ui: { theme: 'system', compact: false, ai: false, aiW: 380, spaces: ['main'] },
  cmdWin: null,

  api(cmd, arg = {}) {
    return fetch('tobari://ui/api/' + cmd, { method: 'POST', body: JSON.stringify(arg) }).then((r) => r.json());
  },

  state(s) {
    const first = !T.loaded;
    T.loaded = true;
    T.s = s;
    if (first) {
      try { Object.assign(T.ui, JSON.parse(s.ui || '{}')); } catch {}
      applyDemo();
    }
    if (!T.ui.spaces.includes(s.ws)) T.ui.spaces.push(s.ws);
    render();
  },

  key(name) {
    const tab = /^tab(\d)$/.exec(name);
    if (tab) {
      const list = tabsHere();
      const t = name === 'tab9' ? list[list.length - 1] : list[tab[1] - 1];
      if (t) T.api('tab.select', { id: t.id });
      return;
    }
    run(name);
  },

  found(count, active) {
    $('#find-n').textContent = $('#find-q').value ? `${count ? active : 0} of ${count}` : '';
  },

  download(d) {
    let el = downloads.get(d.id);
    if (!el) {
      el = toast('', 0);
      el.append(document.createElement('progress'));
      downloads.set(d.id, el);
    }
    el.firstChild.textContent = d.failed ? `Download failed: ${d.name}` : d.done ? `Saved ${d.name} to Downloads` : `Downloading ${d.name}`;
    el.querySelector('progress').value = d.percent / 100;
    if (d.done || d.failed) {
      el.querySelector('progress').remove();
      downloads.delete(d.id);
      setTimeout(() => dismiss(el), 4000);
    }
  },

  toast: (msg) => toast(msg, 4000),
  run: (name, arg) => run(name, arg),
  saveUi,
});
const downloads = new Map();

function saveUi() {
  T.api('ui.save', { blob: JSON.stringify(T.ui) });
}

function current() {
  return T.s.tabs.find((t) => t.id === (T.s.focus || T.s.active));
}

function tabsHere() {
  return T.s.tabs.filter((t) => t.ws === T.s.ws);
}

// ---- Rendering --------------------------------------------------------------------------------------------

let appliedTheme = '';
function render() {
  document.documentElement.dataset.theme = T.ui.theme === 'system' ? '' : T.ui.theme;
  if (appliedTheme !== T.ui.theme) T.api('theme', { mode: (appliedTheme = T.ui.theme) });
  app.classList.toggle('compact', !!T.ui.compact);
  app.classList.toggle('ai-open', !!T.ui.ai);
  app.style.setProperty('--ai-w', T.ui.aiW + 'px');
  $('#ai').hidden = !T.ui.ai;
  $('#ai-btn').setAttribute('aria-pressed', !!T.ui.ai);
  // The assistant's code loads on first open, so a browser that never uses it pays nothing for it.
  if (T.ui.ai && !T.aiLoaded) { T.aiLoaded = true; document.body.append(Object.assign(document.createElement('script'), { src: 'ai.js' })); }
  if (T.aiRender) T.aiRender();
  $('#split-btn').setAttribute('aria-pressed', !!T.s.split);
  $('#pane-split').hidden = !T.s.split;
  $('[data-act="win-max"]').setAttribute('aria-label', T.s.maximized ? 'Restore' : 'Maximize');

  renderTabs();
  renderSpaces();

  const t = current();
  $('#empty').hidden = !!T.s.active;
  $('#empty-ws').textContent = T.s.ws;
  const url = t ? parseUrl(t.url) : null;
  $('#addr-host').textContent = url ? url.host : '';
  $('#addr-path').textContent = url ? url.rest : t ? '' : 'Search or enter address';
  $('#address .lock').style.display = url && url.secure ? '' : 'none';
  const web = !!t && /^https?:/.test(t.url);
  $('#shield').hidden = !web || !$('#find').hidden;
  if (web) {
    $('#shield').classList.toggle('off', !t.shield);
    $('#shield-n').textContent = t.shield ? t.blocked : 'Off';
    const what = t.shield ? `${t.blocked} request${t.blocked === 1 ? '' : 's'} blocked on this page` : 'Blocking is off for this site';
    $('#shield').title = what;
    $('#shield').setAttribute('aria-label', `${what}. Turn blocking ${t.shield ? 'off' : 'on'} for this site`);
  }
  $('[data-act="back"]').disabled = !t || !t.back;
  $('[data-act="forward"]').disabled = !t || !t.forward;
  $('#reload use').setAttribute('href', t && t.loading ? '#i-stop' : '#i-reload');
  document.title = t ? t.title : 'Tobari';
  layout();
}

function parseUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === 'tobari:') return { host: 'tobari://' + u.host, rest: u.pathname === '/' ? '' : u.pathname, secure: true };
    if (!u.host) return { host: raw, rest: '' };
    let rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
    try { rest = decodeURI(rest); } catch {}  // show ภาษาไทย, not %E0%B8...
    return { host: u.host.replace(/^www\./, ''), rest, secure: u.protocol === 'https:' };
  } catch {
    return { host: raw, rest: '' };
  }
}

const seen = new Set();
function renderTabs() {
  const ol = $('#tabs');
  const list = tabsHere();
  const rows = new Map([...ol.children].map((li) => [+li.dataset.id, li]));
  list.forEach((t, i) => {
    let li = rows.get(t.id);
    if (!li) {
      li = tabRow(t);
      // Only tabs opened while the window is up animate in; a restored session appears at once.
      if (T.rendered && !seen.has(t.id)) {
        li.classList.add('enter');
        requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('enter')));
      }
    }
    seen.add(t.id);
    rows.delete(t.id);
    updateRow(li, t);
    if (ol.children[i] !== li) ol.insertBefore(li, ol.children[i] || null);
  });
  rows.forEach((li) => li.remove());
  T.rendered = true;
}

function tabRow(t) {
  const li = document.createElement('li');
  li.className = 'tab';
  li.dataset.id = t.id;
  li.setAttribute('role', 'option');
  li.draggable = true;
  li.innerHTML = '<span class="fav"></span><span class="title"></span>' +
    '<button class="icon x" aria-label="Close tab" tabindex="-1"><svg><use href="#i-close"/></svg></button>';
  return li;
}

function updateRow(li, t) {
  li.setAttribute('aria-selected', t.id === T.s.active);
  li.classList.toggle('split-side', t.id === T.s.split);
  li.classList.toggle('sleeping', t.sleeping);
  li.title = t.title + '\n' + t.url;
  li.querySelector('.title').textContent = t.title || t.url || 'New tab';
  const fav = li.querySelector('.fav');
  const key = t.loading ? 'loading' : t.icon || 'letter:' + (parseUrl(t.url).host[0] || '·');
  if (fav.dataset.key === key) return;
  fav.dataset.key = key;
  fav.className = 'fav';
  fav.textContent = '';
  if (t.loading) {
    fav.classList.add('loading');
  } else if (t.icon) {
    const img = new Image();
    img.alt = '';
    img.onerror = () => { fav.dataset.key = ''; t.icon = ''; updateRow(li, t); };
    img.src = t.icon;
    fav.append(img);
  } else {
    fav.classList.add('letter');
    fav.textContent = key.slice(7).toUpperCase();
  }
}

function renderSpaces() {
  const nav = $('#spaces');
  nav.textContent = '';
  for (const ws of T.ui.spaces) {
    const b = document.createElement('button');
    b.className = 'space';
    b.textContent = ws;
    b.setAttribute('aria-current', ws === T.s.ws);
    b.onclick = () => T.api('ws', { ws });
    nav.append(b);
  }
}

// Tells the shell where to draw the page views. Rects are in CSS pixels, which match the window's DIPs.
let lastLayout = '';
function layout() {
  const inner = (el) => {
    if (el.hidden) return [0, 0, 0, 0];
    const r = el.getBoundingClientRect();
    return [Math.round(r.left) + 1, Math.round(r.top) + 1, Math.round(r.width) - 2, Math.round(r.height) - 2];
  };
  const w = Math.min(640, innerWidth - 48);
  const arg = { main: inner($('#pane-main')), split: inner($('#pane-split')), cmd: [Math.round((innerWidth - w) / 2), 64, w, 440] };
  const key = JSON.stringify(arg);
  if (key === lastLayout) return;
  lastLayout = key;
  T.api('layout', arg);
}
new ResizeObserver(layout).observe($('#card'));

// ---- Actions ----------------------------------------------------------------------------------------------

function run(name, arg) {
  const t = current();
  switch (name) {
    case 'cmd': case 'newtab': case 'address': return openCmd(name);
    case 'close': return t && T.api('tab.close', { id: t.id });
    case 'shield': return t && T.api('shield', { on: !t.shield });
    case 'ai':
      T.ui.ai = !T.ui.ai;
      render();
      saveUi();
      if (T.ui.ai) { T.api('focus', { on: 'frame' }); $('.ai-input textarea').focus(); }
      return;
    case 'compact':
      T.ui.compact = !T.ui.compact;
      app.classList.remove('peek');
      render();
      return saveUi();
    case 'split': {
      if (T.s.split) return T.api('tab.split', { with: 0 });
      // Pair the active tab with the most recent other tab in this workspace.
      const other = tabsHere().filter((x) => x.id !== T.s.active);
      if (!other.length) return T.toast('Open another tab to split the view');
      return T.api('tab.split', { with: (arg && arg.with) || other[0].id });
    }
    case 'next': case 'prev': {
      const list = tabsHere();
      const i = list.findIndex((x) => x.id === T.s.active);
      if (list.length) T.api('tab.select', { id: list[(i + (name === 'next' ? 1 : list.length - 1)) % list.length].id });
      return;
    }
    case 'reload': return t && T.api('nav', { op: t.loading ? 'stop' : 'reload' });
    case 'back': case 'forward': return T.api('nav', { op: name });
    case 'find': return openFind();
    case 'devtools': return T.api('devtools');
    case 'theme': T.ui.theme = arg; render(); return saveUi();
    case 'ws':
      if (!T.ui.spaces.includes(arg)) { T.ui.spaces.push(arg); saveUi(); }
      return T.api('ws', { ws: arg });
    case 'move-ws':
      if (!T.ui.spaces.includes(arg)) { T.ui.spaces.push(arg); saveUi(); }
      return t && T.api('tab.ws', { id: t.id, ws: arg });
    case 'sleep': return arg && T.api('tab.sleep', { id: arg });
  }
}

// The command bar is a popup that shares this renderer; the shell shows it over the page views.
function openCmd(mode) {
  if (!T.cmdWin || T.cmdWin.closed) T.cmdWin = window.open('cmd.html', 'cmd');
  const go = () => {
    if (!T.cmdWin.C) return setTimeout(go, 16);
    T.cmdWin.C.open(mode);
    T.api('cmd', { open: true });
  };
  go();
}

function openFind() {
  $('#address').hidden = true;
  $('#find').hidden = false;
  render();
  T.api('focus', { on: 'frame' });
  $('#find-q').focus();
  $('#find-q').select();
}

function closeFind() {
  $('#find').hidden = true;
  $('#address').hidden = false;
  render();
  $('#find-n').textContent = '';
  T.api('find.stop');
  T.api('focus', { on: 'page' });
}

$('#find-q').addEventListener('input', (e) => {
  if (e.target.value) T.api('find', { text: e.target.value });
  else { T.api('find.stop'); T.found(0, 0); }
});
$('#find-q').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFind();
  if (e.key === 'Enter') { e.preventDefault(); T.api('find', { text: e.target.value, back: e.shiftKey, next: true }); }
});

document.addEventListener('click', (e) => {
  const x = e.target.closest('.tab .x');
  if (x) return T.api('tab.close', { id: +x.closest('.tab').dataset.id });
  const tab = e.target.closest('.tab');
  if (tab) return T.api('tab.select', { id: +tab.dataset.id });
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act.startsWith('win-')) return T.api('win', { op: act.slice(4) });
  if (act === 'find-close') return closeFind();
  if (act === 'find-next' || act === 'find-prev') return T.api('find', { text: $('#find-q').value, back: act === 'find-prev', next: true });
  run(act);
});

// Middle click closes a tab, as in every other browser.
document.addEventListener('auxclick', (e) => {
  const tab = e.button === 1 && e.target.closest('.tab');
  if (tab) T.api('tab.close', { id: +tab.dataset.id });
});

$('#top').addEventListener('dblclick', (e) => {
  if (!e.target.closest('button, form')) T.api('win', { op: 'max' });
});

// Drag a tab to reorder it.
let dragId = 0;
$('#tabs').addEventListener('dragstart', (e) => {
  dragId = +e.target.closest('.tab').dataset.id;
  e.dataTransfer.effectAllowed = 'move';
});
$('#tabs').addEventListener('dragover', (e) => {
  e.preventDefault();
  const over = e.target.closest('.tab');
  document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
  if (over && +over.dataset.id !== dragId) over.classList.add('drop-before');
});
$('#tabs').addEventListener('drop', (e) => {
  e.preventDefault();
  const over = e.target.closest('.tab');
  document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
  T.api('tab.move', { id: dragId, before: over ? +over.dataset.id : 0 });
});

// Compact mode: the edge strip shows the sidebar; leaving it hides it again after a short grace period.
let peekTimer = 0;
$('#edge').addEventListener('mouseenter', () => { clearTimeout(peekTimer); app.classList.add('peek'); layout(); });
$('#sidebar').addEventListener('mouseenter', () => clearTimeout(peekTimer));
$('#sidebar').addEventListener('mouseleave', () => {
  peekTimer = setTimeout(() => { app.classList.remove('peek'); layout(); }, 300);
});

// Assistant panel width: drag the left edge, or use the arrow keys on it.
const resizer = $('#ai-resize');
function setAiW(w) {
  T.ui.aiW = Math.max(300, Math.min(Math.round(w), innerWidth - 600));
  app.style.setProperty('--ai-w', T.ui.aiW + 'px');
  layout();
}
resizer.addEventListener('pointerdown', (e) => {
  resizer.setPointerCapture(e.pointerId);
  const right = $('#ai').getBoundingClientRect().right;
  const move = (ev) => setAiW(right - ev.clientX);
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', () => { resizer.removeEventListener('pointermove', move); saveUi(); }, { once: true });
});
resizer.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: 24, ArrowRight: -24 }[e.key];
  if (d) { setAiW(T.ui.aiW + d); saveUi(); }
});

// ---- Toasts ---------------------------------------------------------------------------------------------------

function toast(msg, ms) {
  const el = document.createElement('div');
  el.className = 'toast enter';
  el.setAttribute('role', 'status');
  el.append(document.createElement('span'));
  el.firstChild.textContent = msg;
  $('#toasts').append(el);
  app.classList.toggle('toasting', true);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
  if (ms) setTimeout(() => dismiss(el), ms);
  return el;
}

function dismiss(el) {
  el.classList.add('leave');
  setTimeout(() => { el.remove(); app.classList.toggle('toasting', !!$('#toasts').childElementCount); }, 200);
}

// ---- Screenshot demo: tobari://ui/#theme=dark&demo=ai,find,cmd,compact,split,toast ----------------------

function applyDemo() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('theme')) T.ui.theme = p.get('theme');
  const demo = (p.get('demo') || '').split(',');
  if (!p.has('demo') && !p.has('theme')) return;
  T.ui.ai = demo.includes('ai');
  T.ui.compact = demo.includes('compact');
  T.ui.spaces = ['main', 'research', 'ภาษาไทย'];
  setTimeout(() => {
    if (demo.includes('find')) { openFind(); $('#find-q').value = 'browser'; $('#find-q').dispatchEvent(new Event('input')); }
    if (demo.includes('split')) run('split');
    if (demo.includes('toast')) toast('Saved report.pdf to Downloads', 0); // stays up for the screenshot
    if (demo.includes('cmd')) openCmd('cmd');
    if (demo.includes('peek')) app.classList.add('peek');
    if (p.get('ask')) setTimeout(() => T.aiSend(p.get('ask')), 500);
  }, 1500);
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
T.api('ready');
