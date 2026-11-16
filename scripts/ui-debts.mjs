// Verify the three debts fixed this round, inside a running release build:
//   1. 配色方案 survives save → reopen (written into sheet.theme);
//   2. the 3x2 strip shows whole-map thumbnails, not colour bars;
//   3. hand-drawn skeletons get their hatch fill + ink outline;
//   4. matrix column headers span the column and centre their label.
// Usage: node scripts/ui-debts.mjs [out-prefix]
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'target/debts';
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
const shot = async (file) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
};
const log = (...args) => console.log(...args);

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});

const nodes = () => evaluate(`[...document.querySelectorAll('.node')].map((n) => {
  const path = n.querySelector('.node-shape > path');
  const r = n.getBoundingClientRect();
  const cs = getComputedStyle(n);
  return {
    title: n.querySelector('.node-title')?.textContent ?? '',
    w: Math.round(r.width), h: Math.round(r.height),
    fill: path?.getAttribute('fill') ?? null,
    stroke: path?.getAttribute('stroke') ?? null,
    sw: path?.getAttribute('stroke-width') ?? null,
    justify: cs.justifyContent,
    pad: cs.paddingLeft,
  };
})`);

const paletteLabel = () => evaluate(`document.querySelector('.fp-palette-name')?.textContent.trim() ?? null`);
const invoke = (cmd, args) => evaluate(
  `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`,
);

// --- 1. quick-pick strip ------------------------------------------------------
await evaluate(`(() => {
  [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '画布')?.click();
  return 1;
})()`);
await wait(300);
const quick = await evaluate(`(() => [...document.querySelectorAll('.fp-bone-card.is-pal')].map((b) => {
  const img = b.querySelector('img.fp-thumb');
  return { title: b.title, src: img?.getAttribute('src') ?? null, ok: !!img && img.naturalWidth > 0,
    w: img ? Math.round(img.getBoundingClientRect().width) : 0,
    h: img ? Math.round(img.getBoundingClientRect().height) : 0 };
}))()`);
log('quick cards:', JSON.stringify(quick));

// --- 2. apply 活力, save, reopen ---------------------------------------------
const opened = await evaluate(`(() => {
  if (document.querySelector('.pop.is-themes')) return 'already';
  const b = document.querySelector('button[title="选择配色方案。"]');
  if (!b) return 'no trigger';
  b.click();
  return 'ok';
})()`);
await wait(500);
const picked = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  const group = [...pop.querySelectorAll('.pal-group')].find((g) => g.querySelector('.pal-name')?.textContent.trim() === '活力');
  if (!group) return 'no group';
  group.querySelector('.pal-cell').click();
  return 'clicked';
})()`);
await wait(500);
log('palette open/pick:', opened, picked);
const before = { label: await paletteLabel(), nodes: (await nodes()).slice(0, 4) };
log('after apply:', JSON.stringify(before));

const file = 'target/debt-palette.xmind';
const saved = await invoke('doc_save', { path: file });
log('saved palette:', JSON.stringify(saved.document?.palette ?? saved.palette ?? null));

await invoke('doc_new', {});
await wait(300);
await invoke('doc_open', { path: file });
await wait(600);
const after = { label: await paletteLabel(), nodes: (await nodes()).slice(0, 4) };
log('after reopen:', JSON.stringify(after));
await shot(`${OUT}-reopen.png`);

// --- 3. hand-drawn skeleton ---------------------------------------------------
await evaluate(`document.body.click()`);
await wait(300);
await evaluate(`(() => {
  const trigger = document.querySelector('button.fp-bone');
  if (trigger && !document.querySelector('.pop.is-skeleton')) trigger.click();
  return 1;
})()`);
await wait(600);
const openedSkeleton = await evaluate(`document.querySelectorAll('.bone-card').length`);
const hand = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.bone-card')].find((c) => c.getAttribute('aria-label') === '思维导图 6');
  if (!card) return 'no card';
  card.scrollIntoView({ block: 'center' });
  card.click();
  return 'clicked';
})()`);
await wait(800);
log('skeleton cards:', openedSkeleton, '| handdrawn:', hand);
const handNodes = (await nodes()).slice(0, 5);
log('handdrawn nodes:', JSON.stringify(handNodes));
await shot(`${OUT}-handdrawn.png`);

// --- 4. matrix headers --------------------------------------------------------
const matrix = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.bone-card')].find((c) => c.getAttribute('aria-label') === '矩阵图 1');
  if (!card) return 'no card';
  card.scrollIntoView({ block: 'center' });
  card.click();
  return 'clicked';
})()`);
await wait(700);
log('matrix:', matrix);
const matrixNodes = (await nodes()).slice(0, 6);
log('matrix nodes:', JSON.stringify(matrixNodes));
await shot(`${OUT}-matrix.png`);

ws.close();
