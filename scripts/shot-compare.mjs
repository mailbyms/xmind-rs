// Capture a clean, 100%-zoom, panel-free screenshot of an already-open map in
// this app, so it can be compared with the shipped XMind (1280x820 viewport).
// Usage: CDP_PORT=9225 node scripts/shot-compare.mjs out.png
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9225;
const out = process.argv[2] || 'target/verify/ours-test-clean.png';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.addEventListener('open', r));

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
await wait(500);

// The shipped XMind screenshot has no right-side inspector.  Toggle ours off
// through its toolbar button (the same UI path a user would take).
const panelBefore = await ev(`!!document.querySelector('aside.fp')`);
if (panelBefore) {
  await ev(`(() => {
    const item = [...document.querySelectorAll('.tool-item')].find((n) => n.textContent.trim() === '格式');
    const b = item?.querySelector('button[title="显示或隐藏样式及格式设置"]') ?? item?.querySelector('button');
    if (b) { b.click(); return 'clicked'; }
    return 'missing';
  })()`);
  await wait(600);
}

// Force 100% via the status-bar zoom menu when it is not already there.
let zoom = await ev(`document.querySelector('.sb-zoom-label')?.textContent ?? ''`);
if (!zoom.includes('100')) {
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const btn = await ev(`(() => { const b = document.querySelector('.sb-zoom'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (btn) {
    await clickAt(btn.x, btn.y);
    await wait(250);
    const item = await ev(`(() => { const b = [...document.querySelectorAll('.zoom-item')].find(n => n.textContent.trim() === '100%'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    if (item) { await clickAt(item.x, item.y); await wait(400); }
  }
  zoom = await ev(`document.querySelector('.sb-zoom-label')?.textContent ?? ''`);
}

const doc = await ev(`document.querySelector('.doc-name')?.textContent ?? ''`);
const nodes = await ev(`document.querySelectorAll('.node').length`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify({ out, doc, nodes, zoom, panelBefore, panelAfter: await ev(`!!document.querySelector('aside.fp')`), viewport: '1280x820' }));
ws.close();
