// Grab every 骨架 card thumbnail out of the shipped panel as a standalone SVG.
// The renderer builds them at runtime as `data:image/svg+xml,…`, so the only way
// to reproduce the exact artwork is to ask the live app for it.
// Usage: node scripts/dump-skeleton-thumbs.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const OUT_DIR = 'public/tiles/skeletons';
const MANIFEST = 'research/skeleton-cards.json';

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
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(250);

const opened = await evaluate(`(() => {
  const b = document.querySelector('button[title="选择骨架。"]');
  if (!b) return 'no toggle';
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  return b.getAttribute('aria-expanded');
})()`);
if (opened !== 'true') { console.error('open failed', opened); process.exit(1); }
await wait(1000);

const cards = await evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-popover.uk-open')].find((p) => p.innerText.includes('思维导图'));
  if (!pop) return { error: 'no popover' };
  const groups = [];
  for (const h of pop.querySelectorAll('h5')) {
    const grid = h.parentElement.nextElementSibling;
    const items = [...grid.querySelectorAll('.uk-card-selectable')].map((c, i) => {
      const img = c.querySelector('img');
      const r = c.getBoundingClientRect();
      return {
        index: i,
        active: c.classList.contains('uk-active'),
        w: Math.round(r.width), h: Math.round(r.height),
        natural: img ? [img.naturalWidth, img.naturalHeight] : null,
        src: img ? img.getAttribute('src') : null,
      };
    });
    groups.push({ heading: h.innerText.trim(), items });
  }
  return { groups };
})()`);
if (cards.error) { console.error(cards); process.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });
const slug = (s) => s.replace(/[^\w\u4e00-\u9fa5]+/g, '-');
const manifest = [];
let saved = 0;
for (const group of cards.groups) {
  group.items.forEach((item, i) => {
    if (!item.src?.startsWith('data:image/svg+xml,')) return;
    const svg = decodeURIComponent(item.src.slice('data:image/svg+xml,'.length));
    const file = `${slug(group.heading)}-${String(i).padStart(2, '0')}.svg`;
    writeFileSync(`${OUT_DIR}/${file}`, svg);
    saved++;
    manifest.push({
      group: group.heading, index: i, file,
      active: item.active, box: [item.w, item.h], natural: item.natural,
      bytes: svg.length,
    });
  });
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`saved ${saved} thumbs -> ${OUT_DIR}`);
console.log(manifest.map((m) => `${m.group}#${m.index}${m.active ? '*' : ''}`).join(' '));
await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
ws.close();
