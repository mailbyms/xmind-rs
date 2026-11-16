// Capture a clipped region at 2x from the original editor page.
// Usage: node scripts/cdp-shot-clip.mjs out.png x y w h [port]
import { writeFileSync } from 'node:fs';

const [out, xs, ys, wpx, hpx, portArg] = process.argv.slice(2);
const PORT = portArg || process.env.CDP_PORT || 9222;
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const res = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: Number(xs), y: Number(ys), width: Number(wpx), height: Number(hpx), scale: 2 },
});
writeFileSync(out, Buffer.from(res.data, 'base64'));
console.log('saved', out);
ws.close();
process.exit();
