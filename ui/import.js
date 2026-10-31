const api = (cmd, arg) => fetch('/api/' + cmd, { method: 'POST', body: JSON.stringify(arg || {}) }).then((r) => r.json());
const status = document.getElementById('status');

async function run(i, name) {
  status.textContent = `Importing from ${name}…`;
  const r = await api('import.run', { i });
  status.textContent = r.error
    ? `${name}: ${r.error}`
    : `${name}: ${r.bookmarks.toLocaleString()} bookmarks and ${r.history.toLocaleString()} history entries imported.`;
  return r;
}

(async () => {
  const names = await api('import.list');
  document.getElementById('none').hidden = names.length > 0;
  document.getElementById('profiles').replaceChildren(...names.map((name, i) => {
    const li = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { textContent: 'Import' });
    b.addEventListener('click', () => { b.disabled = true; run(i, name); });
    li.append(Object.assign(document.createElement('span'), { textContent: name }), b);
    return li;
  }));
  // bench/import_test.sh opens tobari://import/#all to import every profile without clicks.
  if (location.hash === '#all') {
    for (let i = 0; i < names.length; i++) await run(i, names[i]);
    document.title = 'Import done';
  }
})();
