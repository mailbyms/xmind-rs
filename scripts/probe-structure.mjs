// Apply one skeleton from the shipped 骨架 popover, then dump the resulting
// geometry (topic boxes + connector paths) and capture the canvas.
// Usage: node scripts/probe-structure.mjs "<骨架名>" out.png [port]
import { writeFileSync } from 'node:fs';

const label = process.argv[2];
const out = process.argv[3] || 'target/structure.png';
const PORT = process.env.CDP_PORT || 9222;

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

// 1. open the skeleton popover (it is a toggle: never click twice)
const opened = await evaluate(`(() => {
  const b = document.querySelector('button[title="选择骨架。"]');
  if (!b) return 'no toggle';
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  return b.getAttribute('aria-expanded');
})()`);
if (opened !== 'true') { console.error('open failed', opened); process.exit(1); }
await wait(700);

// 2. click the first card of the requested group
const clicked = await evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-popover.uk-open')].find((p) => p.innerText.includes(${JSON.stringify(label)}));
  if (!pop) return { error: 'no popover', labels: [...document.querySelectorAll('.uk-pop.uk-popover.uk-open')].map(p => p.innerText.slice(0, 60)) };
  const head = [...pop.querySelectorAll('h5')].find((h) => h.innerText.trim() === ${JSON.stringify(label)});
  if (!head) return { error: 'no group', heads: [...pop.querySelectorAll('h5')].map(h => h.innerText.trim()) };
  const group = head.parentElement.parentElement;
  const card = group.querySelector('.uk-card-selectable');
  if (!card) return { error: 'no card', html: group.innerHTML.slice(0, 300) };
  const r = card.getBoundingClientRect();
  card.click();
  return { ok: true, at: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
})()`);
console.log('click', JSON.stringify(clicked));
if (!clicked.ok) { ws.close(); process.exit(1); }
await wait(1400);
await esc();
await wait(400);

// 3. geometry
const geom = await evaluate(`(() => {
  const num = (t) => { const m = /matrix\\(([^)]+)\\)/.exec(t || ''); if (!m) return null; const p = m[1].split(',').map(Number); return [p[4], p[5]]; };
  const nodes = [...document.querySelectorAll('g[data-view-id^="topic-node:"]')].map((g) => {
    const pos = num(g.getAttribute('transform'));
    const shape = g.querySelector('[data-view-type="shape"]');
    const sb = shape ? shape.getBoundingClientRect() : g.getBoundingClientRect();
    const fo = g.querySelector('foreignObject');
    const tr = fo ? num(fo.getAttribute('transform')) : null;
    return {
      t: (fo ? fo.textContent : '').trim().slice(0, 14),
      x: pos ? pos[0] : null, y: pos ? pos[1] : null,
      sx: Math.round(sb.x), sy: Math.round(sb.y), w: Math.round(sb.width), h: Math.round(sb.height),
      foW: fo ? Number(fo.getAttribute('width')) : null,
      foH: fo ? Number(fo.getAttribute('height')) : null,
      padX: tr ? tr[0] : null, padY: tr ? tr[1] : null,
    };
  });
  const conns = [...document.querySelectorAll('g[data-view-id^="connection:"]')].slice(0, 6).map((g) => {
    const p = g.querySelector('path');
    return p ? (p.getAttribute('stroke-width') + ' | ' + (p.getAttribute('d') || '').slice(0, 90)) : '?';
  });
  const root = nodes[0];
  const rel = nodes.map((n) => ({ t: n.t, dx: n.x !== null && root.x !== null ? +(n.x - root.x).toFixed(1) : null, dy: n.y !== null && root.y !== null ? +(n.y - root.y).toFixed(1) : null, w: n.w, h: n.h }));
  return { nodes: rel, conns, count: nodes.length };
})()`);

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: await evaluate(`(() => {
    const v = document.querySelector('.sheet-viewer').getBoundingClientRect();
    return { x: v.x, y: v.y, width: v.width, height: v.height, scale: 1 };
  })()`),
});
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('nodes', geom.count, 'saved', out);
console.log(JSON.stringify(geom.nodes.slice(0, 16)));
console.log('conns', JSON.stringify(geom.conns.slice(0, 2)));
await esc();
ws.close();
