// Measure where xmind-rs attaches branch lines to underline topics, and take a
// screenshot at a fixed viewport.  Compare with probe-orig-underline.mjs.
//
//   CDP_PORT=9244 node scripts/probe-app-underline.mjs [outdir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9244);
const OUT = resolve(process.argv[2] || 'target/verify/underline');
mkdirSync(OUT, { recursive: true });
const tag = process.env.TAG || 'app';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => {
  const mid = ++id; pending.set(mid, ok);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

// Fixed viewport for both apps.
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
await wait(500);
// Dismiss any leftover menu / backdrop.
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(200);

// Fit the map: status-bar zoom menu → 适应画布.
const zoomBtn = await ev(`(() => { const b = document.querySelector('.sb-zoom'); if (!b) return null;
  const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
if (zoomBtn) {
  await clickAt(zoomBtn.x, zoomBtn.y);
  await wait(250);
  const fit = await ev(`(() => { const b = [...document.querySelectorAll('.zoom-item')]
    .find((n) => (n.textContent ?? '').includes('适应画布')); if (!b) return null;
    const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (fit) { await clickAt(fit.x, fit.y); await wait(400); }
}
console.log('zoom', await ev('document.querySelector(".sb-zoom-label")?.textContent ?? ""'));

const data = await ev(`(() => {
  const pt = (path, len) => {
    const p = path.getPointAtLength(len);
    const m = path.getScreenCTM();
    const q = new DOMPoint(p.x, p.y).matrixTransform(m);
    return { x: +q.x.toFixed(2), y: +q.y.toFixed(2) };
  };
  const nodes = [...document.querySelectorAll('.node')].map((n) => {
    const r = n.getBoundingClientRect();
    const t = n.querySelector('.node-title');
    const cs = t ? getComputedStyle(t) : null;
    const tr = t ? t.getBoundingClientRect() : null;
    return {
      id: n.getAttribute('data-id'),
      cls: n.className,
      rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
      title: (t?.textContent ?? '').trim().slice(0, 24),
      underline: n.classList.contains('underline'),
      borderBottom: cs?.borderBottomWidth + ' ' + cs?.borderBottomStyle + ' ' + cs?.borderBottomColor,
      titleRect: tr ? { x: +tr.x.toFixed(2), y: +tr.y.toFixed(2), w: +tr.width.toFixed(2), h: +tr.height.toFixed(2) } : null,
    };
  });
  const conns = [...document.querySelectorAll('svg.edges path')].map((p, i) => {
    const total = p.getTotalLength();
    return { i, d: (p.getAttribute('d') || '').slice(0, 200), start: pt(p, 0), end: pt(p, total) };
  });
  return { nodes, conns };
})()`);

writeFileSync(resolve(OUT, `${tag}-underline.json`), JSON.stringify(data, null, 1));
console.log('nodes', data.nodes.length, 'connections', data.conns.length,
  'underline', data.nodes.filter((n) => n.underline).length);

// endpoints that land on a node's left/right edge
const tol = 7;
const rows = [];
for (const c of data.conns) {
  for (const [which, p] of [['start', c.start], ['end', c.end]]) {
    let best = null;
    for (const n of data.nodes) {
      if (p.y < n.rect.y - tol || p.y > n.rect.y + n.rect.h + tol) continue;
      const dl = Math.abs(p.x - n.rect.x), dr = Math.abs(p.x - (n.rect.x + n.rect.w));
      const d = Math.min(dl, dr);
      if (d <= tol && (!best || d < best.d)) best = { n, d, side: dl < dr ? 'left' : 'right' };
    }
    if (!best) continue;
    const n = best.n;
    rows.push({
      which, title: n.title, side: best.side, y: p.y,
      yFromTop: +(p.y - n.rect.y).toFixed(2), boxH: n.rect.h,
      underline: n.underline, boxBottom: +(n.rect.y + n.rect.h).toFixed(2),
      titleBottom: n.titleRect ? +(n.titleRect.y + n.titleRect.h).toFixed(2) : null,
      borderBottom: n.borderBottom,
    });
  }
}
writeFileSync(resolve(OUT, `${tag}-attach.json`), JSON.stringify(rows, null, 1));
const buckets = new Map();
for (const r of rows) {
  const rel = +(r.yFromTop - r.boxH / 2).toFixed(1);
  const key = `${r.underline ? 'underline' : 'shape   '} side=${r.side.padEnd(5)} dyFromCentre=${rel} boxH=${r.boxH}`;
  buckets.set(key, (buckets.get(key) || 0) + 1);
}
console.log('== attach buckets ==');
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String(v).padStart(3), k);
console.log('== underline sample ==');
for (const r of rows.filter((r) => r.underline).slice(0, 6)) {
  console.log(`${r.title.padEnd(10)} side=${r.side.padEnd(5)} y=${r.y} top=${r.yFromTop}/${r.boxH} titleBottom=${r.titleBottom} ${r.borderBottom}`);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, `${tag}-${process.env.SHOT_NAME || 'view'}.png`), Buffer.from(shot.data, 'base64'));
console.log('shot ->', resolve(OUT, `${tag}-${process.env.SHOT_NAME || 'view'}.png`));
ws.close();
process.exit(0);
