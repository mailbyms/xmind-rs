// Set 演说 layout N from the panel, enter present mode and screenshot.
// Usage: node scripts/ui-present-layout.mjs <N> [out.png]
import { writeFileSync, mkdirSync } from 'node:fs';

const n = Number(process.argv[2] || 3);
const out = process.argv[3] || `target/verify4/layout-${n}.png`;
const PORT = process.env.CDP_PORT || 9223;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
  }
  await wait(400);
};
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});

await evaluate(`(() => {
  document.querySelector('.present-exit')?.click();
  [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '演说')?.click();
  return 1;
})()`);
await wait(400);
const set = await evaluate(`(() => {
  const seg = [...document.querySelectorAll('.fp-seg')].pop();
  const btns = [...(seg?.querySelectorAll('button') || [])];
  const target = btns[${n} - 1];
  if (!target) return 'missing';
  target.click();
  return btns.findIndex((b) => b.classList.contains('on')) + 1;
})()`);
console.log('layout button ->', set);
await wait(700);
await evaluate(`(() => {
  [...document.querySelectorAll('.fp-btn-primary')].find((b) => b.textContent.includes('开始演说'))?.click();
  return 1;
})()`);
await wait(800);
// walk to the first list slide
for (const i of [0, 1, 2, 3]) await key('ArrowRight', 'ArrowRight', 39);
await wait(400);
const info = await evaluate(`(() => ({
  cls: document.querySelector('.present-slide')?.className,
  title: document.querySelector('.ps-title')?.textContent,
  bullets: [...document.querySelectorAll('.ps-item')].map((b) => b.textContent.trim()),
}))()`);
console.log(JSON.stringify(info, null, 1));
const res = await send('Page.captureScreenshot', { format: 'png' });
mkdirSync('target/verify4', { recursive: true });
writeFileSync(out, Buffer.from(res.data, 'base64'));
console.log('shot ->', out);
await key('Escape', 'Escape', 27);
ws.close();
