// Probe the shipped XMind's 画布 > 配色方案 popover: which drop-down options
// exist, and which six schemes each option shows underneath.
//
//   node scripts/probe-orig-palette-board.mjs [outDir]
//
// Output: <outDir>/orig-palette-board.json + orig-palette-board.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((r) => {
    const mid = ++id; pending.set(mid, r);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r.result?.value;
  };
  return { ws, ready, send, ev };
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
if (!pages.length) throw new Error('no editor.html target');

const probes = [];
for (const t of pages) {
  const c = connect(t.webSocketDebuggerUrl);
  await c.ready;
  try {
    probes.push({
      id: t.id,
      url: t.url.slice(0, 100),
      ...(await ev0(c)),
    });
  } catch (e) {
    probes.push({ id: t.id, error: e.message });
  }
  c.ws.close();
}
console.log('targets:', JSON.stringify(probes, null, 1));

async function ev0(c) {
  return c.ev(`(() => ({
    hasFormat: !!document.querySelector('.uk-format-panel'),
    tabs: [...document.querySelectorAll('.uk-tab a, .uk-tab button')].map(e => (e.innerText||'').trim()).filter(Boolean).slice(0, 12),
    paletteBtn: !!document.querySelector('button[title="选择配色方案。"]'),
    openPops: [...document.querySelectorAll('.uk-pop.uk-open')].map(e => e.className.toString()),
    selects: [...document.querySelectorAll('select')].map(e => ({ cls: e.className.toString(), opts: [...e.options].map(o => o.text.trim()) })),
    title: document.title
  }))()`);
}

const forced = process.env.CDP_TARGET_ID;
const chosen = (forced && probes.find((p) => p.id === forced))
  || probes.find((p) => p.hasFormat && p.paletteBtn)
  || probes.find((p) => p.hasFormat)
  || probes[0];
if (!chosen || chosen.error) throw new Error('no usable editor target');
console.log('chosen:', chosen.id);

const page = pages.find((t) => t.id === chosen.id);
const c = connect(page.webSocketDebuggerUrl);
await c.ready;
await c.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });

// 1. Open the 画布 tab of the format panel.
await c.ev(`(() => {
  const a = [...document.querySelectorAll('.uk-tab a, .uk-tab button')].find(x => (x.innerText||'').trim() === '画布');
  if (a) a.click();
  return !!a;
})()`);
await wait(400);

// 2. Open the 配色方案 drop-down.
const opened = await c.ev(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  if (!b) return 'no-button';
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  return b.outerHTML.replace(/\\s+/g, ' ').slice(0, 400);
})()`);
console.log('trigger:', opened);
await wait(800);

const dump = await c.ev(`(() => {
  const pops = [...document.querySelectorAll('.uk-pop.uk-open')];
  const pop = pops.find(p => p.querySelector('.smart-color-theme-group')) || pops[0];
  if (!pop) return { error: 'no open popover', pops: pops.map(p => p.className.toString()) };
  const info = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cls: el.className.toString(), tag: el.tagName,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      text: (el.innerText || '').trim().slice(0, 60),
      title: el.getAttribute('title') || '', html: el.outerHTML.replace(/\\s+/g, ' ').slice(0, 500) };
  };
  const selects = [...pop.querySelectorAll('select')].map(s => ({
    ...info(s), options: [...s.options].map(o => ({ text: o.text.trim(), value: o.value, selected: o.selected })),
  }));
  const groups = [...pop.querySelectorAll('.smart-color-theme-group')].map(g => ({
    ...info(g),
    cells: [...g.querySelectorAll('.smart-color-theme-group-cell')].map(cell => ({
      ...info(cell),
      bg: getComputedStyle(cell).backgroundColor,
      bgImage: getComputedStyle(cell).backgroundImage.slice(0, 200),
      swatches: [...cell.children].map(ch => ({ cls: ch.className.toString(), bg: getComputedStyle(ch).backgroundColor, bgi: getComputedStyle(ch).backgroundImage.slice(0, 160) })),
    })),
    name: (g.querySelector('.smart-color-theme-group-name, .group-name, .name')?.innerText || '').trim(),
  }));
  const combo = [...pop.querySelectorAll('[class*="select"], [class*="dropdown"], [class*="combo"]')]
    .filter(e => e.children.length < 12)
    .slice(0, 20).map(info);
  return {
    popClass: pop.className.toString(),
    popText: (pop.innerText || '').trim().slice(0, 1500),
    selects, groups,
    groupCount: groups.length,
    combo,
    html: pop.outerHTML.replace(/\\s+/g, ' ').slice(0, 12000),
  };
})()`);

writeFileSync(resolve(OUT, 'orig-palette-board.json'), JSON.stringify({ targets: probes, chosen: chosen.id, trigger: opened, dump }, null, 1));
const shot = await c.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'orig-palette-board.png'), Buffer.from(shot.data, 'base64'));
console.log('selects:', JSON.stringify(dump?.selects ?? dump, null, 1).slice(0, 2500));
console.log('groupCount:', dump?.groupCount, 'popText:', (dump?.popText || '').slice(0, 600));
console.log('groups:', JSON.stringify((dump?.groups || []).map(g => ({ name: g.name, text: g.text, cells: g.cells.length })), null, 1).slice(0, 3000));
c.ws.close();
