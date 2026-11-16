// Click at viewport coordinates through CDP Input events.
// Usage: node scripts/cdp-click.mjs x y [port]
const x = Number(process.argv[2]);
const y = Number(process.argv[3]);
const PORT = process.argv[4] || process.env.CDP_PORT || 9222;

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
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
await new Promise((r) => ws.addEventListener('open', r));
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
  });
}
console.log('clicked', x, y);
ws.close();
process.exit();
