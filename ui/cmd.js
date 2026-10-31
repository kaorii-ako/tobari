// Command bar: one input for commands, addresses, search, open tabs and history. Runs in the frame's renderer.
'use strict';

const T = window.opener.T;
const q = document.getElementById('q');
const list = document.getElementById('list');
let mode = 'cmd', items = [], sel = 0, seq = 0, shown = false;

const COMMANDS = [
  ['New tab', 'Ctrl T', () => C.open('newtab')],
  ['Close tab', 'Ctrl W', () => T.run('close')],
  ['Toggle assistant', 'Alt J', () => T.run('ai')],
  ['Compact mode', 'Alt S', () => T.run('compact')],
  ['Split view', 'Alt \\', () => T.run('split')],
  ['Find in page', 'Ctrl F', () => T.run('find')],
  ['Reload', 'Ctrl R', () => T.run('reload')],
  ['Back', 'Alt ←', () => T.run('back')],
  ['Forward', 'Alt →', () => T.run('forward')],
  ['Developer tools', 'F12', () => T.run('devtools')],
  ['Theme: light', '', () => T.run('theme', 'light')],
  ['Theme: dark', '', () => T.run('theme', 'dark')],
  ['Theme: follow system', '', () => T.run('theme', 'system')],
  ['Blocking and privacy', '', () => T.api('tab.new', { url: 'tobari://blocking/' })],
  ['Bangs', '', () => T.api('tab.new', { url: 'tobari://bangs/' })],
  ['About Tobari', '', () => T.api('tab.new', { url: 'tobari://about/' })],
];

const C = (window.C = {
  open(m) {
    mode = m;
    shown = true;
    const cur = T.s.tabs.find((t) => t.id === (T.s.focus || T.s.active));
    q.value = mode === 'address' && cur ? cur.url : '';
    q.placeholder = { cmd: 'Type a command, address or search', newtab: 'Search or enter address', address: 'Search or enter address' }[mode];
    document.getElementById('mode').textContent = { cmd: 'Alt K', newtab: 'New tab', address: 'Current tab' }[mode];
    q.focus();
    q.select();
    update();
  },
});

function close() {
  if (!shown) return;
  shown = false;
  T.api('cmd', { open: false });
}

const has = (hay, words) => words.every((w) => hay.toLowerCase().includes(w));
const looksLikeUrl = (s) => /^[a-z][a-z0-9+.-]*:/i.test(s) || (!/\s/.test(s) && /\.[a-z]{2,}(\/|:|$)/i.test(s)) || /^localhost(:|\/|$)/.test(s);

function go(text) {
  if (mode === 'address') T.api('go', { text });
  else T.api('tab.new', { url: text });
}

async function update() {
  const text = q.value.trim();
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const my = ++seq;
  const out = [];
  if (text) {
    out.push({ group: '', label: looksLikeUrl(text) ? text : `Search for “${text}”`, hint: looksLikeUrl(text) ? 'Open' : 'DuckDuckGo', ic: '→', run: () => go(text) });
    if (T.ui.spaces.every((w) => w !== text) && mode === 'cmd')
      out.push({ group: '', label: `Create workspace “${text}”`, hint: 'Workspace', ic: '+', run: () => T.run('ws', text) });
  }
  const cmds = COMMANDS.filter(([label]) => has(label, words)).map(([label, key, fn]) => ({ group: 'Commands', label, hint: key, ic: '›', run: fn }));
  for (const ws of T.ui.spaces)
    if (ws !== T.s.ws) {
      if (has('workspace ' + ws, words)) cmds.push({ group: 'Commands', label: `Go to workspace “${ws}”`, hint: '', ic: '›', run: () => T.run('ws', ws) });
      if (has('move tab ' + ws, words) && T.s.active) cmds.push({ group: 'Commands', label: `Move tab to “${ws}”`, hint: '', ic: '›', run: () => T.run('move-ws', ws) });
    }
  const tabs = T.s.tabs
    .filter((t) => t.id !== T.s.active && words.length && has(t.title + ' ' + t.url, words))
    .slice(0, 6)
    .map((t) => ({ group: 'Open tabs', label: t.title || t.url, hint: t.ws === T.s.ws ? hostOf(t.url) : t.ws, icon: t.icon, url: t.url, run: () => T.api('tab.select', { id: t.id }) }));
  if (mode === 'cmd' && !text) out.push(...cmds);
  out.push(...tabs);
  const history = mode === 'cmd' && !text ? [] : await T.api('history', { q: text }).catch(() => []);
  if (my !== seq) return;
  const open = new Set(T.s.tabs.map((t) => t.url));
  out.push(...history.filter((h) => !open.has(h.url)).map((h) => ({ group: 'History', label: h.title || h.url, hint: hostOf(h.url), url: h.url, run: () => go(h.url) })));
  if (mode === 'cmd' && text) out.push(...cmds);
  items = out;
  sel = 0;
  draw();
}

function hostOf(u) {
  try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; }
}

function draw() {
  list.textContent = '';
  let group = null;
  items.forEach((it, i) => {
    if (it.group !== group && it.group) {
      const g = document.createElement('li');
      g.className = 'group';
      g.setAttribute('role', 'presentation');
      g.textContent = it.group;
      list.append(g);
    }
    group = it.group;
    const li = document.createElement('li');
    li.className = 'item';
    li.id = 'it' + i;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === sel);
    const ic = document.createElement('span');
    ic.className = 'ic';
    if (it.icon) {
      const img = new Image();
      img.alt = '';
      img.src = it.icon;
      img.onerror = () => { img.remove(); ic.classList.add('letter'); ic.textContent = hostOf(it.url)[0].toUpperCase(); };
      ic.append(img);
    } else if (it.url) {
      ic.classList.add('letter');
      ic.textContent = (hostOf(it.url)[0] || '·').toUpperCase();
    } else {
      ic.textContent = it.ic;
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = it.label;
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = it.hint || '';
    li.append(ic, label, hint);
    li.onmousemove = () => { if (sel !== i) { sel = i; mark(); } };
    li.onclick = () => choose(i);
    list.append(li);
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'No matches';
    list.append(li);
  }
  q.setAttribute('aria-activedescendant', items.length ? 'it' + sel : '');
}

function mark() {
  list.querySelectorAll('.item').forEach((li, i) => li.setAttribute('aria-selected', i === sel));
  q.setAttribute('aria-activedescendant', 'it' + sel);
  document.getElementById('it' + sel)?.scrollIntoView({ block: 'nearest' });
}

function choose(i) {
  const it = items[i];
  if (!it) return;
  close();
  it.run();
}

q.addEventListener('input', update);
q.addEventListener('keydown', (e) => {
  const step = { ArrowDown: 1, ArrowUp: -1, Tab: e.shiftKey ? -1 : 1 }[e.key];
  if (step && items.length) {
    e.preventDefault();
    sel = (sel + step + items.length) % items.length;
    mark();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(sel);
  } else if (e.key === 'Escape') {
    close();
  }
});
// Clicking anywhere outside the bar (a page or the frame) closes it.
window.addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 50));
