// Verify the shipped XMind's 画布 > 配色方案 *strip*: switching the drop-down
// selection must change the six cards shown underneath.
//
//   node scripts/probe-orig-palette-strip.mjs [outDir]
//
// Output: <outDir>/orig-palette-strip.json (+ before/after screenshots)
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/palette');
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
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r.result?.value;
  };
  return { ws, ready, send, ev };
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
if (!page) throw new Error('no editor target');
const c = connect(page.webSocketDebuggerUrl);
await c.ready;
await c.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
await c.ev(`(() => {
  const a = [...document.querySelectorAll('.uk-tab a, .uk-tab button')].find(x => (x.innerText||'').trim() === '画布');
  if (a) a.click(); return !!a;
})()`);
await wait(400);

// The palette field: locate the section containing the trigger button.
const FIELD = `(() => {
  const btn = document.querySelector('button[title="选择配色方案。"]');
  if (!btn) return { error: 'no palette trigger' };
  let host = btn;
  for (let i = 0; i < 4; i++) {
    host = host.parentElement;
    if (!host) break;
    if (host.querySelectorAll('[class*="theme"], [class*="palette"], [class*="scheme"]').length >= 6) break;
  }
  host = host || btn.parentElement;
  const info = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      cls: el.className.toString(), tag: el.tagName,
      title: el.getAttribute('title') || '', aria: el.getAttribute('aria-label') || '',
      text: (el.innerText || '').trim().slice(0, 50),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      html: el.outerHTML.replace(/\\s+/g, ' ').slice(0, 900),
    };
  };
  const cards = [...host.querySelectorAll('*')].filter(e => {
    const cl = e.className?.toString?.() || '';
    return /theme|palette|scheme|swatch|color/i.test(cl) && e.children.length >= 2
      && e.getBoundingClientRect().width > 30 && e.getBoundingClientRect().width < 200;
  });
  return {
    triggerText: (btn.innerText || '').trim(),
    triggerHtml: btn.outerHTML.replace(/\\s+/g, ' ').slice(0, 1200),
    host: info(host),
    hostHtml: host.outerHTML.replace(/\\s+/g, ' ').slice(0, 9000),
    cards: cards.slice(0, 24).map(info),
  };
})()`;

const snap = async (tag) => {
  console.log('snap', tag);
  return c.ev(FIELD);
};

const before = await snap('before');

// Open the gallery and pick a different scheme (2nd group = 活力).
await c.ev(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
})()`);
await wait(600);
const clicked = await c.ev(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find(p => p.querySelector('.smart-color-theme-group'));
  if (!pop) return 'no popover';
  const g = pop.querySelectorAll('.smart-color-theme-group')[1];
  if (!g) return 'no group';
  const name = (g.querySelector('.theme-name-label')?.innerText || '').trim();
  const cell = g.querySelector('.smart-color-theme-group-cell');
  if (!cell) return 'no cell';
  cell.click();
  return name;
})()`);
await wait(900);
const after = await snap('after');

// Also switch the 经典 tab and capture its list for reference.
await c.ev(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
})()`);
await wait(500);
const classic = await c.ev(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find(p => p.querySelector('.smart-color-theme-group'));
  if (!pop) return null;
  const tab = [...pop.querySelectorAll('.uk-tab li, .uk-tab a')].find(e => (e.innerText||'').trim() === '经典');
  if (tab) tab.click();
  return !!tab;
})()`);
await wait(500);
const classicNames = await c.ev(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find(p => p.querySelector('.smart-color-theme-group'));
  if (!pop) return null;
  return [...pop.querySelectorAll('.theme-name-label')].map(e => (e.innerText||'').trim());
})()`);
await c.ev(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  if (b && b.getAttribute('aria-expanded') === 'true') b.click();
})()`);

const out = { clicked, classic, classicNames, before, after };
writeFileSync(resolve(OUT, 'orig-palette-strip.json'), JSON.stringify(out, null, 1));
console.log('clicked:', clicked, 'classic tab:', classic, 'classic names:', classicNames);
console.log('before trigger:', before.triggerText, 'after trigger:', after.triggerText);
console.log('before cards:', before.cards?.length, 'after cards:', after.cards?.length);
console.log('before host:', before.host?.cls, 'after host:', after.host?.cls);
console.log('host html equal:', before.hostHtml === after.hostHtml);
console.log('--- before hostHtml ---\n', (before.hostHtml || '').slice(0, 5000));
c.ws.close();
