// Apply one 配色方案 group on the shipped app and record what changes:
// trigger label, panel state, and the palette actually painted on the canvas.
// Usage: node scripts/probe-theme-apply.mjs [tab] [group]
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const TAB = process.argv[2] || '缤纷';
const GROUP = process.argv[3] || '活力';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && !/isDirty=false#/.test(t.url));
let page = null;
for (const t of pages) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let rid = 0; const mp = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && mp.has(m.id)) { mp.get(m.id)(m.result); mp.delete(m.id); } });
  await new Promise((r) => ws.addEventListener('open', r));
  const ev = (expr) => new Promise((r) => { const i = ++rid; mp.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
  const v = await ev('JSON.stringify({ fo: document.querySelectorAll("foreignObject").length, panel: !!document.querySelector(".uk-format-panel"), btn: !!document.querySelector(\'button[title="选择配色方案。"]\') })');
  ws.close();
  const info = JSON.parse(v.result?.value || '{}');
  console.log('  candidate', t.url.slice(-24), JSON.stringify(info));
  if (!page && info.panel) page = t;
}
page = page || pages[0];
console.log('page:', page.url.slice(-40));

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
const canvasPalette = () => evaluate(`(() => {
  const svg = document.querySelector('.sheet-viewer.active svg');
  if (!svg) return null;
  const fills = {}, strokes = {};
  for (const p of svg.querySelectorAll('path, rect, ellipse')) {
    const cs = getComputedStyle(p);
    if (cs.fill && cs.fill !== 'none') fills[cs.fill] = (fills[cs.fill] || 0) + 1;
    if (cs.stroke && cs.stroke !== 'none') strokes[cs.stroke] = (strokes[cs.stroke] || 0) + 1;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { fills: top(fills), strokes: top(strokes), bg: getComputedStyle(document.querySelector('.sheet-viewer.active')).backgroundColor };
})()`);

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await esc();
await evaluate(`(() => {
  const a = [...document.querySelectorAll('.uk-tab a')].find(x => x.innerText.trim() === '画布');
  a && a.click();
})()`);
await wait(400);
await evaluate(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
})()`);
await wait(800);

const before = await canvasPalette();

// switch capsule tab
await evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  const tab = [...pop.querySelectorAll('.uk-tab a')].find((a) => a.innerText.trim() === ${JSON.stringify(TAB)});
  tab && tab.click();
})()`);
await wait(600);

const clicked = await evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  if (!pop) return 'panel gone after tab';
  const g = [...pop.querySelectorAll('.smart-color-theme-group')].find((x) => x.querySelector('h5').innerText.trim() === ${JSON.stringify(GROUP)});
  if (!g) return 'no group';
  g.querySelector('.smart-color-theme-group-cell').click();
  return 'ok';
})()`);
await wait(1400);

const after = await evaluate(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  const active = pop ? [...pop.querySelectorAll('.smart-color-theme-group')].filter((g) => /active/.test(g.querySelector('.smart-color-theme-group-cell').className)).map((g) => g.querySelector('h5').innerText.trim()) : null;
  return { expanded: b.getAttribute('aria-expanded'), label: b.innerText.trim(), panelOpen: !!pop, active };
})()`);
const palette = await canvasPalette();

writeFileSync('target/theme-apply.json', JSON.stringify({ before, clicked, after, palette }, null, 2));
console.log('before:', JSON.stringify(before));
console.log('clicked:', clicked);
console.log('after:', JSON.stringify(after));
console.log('palette:', JSON.stringify(palette));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('target/theme-applied.png', Buffer.from(shot.data, 'base64'));
console.log('shot -> target/theme-applied.png');
await esc();
ws.close();
