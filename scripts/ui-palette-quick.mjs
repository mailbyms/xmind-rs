// Apply 彩虹 (12-hue cycle) and then a quick-pick card, verifying both paths.
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

const canvas = () => evaluate(`[...document.querySelectorAll('.node')].map((n) => ({
  text: (n.querySelector('.node-title')?.textContent || '').trim().slice(0, 8),
  fill: n.querySelector('.node-shape path')?.getAttribute('fill'),
  line: (() => { const p = n.closest('.canvas')?.querySelector('path[stroke]'); return null; })(),
}))`);

// open board
await evaluate(`(() => {
  if (!document.querySelector('.pop.is-themes')) {
    document.querySelector('button[title="选择配色方案。"]').click();
  }
  return 1;
})()`);
await wait(500);

// 彩虹
await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  [...pop.querySelectorAll('.pal-tabs button')].find((b) => b.textContent.trim() === '缤纷').click();
  return 1;
})()`);
await wait(300);
const rainbow = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  const g = [...pop.querySelectorAll('.pal-group')].find((x) => x.querySelector('.pal-name').textContent.trim() === '彩虹');
  g.querySelector('.pal-cell').click();
  return 'ok';
})()`);
await wait(800);
const rainbowState = await evaluate(`(() => ({
  trigger: document.querySelector('button[title="选择配色方案。"]').innerText.trim(),
  canvas: [...document.querySelectorAll('.node')].map((n) => ({
    text: (n.querySelector('.node-title')?.textContent || '').trim().slice(0, 8),
    fill: n.querySelector('.node-shape path')?.getAttribute('fill'),
  })),
}))()`);
console.log('rainbow:', rainbow, JSON.stringify(rainbowState));
await shot('target/pal2-rainbow.png');

// close board, then click the first quick-pick card
await evaluate(`(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return 1; })()`);
await wait(300);
const quick = await evaluate(`(() => {
  const card = document.querySelector('.fp-bone-card.is-pal');
  if (!card) return 'no card';
  card.click();
  return card.getAttribute('title');
})()`);
await wait(800);
const quickState = await evaluate(`(() => ({
  trigger: document.querySelector('button[title="选择配色方案。"]').innerText.trim(),
  open: !!document.querySelector('.pop.is-themes'),
  canvas: [...document.querySelectorAll('.node')].map((n) => ({
    text: (n.querySelector('.node-title')?.textContent || '').trim().slice(0, 8),
    fill: n.querySelector('.node-shape path')?.getAttribute('fill'),
  })),
}))()`);
console.log('quick:', quick, JSON.stringify(quickState));
await shot('target/pal2-quick.png');
ws.close();
