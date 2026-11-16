// Scroll the palette board to its last row and apply a dark palette (禅心),
// capturing both so we can eyeball the tail rows and the ink contrast.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9223;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (file) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
};
await new Promise((r) => ws.addEventListener('open', r));

const scrolled = await evaluate(`(() => {
  const s = document.querySelector('.pal-scroll');
  if (!s) return 'no panel';
  s.scrollTop = s.scrollHeight;
  return { top: s.scrollTop, sh: s.scrollHeight, h: s.clientHeight };
})()`);
await wait(400);
console.log('scrolled:', JSON.stringify(scrolled));
await shot('target/pal2-bottom.png');

// switch to 经典, apply 禅心 (the near-greyscale palette)
const applied = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  [...pop.querySelectorAll('.pal-tabs button')].find((b) => b.textContent.trim() === '经典').click();
  return 1;
})()`);
await wait(350);
const clicked = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  const g = [...pop.querySelectorAll('.pal-group')].find((x) => x.querySelector('.pal-name').textContent.trim() === '禅心');
  if (!g) return 'no group';
  g.querySelector('.pal-cell').click();
  return 'ok';
})()`);
await wait(900);
const state = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  const trigger = document.querySelector('button[title="选择配色方案。"]');
  return {
    open: !!pop, trigger: trigger.innerText.trim(),
    on: [...pop.querySelectorAll('.pal-cell.on')].map((c) => c.closest('.pal-group').querySelector('.pal-name').textContent.trim()),
    canvas: [...document.querySelectorAll('.node')].map((n) => ({
      text: (n.querySelector('.node-title')?.textContent || '').trim().slice(0, 8),
      fill: n.querySelector('.node-shape path')?.getAttribute('fill'),
      color: getComputedStyle(n).color,
    })),
  };
})()`);
console.log('click:', clicked, '| state:', JSON.stringify(state));
await shot('target/pal2-classic-zen.png');
ws.close();
