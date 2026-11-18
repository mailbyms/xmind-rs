// Screenshot one original-XMind window, chosen by a substring of its source path.
// Usage: node scripts/shot-orig.mjs <path-substring> <out.png>
import { writeFileSync } from 'node:fs';

const [, , needle, out] = process.argv;
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const cands = list.filter((t) => t.type === 'page' && decodeURIComponent(t.url).includes(needle));
if (!cands.length) { console.error('no target for', needle); process.exit(1); }
// Prefer the shell (editor.html): the canvas lives in a BrowserView child.
const target = cands.find((t) => t.url.includes('editor.html')) ?? cands[0];

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; setTimeout(() => j(new Error('ws timeout')), 10000); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
const shot = await Promise.race([
  send('Page.captureScreenshot', { format: 'png' }),
  new Promise((r) => setTimeout(() => r(null), 15000)),
]);
if (!shot?.data) { console.error('screenshot timeout'); process.exit(2); }
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
ws.close();
process.exit(0);
