const url = decodeURIComponent(location.hash.slice(1));
document.getElementById('host').textContent = (() => { try { return new URL(url).host; } catch { return url; } })();
document.getElementById('back').addEventListener('click', () => history.length > 2 ? history.go(-2) : history.back());
document.getElementById('go').addEventListener('click', () =>
  fetch('/api/https.allow', { method: 'POST', body: JSON.stringify({ url }) }));
