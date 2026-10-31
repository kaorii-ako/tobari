const api = (cmd, arg) => fetch('/api/' + cmd, { method: 'POST', body: JSON.stringify(arg || {}) }).then((r) => r.json());
const $ = (s) => document.querySelector(s);

(async () => {
  const s = await api('welcome.state');
  if (s.profile !== 'Default') $('#prof').textContent = `This is the “${s.profile}” profile.`;
  for (const g of ['theme', 'search']) {
    document.querySelector(`input[name=${g}][value="${s[g]}"]`).checked = true;
    $('#' + g).addEventListener('change', (e) => api('welcome.' + g, { value: e.target.value }));
  }
  $('#ai-url').value = s.ai.url || 'http://127.0.0.1:11434/v1';
  $('#ai-model').value = s.ai.model || '';

  const names = await api('welcome.import.list');
  $('#none').hidden = names.length > 0;
  $('#profiles').replaceChildren(...names.map((name, i) => {
    const li = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { textContent: 'Import' });
    b.addEventListener('click', async () => {
      b.disabled = true;
      $('#istatus').textContent = `Importing from ${name}…`;
      const r = await api('welcome.import.run', { i });
      $('#istatus').textContent = r.error ? `${name}: ${r.error}`
        : `${name}: ${r.bookmarks.toLocaleString()} bookmarks and ${r.history.toLocaleString()} history entries imported.`;
    });
    li.append(Object.assign(document.createElement('span'), { textContent: name }), b);
    return li;
  }));
})();

$('#ai').addEventListener('submit', async (e) => {
  e.preventDefault();
  const arg = { url: $('#ai-url').value.trim(), model: $('#ai-model').value.trim() };
  if ($('#ai-key').value) arg.key = $('#ai-key').value;
  const r = await api('welcome.ai', arg);
  $('#aistatus').textContent = r.error || 'Saved. Open the assistant with Alt J; it lists the models it finds there.';
  $('#ai-key').value = '';
});
