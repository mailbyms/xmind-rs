// Check the 折叠/展开 disc: hidden until the topic is hovered, then drawn where
// the branch to the children starts.
//
//   node scripts/check-fold.mjs 做计划 [out.png]
//
// Requires the app on CDP 9223 with a document already open.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9223;
const title = process.argv[2] || '';
const out = process.argv[3] || 'target/verify/fold-hover.png';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: done, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : done(m.result);
  }
});
const send = (method, params = {}) => new Promise((done, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve: done, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The node whose text matches (exact first, then contains). */
const find = (text) => ev(`(() => {
  const all = [...document.querySelectorAll('.node')];
  const hit = all.find((n) => (n.textContent ?? '').trim() === ${JSON.stringify(text)})
    ?? all.find((n) => (n.textContent ?? '').includes(${JSON.stringify(text)}));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  const badge = hit.querySelector('.fold-badge');
  const b = badge ? badge.getBoundingClientRect() : null;
  return {
    id: hit.dataset.id,
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    badge: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      opacity: getComputedStyle(badge).opacity, text: (badge.textContent ?? '').trim() } : null,
  };
})()`);

// Dismiss any leftover menu backdrop: it swallows hover and pointer events.
await ev(`(() => {
  const b = document.querySelector('.xm-backdrop');
  if (b) {
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    b.click();
  }
  return !!b;
})()`);
await wait(250);

const before = await find(title);
if (!before) throw new Error(`topic not found: ${title}`);
console.log('topic   ', JSON.stringify(before));

// Park the pointer far away: the disc must be invisible.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 900, button: 'none' });
await wait(250);
console.log('idle    ', JSON.stringify((await find(title)).badge));

// Now hover the topic.
const cx = before.x + Math.round(before.w / 2);
const cy = before.y + Math.round(before.h / 2);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' });
await wait(350);
const hovered = await find(title);
console.log('hovered ', JSON.stringify(hovered.badge));

if (hovered.badge && hovered.badge.opacity !== '0') {
  const pad = 60;
  const clip = {
    x: Math.max(0, hovered.x - pad),
    y: Math.max(0, hovered.y - pad),
    width: hovered.w + pad * 2 + 80,
    height: hovered.h + pad * 2,
    scale: 3,
  };
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('shot ->', out);
}
ws.close();
