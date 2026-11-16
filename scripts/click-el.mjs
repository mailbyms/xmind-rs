// Click an element found by a CSS selector or by its exact trimmed text.
// Usage: node scripts/click-el.mjs "<css selector>" [text]
// Dispatches real CDP mouse events at the element centre so hover/press
// handlers of the shipped renderer fire exactly as they do for a user.
const PORT = process.env.CDP_PORT || 9222;
const selector = process.argv[2];
const text = process.argv[3];

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

const expr = `(() => {
  const t = ${JSON.stringify(text ?? null)};
  const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = t === null ? all[0]
    : all.find((n) => (n.textContent || '').trim().replace(/\\s+/g, ' ') === t)
      ?? all.find((n) => (n.textContent || '').includes(t));
  if (!el) return { error: 'not found', count: all.length };
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), cls: String(el.className).slice(0, 60) };
})()`;
const found = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
if (!found || found.error) {
  console.error('MISS', JSON.stringify(found));
  process.exit(1);
}
const { x, y } = found;
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
  });
}
console.log('clicked', JSON.stringify(found));
ws.close();
process.exit();
