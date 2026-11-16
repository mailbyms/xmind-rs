// Capture a screenshot of the XMind editor page via CDP.
// Usage: node scripts/cdp-shot.mjs out.png [port]
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'shot.png';
const PORT = process.argv[3] || process.env.CDP_PORT || 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url))
  ?? list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

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

await new Promise((r) => ws.addEventListener('open', r));
const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(out, Buffer.from(res.data, 'base64'));
console.log('saved', out);
ws.close();
process.exit();
