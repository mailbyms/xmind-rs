// Diff the shipped XMind DOM around image-topic selection / right-click.
// Usage: node scripts/probe-orig-image.mjs [url-substring]
const needle = process.argv[2] || 'test.xmind';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pages = list.filter((t) => t.type === 'page' && t.url.includes('editor.html')
  && !t.url.includes('editor-frame') && decodeURIComponent(t.url).includes(needle));
if (!pages.length) { console.error('no editor page'); process.exit(1); }
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y, button = 'left') => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
};
await send('Page.bringToFront');
const snap = () => ev(`JSON.stringify({
  ids: [...document.querySelectorAll('[data-view-id]')].map(e => e.getAttribute('data-view-id')),
  visible: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 18 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'; })
    .map(e => (e.className?.toString() || e.tagName).slice(0, 70)).slice(-70),
  texts: [...document.querySelectorAll('li,button,[role=menuitem]')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.innerText?.trim().slice(0, 30)).filter(Boolean).slice(-60)
})`);
const diff = (a, b) => {
  const A = JSON.parse(a), B = JSON.parse(b);
  return {
    addedIds: B.ids.filter((x) => !A.ids.includes(x)),
    removedIds: A.ids.filter((x) => !B.ids.includes(x)),
    addedTexts: B.texts.filter((x) => !A.texts.includes(x)),
    tailClasses: B.visible.slice(-18),
  };
};
const img = await ev(`(() => {
  const e = [...document.querySelectorAll('[data-view-id^="topic-image:"]')].find(n => n.getBoundingClientRect().width > 100);
  const r = e.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: e.getAttribute('data-view-id') };
})()`);
console.log('image', JSON.stringify(img));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(300);
const before = await snap();
await click(img.x, img.y);
await wait(600);
const afterSelect = await snap();
console.log('=== AFTER LEFT CLICK (diff) ===');
console.log(JSON.stringify(diff(before, afterSelect), null, 1));
console.log('=== SELECTION-ISH ELEMENTS ===');
console.log(await ev(`JSON.stringify([...document.querySelectorAll('[data-view-id]')]
  .filter(e => /select|outline|frame|border|highlight/i.test(e.getAttribute('data-view-id')||''))
  .map(e => ({ id: e.getAttribute('data-view-id'), tag: e.tagName,
    stroke: e.getAttribute('stroke'), fill: e.getAttribute('fill'),
    rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() })), null, 1)`));
await click(img.x, img.y, 'right');
await wait(700);
const afterRight = await snap();
console.log('=== AFTER RIGHT CLICK (diff) ===');
console.log(JSON.stringify(diff(afterSelect, afterRight), null, 1));
console.log('=== ANY VISIBLE MENU-LIKE NODES ===');
console.log(await ev(`JSON.stringify([...document.querySelectorAll('body *')].filter(e => {
  const r = e.getBoundingClientRect(); const c = (e.className?.toString()||'');
  return r.width > 60 && r.height > 25 && /menu|dropdown|pop|context|list/i.test(c) && getComputedStyle(e).display !== 'none';
}).map(e => ({ cls: e.className?.toString().slice(0,100), tag: e.tagName, text: e.innerText?.slice(0,400),
  rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() })).slice(-14), null, 1)`));
ws.close();
process.exit(0);
