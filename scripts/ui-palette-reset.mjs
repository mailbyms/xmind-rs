// Applying 分支配色 must clear the 配色方案 id, so the trigger stops naming a
// palette that is no longer on the canvas.
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
await new Promise((r) => ws.addEventListener('open', r));

const before = await evaluate(`document.querySelector('.fp-palette-name')?.textContent.trim()`);

await evaluate(`(() => {
  [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '样式').click();
  return 1;
})()`);
await wait(300);
const open = await evaluate(`(() => {
  const b = document.querySelector('.fp-rainbow');
  if (!b) return 'no rainbow button';
  b.click();
  return 'ok';
})()`);
await wait(400);
const picked = await evaluate(`(() => {
  const disc = document.querySelector('.pop .pal-disc');
  if (!disc) return 'no disc';
  const name = disc.getAttribute('title');
  disc.click();
  return name;
})()`);
await wait(700);
await evaluate(`(() => { [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '画布').click(); return 1; })()`);
await wait(350);
const after = await evaluate(`(() => ({
  name: document.querySelector('.fp-palette-name')?.textContent.trim(),
  chips: [...document.querySelectorAll('.fp-chips span')].map((s) => getComputedStyle(s).backgroundColor),
  quickOn: [...document.querySelectorAll('.fp-bone-card.is-pal.on')].length,
}))()`);
console.log('before:', before, '| open:', open, '| picked:', picked);
console.log('after:', JSON.stringify(after));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('target/pal3-branch-reset.png', Buffer.from(shot.data, 'base64'));
ws.close();
