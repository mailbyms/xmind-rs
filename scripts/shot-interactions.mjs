// Capture evidence screenshots for the two new in-topic interactions
// (marker replacement popover, image selection + context menu).
// Usage: CDP_PORT=9231 node scripts/shot-interactions.mjs marker.png image.png
import { writeFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT || '9231';
const [markerOut, imageOut] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (out) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r?.data) throw new Error('screenshot failed');
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  console.log('saved', out);
};
const fire = (selector, type = 'click') => ev(`(() => {
  const e = document.querySelector(${JSON.stringify(selector)});
  if (!e) return false;
  e.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, clientX: 400, clientY: 450 }));
  return true;
})()`);
const escape = () => ev(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
// Aim at the largest artwork (the 140x140 illustration) so the blue outline
// and its four handles are clearly visible in the evidence shot.
const fireBigImage = (type = 'click') => ev(`(() => {
  const imgs = [...document.querySelectorAll('.node.has-image .node-image')];
  const e = imgs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!e) return false;
  const r = e.getBoundingClientRect();
  e.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, {
    bubbles: true, cancelable: true,
    clientX: Math.round(r.right + 8), clientY: Math.round(r.top + 24),
  }));
  return true;
})()`);
await new Promise((r) => ws.addEventListener('open', r));
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
await wait(400);

console.log('marker chip click:', await fire('.marker-chip[data-marker-id="star-red"]'));
await wait(350);
await shot(markerOut || 'target/verify/ours-marker-popover.png');
await escape();
await wait(180);

console.log('image click:', await fireBigImage());
await wait(180);
console.log('image right click:', await fireBigImage('contextmenu'));
await wait(300);
await shot(imageOut || 'target/verify/ours-image-menu.png');
await escape();
await ev(`(() => { const n = document.querySelector('.canvas');
  n?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1100, clientY: 700 })); return true; })()`);
ws.close();
process.exit(0);
