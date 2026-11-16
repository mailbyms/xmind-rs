// Perform a real drag inside XMind and dump whatever preview chrome appears
// (predictive line, target highlight, ghost). Cancels with Escape afterwards.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /editor\.html/.test(t.url));
const page = pages.find((t) => /xmind-samples/.test(decodeURIComponent(t.url)));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval failed');
  return res.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra,
});

await send('Page.bringToFront').catch(() => {});

const topics = await ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find((s) => s.querySelectorAll('path').length > 50);
  const out = [];
  for (const g of svg.querySelectorAll('g[data-view-id]')) {
    const fo = g.querySelector(':scope > foreignObject');
    if (!fo) continue;
    const r = g.getBoundingClientRect();
    if (r.width < 30 || r.height < 14) continue;
    out.push({ id: g.getAttribute('data-view-id').slice(0, 8), type: g.getAttribute('data-view-type'),
      text: fo.textContent.trim().slice(0, 10),
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
})()`);
console.log('topics:', topics.length);
const src = topics.find((t) => t.text === '读书笔记') ?? topics[3];
const dst = topics.find((t) => t.text === '逻辑思考') ?? topics[8];
console.log('drag', src.text, '->', dst.text);

await mouse('mousePressed', src.x, src.y);
for (let i = 1; i <= 8; i++) {
  await wait(60);
  await mouse('mouseMoved', src.x + (dst.x - src.x) * (i / 8), src.y + (dst.y - src.y) * (i / 8));
}
await wait(500);

const dump = await ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find((s) => s.querySelectorAll('path').length > 50);
  const out = { dashed: [], marks: [] };
  for (const p of svg.querySelectorAll('path')) {
    const dash = p.getAttribute('stroke-dasharray') || getComputedStyle(p).strokeDasharray;
    const cls = String(p.getAttribute('class') || '');
    const stroke = p.getAttribute('stroke') || getComputedStyle(p).stroke;
    const d = p.getAttribute('d') || '';
    if ((dash && dash !== 'none') || /drag|drop|indicator|preview|insert|ghost/i.test(cls + (p.parentElement?.getAttribute('class') || ''))) {
      out.dashed.push({ cls, dash, stroke, w: p.getAttribute('stroke-width'), d: d.slice(0, 200),
        parent: String(p.parentElement?.getAttribute('class') || '') });
    }
  }
  for (const el of document.querySelectorAll('[class*=drag], [class*=drop], [class*=indicator], [class*=preview], [class*=ghost], [class*=target], [class*=insert]')) {
    const r = el.getBoundingClientRect();
    out.marks.push({ tag: el.tagName, cls: String(el.className).slice(0, 70), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  }
  return out;
})()`);
console.log(JSON.stringify(dump, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('target/xmind-drag.png', Buffer.from(shot.data, 'base64'));

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(200);
await mouse('mouseReleased', dst.x, dst.y);
await wait(300);
ws.close();
