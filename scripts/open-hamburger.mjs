// Open the original app's hamburger menu with real mouse events (native menus
// need a genuine input event, not a synthetic .click()).
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url) && /source=new/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++id; pending.set(mid, { resolve }); ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const r = await send('Runtime.evaluate', {
  expression: `(() => { const b = document.querySelector('button.main-menu-btn'); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`,
  returnByValue: true,
});
const { x, y } = r.result.value;
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
}
await new Promise((r) => setTimeout(r, 400));
console.log('opened at', x, y);
ws.close();
process.exit();
