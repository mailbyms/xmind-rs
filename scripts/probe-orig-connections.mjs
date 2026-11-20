// Dump original XMind connection geometry for the open document (CDP 9222).
// Usage: node scripts/probe-orig-connections.mjs <url-needle> [out.json]
import { writeFileSync } from 'node:fs';

const needle = process.argv[2] || 'test2.xmind';
const outPath = process.argv[3] || '';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) =>
  t.type === 'page' && t.url.includes('editor.html')
  && !t.url.includes('editor-frame')
  && decodeURIComponent(t.url).includes(needle));
if (!page) { console.error('no page for', needle); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));

const expression = `(() => {
  const bb = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const conns = [...document.querySelectorAll('[data-view-id^="topic-connection:"]')].map((e) => {
    const path = e.tagName.toLowerCase() === 'path' ? e : e.querySelector('path');
    return {
      id: e.getAttribute('data-view-id'),
      tag: e.tagName.toLowerCase(),
      d: (path?.getAttribute('d') || '').slice(0, 240),
      stroke: path?.getAttribute('stroke') || '',
      rect: bb(e),
      pathRect: bb(path),
    };
  });
  const nodes = [...document.querySelectorAll('[data-view-id^="topic-node:"]')].map((e) => {
    const title = e.querySelector('[data-view-id^="topic-title:"]')?.textContent?.trim().slice(0, 30) || '';
    const border = e.querySelector('[data-view-id^="topic-node-border:"]');
    return { id: e.getAttribute('data-view-id'), title, rect: bb(e), borderRect: bb(border),
      borderD: (border?.getAttribute('d') || '').slice(0, 120) };
  });
  return JSON.stringify({ connections: conns, nodes }, null, 1);
})()`;
const result = await send('Runtime.evaluate', { expression, returnByValue: true });
if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed');
const text = result.result.value;
console.log(text);
if (outPath) writeFileSync(outPath, text);
ws.close();
process.exit(0);
