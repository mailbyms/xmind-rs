// Export the shipped panel tile artwork (shape / fill / border / line / arrow
// libraries) straight from the running renderer into public/tiles/*.svg.
// Usage: node scripts/dump-tiles.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const OUT = 'public/tiles';
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url))
  ?? list.find((t) => t.type === 'page');

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
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res.result.value;
};
await new Promise((r) => ws.addEventListener('open', r));

const GROUPS = [
  { key: 'shape', title: '设置主题形状。' },
  { key: 'fill', title: '选择填充样式。' },
  { key: 'border', title: '选择边框样式。' },
  { key: 'line', title: '选择分支线形状。' },
  { key: 'arrow', title: '选择端点样式。' },
  { key: 'linestyle', title: '选择分支线样式。' },
  { key: 'skeleton', title: '设置主题结构。' },
];

const manifest = {};
for (const group of GROUPS) {
  const tiles = await evaluate(`(async () => {
    const toggle = [...document.querySelectorAll('button[title=${JSON.stringify(group.title)}]')]
      .filter((e) => e.getBoundingClientRect().width > 0)[0];
    if (!toggle) return { error: 'no toggle' };
    // Toggle twice when a popover is already open so the click always opens.
    toggle.click();
    await new Promise((r) => setTimeout(r, 380));
    let pops = [...document.querySelectorAll('[class*="uk-pop"]')]
      .map((e) => ({ e, b: e.getBoundingClientRect() }))
      .filter(({ e, b }) => b.width > 30 && b.height > 16 && !/overlay/.test(String(e.className)));
    if (!pops.length) { toggle.click(); await new Promise((r) => setTimeout(r, 320)); return { error: 'no popover' }; }
    pops.sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height);
    const pop = pops[0].e;
    const out = [];
    for (const btn of pop.querySelectorAll('button, li')) {
      const r = btn.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const img = btn.querySelector('img');
      const svg = btn.querySelector('svg');
      const g = btn.querySelector('g[id]');
      out.push({
        src: img ? img.getAttribute('src') : '',
        gid: g ? g.id : '',
        text: (btn.innerText || '').trim().slice(0, 24),
        active: /active|selected/.test(String(btn.className)),
        w: Math.round(r.width), h: Math.round(r.height),
        svg: svg ? svg.outerHTML : '',
      });
    }
    document.body.click();
    await new Promise((r) => setTimeout(r, 120));
    return { tiles: out };
  })()`);
  if (tiles.error) { console.log(group.key, 'FAILED', tiles.error); continue; }
  manifest[group.key] = [];
  tiles.tiles.forEach((tile, index) => {
    const src = (tile.src || '').split('\\').pop()?.split('/').pop() ?? '';
    const base = src.replace(/\.svg$/i, '') || (tile.gid.split('/').pop() ?? '') || `tile-${index}`;
    const name = `${group.key}-${String(index).padStart(2, '0')}-${base.replace(/[^\w.-]+/g, '_')}`;
    if (tile.svg) writeFileSync(`${OUT}/${name}.svg`, group.key === 'skeleton' ? tile.svg : tile.svg);
    manifest[group.key].push({
      index, file: `${name}.svg`, src, gid: tile.gid.split('/').pop() ?? '', text: tile.text,
      active: tile.active, w: tile.w, h: tile.h,
    });
  });
  console.log(group.key, manifest[group.key].length, 'tiles');
}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
ws.close();
process.exit();
