// Resize the page target's OS window via CDP Browser domain.
// Usage: node scripts/cdp-window.mjs [width] [height]   (omit size to maximise)
const PORT = process.env.CDP_PORT || 9222;
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

const { windowId, bounds } = await send('Browser.getWindowForTarget', { targetId: page.id });
const width = Number(process.argv[2]);
const height = Number(process.argv[3]);
const next = width && height
  ? { windowState: 'normal', width, height, left: bounds.left, top: bounds.top }
  : { windowState: 'maximized' };
await send('Browser.setWindowBounds', { windowId, bounds: next });
console.log('window', windowId, 'from', JSON.stringify(bounds), 'to', JSON.stringify(next));
ws.close();
process.exit();
