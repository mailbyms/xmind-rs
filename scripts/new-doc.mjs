// Reset the canvas to a fresh 5-topic map through the app's own menu
// (主菜单 → 文件 → 新建), so React state and the Rust document agree.
//
//   node scripts/new-doc.mjs
//
// Several UI assertions ("起点是干净的 5 主题文档 — 86 节点") only hold on a new
// document, so this runs before them.
const PORT = process.env.CDP_PORT || 9223;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: done, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : done(m.result);
  }
});
const send = (method, params = {}) => new Promise((done, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve: done, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const centre = (text) => ev(`(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll('.xm-item')].filter((b) => b.offsetParent !== null);
  const hit = all.find((b) => (b.querySelector('.xm-label')?.textContent ?? '').trim() === want)
    ?? all.find((b) => (b.querySelector('.xm-label')?.textContent ?? '').includes(want));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);

const [viewW, viewH] = (process.env.VIEW_SIZE || '1500x950').split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false,
});
await wait(300);

// A leftover panel or menu would eat the hamburger click.
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(200);
await clickAt(120, Math.round(viewH / 2));
await wait(200);

const burger = await ev(`(() => {
  const r = document.querySelector('.menu-btn').getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
await clickAt(burger.x, burger.y);
await wait(250);

for (const label of ['文件', '新建']) {
  const at = await centre(label);
  if (!at) throw new Error(`menu item not found: ${label}`);
  await move(at.x, at.y);
  await wait(200);
  if (label === '新建') { await clickAt(at.x, at.y); }
}
await wait(800);

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(200);
await clickAt(120, Math.round(viewH / 2));
await wait(200);

const title = await ev('document.querySelector(".doc-name")?.textContent ?? ""');
const nodes = await ev('document.querySelectorAll(".node").length');
console.log(`new document: title=${title} nodes=${nodes}`);
ws.close();
