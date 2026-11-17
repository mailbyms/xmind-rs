// Dump the shipped XMind's topic boxes and branch-line endpoints so we can see
// where a connector attaches when the topic's shape is underline.
//
//   node scripts/probe-orig-underline.mjs [outdir]
//
// Writes <outdir>/orig-underline.json  (nodes + connections, screen coords)
// and    <outdir>/orig-underline.png   (screenshot of the canvas).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const WANT = process.env.ORIG_FILE || 'example.xmind';
const OUT = resolve(process.argv[2] || 'target/verify/underline');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(
  (t) => t.type === 'page' && /editor\.html\?/.test(t.url) && decodeURIComponent(t.url).includes(WANT),
);
if (!page) throw new Error(`no editor page for ${WANT}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: ok, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : ok(m.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((ok, rej) => {
    const mid = ++id;
    pending.set(mid, { resolve: ok, reject: rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};

const data = await ev(`(() => {
  const pt = (path, len) => {
    const p = path.getPointAtLength(len);
    const m = path.getScreenCTM();
    const q = new DOMPoint(p.x, p.y).matrixTransform(m);
    return { x: +q.x.toFixed(2), y: +q.y.toFixed(2) };
  };
  const nodes = [...document.querySelectorAll('[data-view-id^="topic-node:"]')].map((g) => {
    const id = g.getAttribute('data-view-id').slice('topic-node:'.length);
    const r = g.getBoundingClientRect();
    const border = g.querySelector('[data-view-id^="topic-node-border:"]');
    const back = g.querySelector('[data-view-id^="topic-node-background:"]');
    const bb = border?.getBoundingClientRect() ?? null;
    const title = g.querySelector('[data-view-id^="topic-title:"]');
    return {
      id,
      rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
      border: bb ? { x: +bb.x.toFixed(2), y: +bb.y.toFixed(2), w: +bb.width.toFixed(2), h: +bb.height.toFixed(2) } : null,
      borderStroke: border?.getAttribute('stroke') ?? '',
      backFill: back?.getAttribute('fill') ?? '',
      title: (title?.textContent ?? '').trim().slice(0, 24),
    };
  });
  const conns = [...document.querySelectorAll('[data-view-id^="topic-connection:"]')].map((p) => {
    const id = p.getAttribute('data-view-id').slice('topic-connection:'.length);
    const total = p.getTotalLength();
    return {
      id,
      d: (p.getAttribute('d') || '').slice(0, 220),
      stroke: p.getAttribute('stroke') || '',
      start: pt(p, 0),
      end: pt(p, total),
    };
  });
  return { nodes, conns };
})()`);

writeFileSync(resolve(OUT, 'orig-underline.json'), JSON.stringify(data, null, 1));
console.log('nodes', data.nodes.length, 'connections', data.conns.length);

// --- local analysis -------------------------------------------------------
const tol = 6;
/** Nearest node whose left/right edge is within `tol` of (x,y). */
const attachOf = (x, y) => {
  let best = null;
  for (const n of data.nodes) {
    const insideY = y >= n.rect.y - tol && y <= n.rect.y + n.rect.h + tol;
    if (!insideY) continue;
    const dLeft = Math.abs(x - n.rect.x);
    const dRight = Math.abs(x - (n.rect.x + n.rect.w));
    const d = Math.min(dLeft, dRight);
    if (d <= tol && (!best || d < best.d)) {
      best = { id: n.id, d, side: dLeft < dRight ? 'left' : 'right', node: n };
    }
  }
  return best;
};

const rows = [];
for (const c of data.conns) {
  for (const [which, p] of [['start', c.start], ['end', c.end]]) {
    const a = attachOf(p.x, p.y);
    if (!a) continue;
    const n = a.node;
    const isUnderline = n.border != null && n.border.h < 6;
    rows.push({
      conn: c.id.slice(0, 8),
      which,
      node: n.id.slice(0, 8),
      title: n.title,
      side: a.side,
      dx: +a.d.toFixed(2),
      yFromTop: +(p.y - n.rect.y).toFixed(2),
      boxH: n.rect.h,
      y: p.y,
      underline: isUnderline,
      underlineY: n.border ? +n.border.y.toFixed(2) : null,
      underlineH: n.border ? +n.border.h.toFixed(2) : null,
      boxBottom: +(n.rect.y + n.rect.h).toFixed(2),
    });
  }
}
writeFileSync(resolve(OUT, 'orig-attach.json'), JSON.stringify(rows, null, 1));

const buckets = new Map();
for (const r of rows) {
  const key = `${r.underline ? 'underline' : 'normal   '} side=${r.side.padEnd(5)} yFromTop=${r.yFromTop} boxH=${r.boxH}`;
  buckets.set(key, (buckets.get(key) || 0) + 1);
}
console.log('== attach buckets (top 16) ==');
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log(String(v).padStart(3), k);
}

const ul = rows.filter((r) => r.underline);
console.log('== underline endpoints ==', ul.length);
for (const r of ul.slice(0, 14)) {
  console.log(
    `${r.title.padEnd(10)} side=${r.side.padEnd(5)} y=${r.y} top=${r.yFromTop}/${r.boxH} ulY=${r.underlineY} ulH=${r.underlineH} bottom=${r.boxBottom}`,
  );
}
const normal = rows.filter((r) => !r.underline).slice(0, 8);
console.log('== normal endpoints (sample) ==', normal.length);
for (const r of normal) {
  console.log(`${r.title.padEnd(10)} side=${r.side.padEnd(5)} top=${r.yFromTop}/${r.boxH}`);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'orig-underline.png'), Buffer.from(shot.data, 'base64'));
console.log('shot ->', resolve(OUT, 'orig-underline.png'));
ws.close();
