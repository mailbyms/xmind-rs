// Click one 配色方案 group and observe: does the panel stay open, what does the
// trigger button read afterwards, and which fills/lines changed on the canvas.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const GROUP = process.argv[2] || '活力';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url)) ?? list.find((t) => t.type === 'page');
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
const esc = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await wait(250);
};
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await esc();
await evaluate(`(() => {
  const a = [...document.querySelectorAll('.uk-tab a')].find(x => x.innerText.trim() === '画布');
  a && a.click();
})()`);
await wait(400);

const before = await evaluate(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  return b.innerText.trim();
})()`);
await wait(800);

const clicked = await evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  const g = [...pop.querySelectorAll('.smart-color-theme-group')].find((x) => x.querySelector('h5').innerText.trim() === ${JSON.stringify(GROUP)});
  if (!g) return 'no group';
  const cell = g.querySelector('.smart-color-theme-group-cell');
  cell.click();
  return 'ok';
})()`);
await wait(1200);

const after = await evaluate(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  const active = pop ? [...pop.querySelectorAll('.smart-color-theme-group-cell')].filter((c) => /active/.test(c.className)).map((c) => c.closest('.smart-color-theme-group').querySelector('h5').innerText.trim()) : null;
  const topics = [...document.querySelectorAll('.topic')].slice(0, 12).map((t) => {
    const shape = t.querySelector('.topic-shape, path, rect, ellipse');
    const cs = shape ? getComputedStyle(shape) : null;
    const label = (t.innerText || '').trim().slice(0, 12);
    return { label, fill: cs ? cs.fill : null, stroke: cs ? cs.stroke : null };
  });
  return { expanded: b.getAttribute('aria-expanded'), label: b.innerText.trim(), panelOpen: !!pop, active, topics };
})()`);
writeFileSync('target/theme-click.json', JSON.stringify({ before, clicked, after }, null, 2));
console.log('before:', before, '| clicked:', clicked);
console.log('after:', JSON.stringify(after, null, 1));
await esc();
ws.close();
