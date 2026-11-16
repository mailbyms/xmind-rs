// During a drag, dump full attributes/styles of the preview elements XMind adds.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /editor\.html/.test(t.url));
const page = pages.find((t) => /xmind-samples/.test(decodeURIComponent(t.url)));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval failed');
  return res.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
await send('Page.bringToFront').catch(() => {});

const topics = await ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find((s) => s.querySelectorAll('path').length > 50);
  const out = [];
  for (const g of svg.querySelectorAll('g[data-view-id]')) {
    const fo = g.querySelector(':scope > foreignObject'); if (!fo) continue;
    const r = g.getBoundingClientRect(); if (r.width < 30 || r.height < 14) continue;
    out.push({ text: fo.textContent.trim().slice(0, 10), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  }
  return out;
})()`);
const src = topics.find((t) => t.text === '读书笔记');
const dst = topics.find((t) => t.text === '逻辑思考');
await mouse('mousePressed', src.x, src.y);
for (let i = 1; i <= 10; i++) { await wait(50); await mouse('mouseMoved', src.x + (dst.x - src.x) * (i / 10), src.y + (dst.y - src.y) * (i / 10)); }
await wait(600);

const dump = await ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find((s) => s.querySelectorAll('path').length > 50);
  // The preview lives in the last <g> children of the map root: dump every node
  // whose bounding box sits in the drop area and that carries svg: stroke.
  const root = svg.querySelector('g');
  const rows = [];
  for (const el of svg.querySelectorAll('g, path, rect, foreignObject')) {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) continue;
    const cs = getComputedStyle(el);
    const attrs = {};
    for (const a of el.getAttributeNames()) attrs[a] = (el.getAttribute(a) || '').slice(0, 90);
    rows.push({ tag: el.tagName, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      opacity: cs.opacity, stroke: cs.stroke, sw: cs.strokeWidth, dash: cs.strokeDasharray, fill: cs.fill,
      text: (el.tagName === 'foreignObject' ? el.textContent.trim().slice(0, 20) : ''), attrs });
  }
  return rows.filter((r) => r.rect[0] > 600 && r.rect[0] < 900);
})()`);
console.log(JSON.stringify(dump, null, 2));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('target/xmind-drag3.png', Buffer.from(shot.data, 'base64'));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(200);
await mouse('mouseReleased', dst.x, dst.y);
await wait(300);
ws.close();
