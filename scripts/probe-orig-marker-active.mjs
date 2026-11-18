const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((x) => /editor\.html/.test(x.url) && !/editor-frame/.test(x.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, resolve);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => {
    if (pending.has(i)) {
      pending.delete(i);
      reject(new Error(`timeout ${method}`));
    }
  }, 10000);
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};
const tabs = await ev(`(() => {
  const els = [...document.querySelectorAll('.icon-panel .uk-tab li')];
  return els.map((e) => ({ cls: e.className, x: e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2, y: e.getBoundingClientRect().y + e.getBoundingClientRect().height / 2 }));
})()`);
console.log('TABS', tabs);
const first = tabs[0];
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x, y: first.y });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: first.x, y: first.y, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 500));
const item = await ev(`(() => {
  const el = document.querySelector('.marker-module .icon-image-item');
  const r = el.getBoundingClientRect();
  return { before: el.outerHTML, x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
console.log('BEFORE', item.before);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: item.x, y: item.y });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: item.x, y: item.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: item.x, y: item.y, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 600));
console.log('AFTER', await ev(`document.querySelector('.marker-module .icon-image-item').outerHTML`));
console.log('PANEL_CLASSES', await ev(`[...document.querySelectorAll('.marker-module *')].filter(e => /active|checked|selected|on/.test(typeof e.className === 'string' ? e.className : '')).slice(0,20).map(e => e.className)`));
ws.close();
