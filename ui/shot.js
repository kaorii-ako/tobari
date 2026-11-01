// Screenshot annotator: the shell captured the page; draw on it here, then save or copy. All drawing is local.
'use strict';
const api = (cmd, body) => fetch('/api/' + cmd, { method: 'POST', body: JSON.stringify(body || {}) }).then((r) => r.json());
const cv = document.getElementById('c'), cx = cv.getContext('2d');
const $ = (s) => document.querySelector(s);
const done = []; // snapshots for undo
let base = null, tool = 'pen', start = null, snap = null;

api('shot.get').then((r) => {
  if (!r.data) { $('#msg').textContent = 'No screenshot.'; return; }
  base = new Image();
  base.onload = () => { cv.width = base.width; cv.height = base.height; cx.drawImage(base, 0, 0); };
  base.src = 'data:image/png;base64,' + r.data;
});

for (const b of document.querySelectorAll('[data-tool]'))
  b.onclick = () => { tool = b.dataset.tool; document.querySelectorAll('[data-tool]').forEach((o) => o.setAttribute('aria-pressed', o === b)); };

const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };

function shape(a, b) {
  cx.strokeStyle = '#e5322d'; cx.fillStyle = '#e5322d'; cx.lineWidth = Math.max(3, cv.width / 400); cx.lineCap = 'round'; cx.lineJoin = 'round';
  if (tool === 'box') cx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  else if (tool === 'blur') { // pixelate: shrink then scale up, so hidden text can't be read back
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
    if (w < 2 || h < 2) return;
    const t = document.createElement('canvas'); t.width = Math.max(1, w / 12); t.height = Math.max(1, h / 12);
    t.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, t.width, t.height);
    cx.imageSmoothingEnabled = false; cx.drawImage(t, 0, 0, t.width, t.height, x, y, w, h); cx.imageSmoothingEnabled = true;
  } else if (tool === 'arrow') {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = cx.lineWidth * 5;
    cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.stroke();
    cx.beginPath(); cx.moveTo(b[0], b[1]);
    cx.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45));
    cx.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45));
    cx.closePath(); cx.fill();
  }
}

cv.onpointerdown = (e) => {
  if (!base) return;
  cv.setPointerCapture(e.pointerId);
  start = pos(e); snap = cx.getImageData(0, 0, cv.width, cv.height);
  if (tool === 'pen') { cx.strokeStyle = '#e5322d'; cx.lineWidth = Math.max(3, cv.width / 400); cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(start[0], start[1]); }
};
cv.onpointermove = (e) => {
  if (!start) return;
  const p = pos(e);
  if (tool === 'pen') { cx.lineTo(p[0], p[1]); cx.stroke(); return; }
  cx.putImageData(snap, 0, 0); shape(start, p);
};
cv.onpointerup = (e) => {
  if (!start) return;
  if (tool !== 'pen') { cx.putImageData(snap, 0, 0); shape(start, pos(e)); }
  done.push(snap); start = snap = null;
};
$('#undo').onclick = () => { const s = done.pop(); if (s) cx.putImageData(s, 0, 0); };

const png = () => new Promise((ok) => cv.toBlob(ok, 'image/png'));
const say = (t) => { $('#msg').textContent = t; };
$('#copy').onclick = async () => {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await png() })]); say('Copied'); } catch { say('Copy not allowed here. Use Save.'); }
};
$('#save').onclick = async () => {
  const url = cv.toDataURL('image/png').split(',')[1];
  const r = await api('shot.save', { data: url });
  say(r.error || 'Saved to Downloads');
};
