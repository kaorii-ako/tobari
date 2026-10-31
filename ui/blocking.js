const api = (cmd, arg) => fetch('/api/' + cmd, { method: 'POST', body: JSON.stringify(arg || {}) }).then((r) => r.json());
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function load() {
  const s = await api('blocking.status');
  document.getElementById('count').textContent = s.blocked.toLocaleString();
  document.querySelector('#lists tbody').replaceChildren(...s.lists.map((l) => {
    const tr = document.createElement('tr');
    const a = Object.assign(document.createElement('a'), { href: l.url, textContent: l.name });
    tr.append(document.createElement('td'), document.createElement('td'), document.createElement('td'));
    tr.cells[0].append(a);
    tr.cells[1].textContent = l.rules ? l.rules.toLocaleString() : '—';
    tr.cells[2].textContent = l.updated ? fmt.format(l.updated * 1000) : 'Not yet';
    return tr;
  }));
  document.getElementById('none').hidden = s.off.length > 0;
  document.getElementById('off').replaceChildren(...s.off.map((site) => {
    const li = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { textContent: 'Turn on' });
    b.addEventListener('click', () => api('blocking.site', { site, on: true }).then(load));
    li.append(Object.assign(document.createElement('span'), { textContent: site }), b);
    return li;
  }));
}
load();
