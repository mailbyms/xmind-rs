// Screenshot the shipped XMind canvas at a fixed 1500x950 viewport.
//   node scripts/shot-orig-underline.mjs [out.png]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const WANT = process.env.ORIG_FILE || 'example.xmind';
const out = resolve(process.argv[2] || 'target/verify/underline/orig-view.png');
mkdirSync(dirname(out), { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && decodeURIComponent(t.url).includes(WANT));
if (!page) throw new Error(`no editor page for ${WANT}`);
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
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 900));
console.log('topics', await ev('document.querySelectorAll("[data-view-id^=\\"topic-node:\\"]").length'));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('shot ->', out);
ws.close();
process.exit(0);
