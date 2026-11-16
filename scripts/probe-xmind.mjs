// Ad-hoc probe into the *original* XMind renderer (port 9222).
//   node scripts/probe-xmind.mjs "<expression>"
// XMind keeps the live map in the `editor.html` page target.
const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url) && !/editor-frame/.test(t.url))
  ?? list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e9);
  const onMsg = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
import { readFileSync } from 'node:fs';
const raw = process.argv[2] ?? '';
// `@path` reads the expression from a file — long expressions blow up shell quoting.
const expr = raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw;
const out = await send('Runtime.evaluate', {
  expression: expr, returnByValue: true, awaitPromise: true,
});
if (out.exceptionDetails) console.error(out.exceptionDetails.exception?.description ?? JSON.stringify(out.exceptionDetails));
else console.log(typeof out.result.value === 'string' ? out.result.value : JSON.stringify(out.result.value, null, 2));
ws.close();
