fetch('/api/bangs.list', { method: 'POST', body: '{}' }).then((r) => r.json()).then((list) => {
  document.querySelector('#bangs tbody').replaceChildren(...list.map((b) => {
    const tr = document.createElement('tr');
    tr.append(document.createElement('td'), document.createElement('td'));
    tr.cells[0].append(Object.assign(document.createElement('kbd'), { textContent: '!' + b.key }));
    tr.cells[1].textContent = b.name;
    return tr;
  }));
});
