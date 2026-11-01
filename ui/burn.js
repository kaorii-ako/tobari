// Hold to burn: 1.6 s of continuous press (pointer or Enter/Space) calls the burn API. Leaving the
// button, releasing early, blurring or a second pointer cancels. Technique after dqnamo's Kitchen.
const btn = document.getElementById('hold');
const HOLD = 1600;
let timer = 0, pointer = null;

function start() {
  if (timer || btn.classList.contains('done')) return;
  btn.classList.add('holding');
  timer = setTimeout(done, HOLD);
}
function cancel() {
  clearTimeout(timer);
  timer = 0;
  pointer = null;
  btn.classList.remove('holding');
}
function done() {
  timer = 0;
  btn.classList.replace('holding', 'done');
  btn.firstChild.textContent = btn.lastChild.textContent = 'Burning…';
  document.getElementById('note').textContent = 'Closing and wiping. Tobari opens again in a moment.';
  fetch('/api/burn', { method: 'POST', body: '{}' });
}

btn.style.setProperty('--hold', HOLD + 'ms');
btn.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || e.button !== 0) return;
  pointer = e.pointerId;
  btn.setPointerCapture(e.pointerId);
  start();
});
btn.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointer) return;
  const r = btn.getBoundingClientRect(), pad = 8;
  if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) cancel();
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) btn.addEventListener(ev, cancel);
btn.addEventListener('keydown', (e) => {
  if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  start();
});
btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cancel(); } });
