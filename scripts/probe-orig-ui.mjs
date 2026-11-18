// Probe the shipped XMind's marker popover and image-topic context menu
// with a clean state before each interaction (CDP 9222).
// Usage: node scripts/probe-orig-ui.mjs [url-substring]
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
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
};
const reset = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await click(200, 700);
  await wait(350);
};
await send('Page.bringToFront');

console.log('=== 1. MARKER POPOVER ===');
await reset();
const marker = await ev(`(() => {
  const e = [...document.querySelectorAll('[data-view-id^="topic-marker-image:"]')].find(n => (n.getAttribute('data-view-id')||'').includes('star-red'));
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: e.getAttribute('data-view-id'), rect: [r.x, r.y, r.width, r.height] };
})()`);
console.log('marker target', JSON.stringify(marker));
if (marker) {
  await click(marker.x, marker.y);
  await wait(800);
  console.log(await ev(`JSON.stringify({
    opened: [...document.querySelectorAll('[class*="uk-popover"]')].filter(e => e.className.includes('uk-open'))
      .map(e => ({ cls: e.className, rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
        text: e.textContent.trim().slice(0, 200), html: e.outerHTML.slice(0, 7000) })),
    overlay: !!document.querySelector('.topic-popover-overlay'),
    imgsNearby: [...document.querySelectorAll('[data-view-id*="marker"], img')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.y > 400 && r.y < 700; }).length
  }, null, 1)`));
}

console.log('=== 2. IMAGE TOPIC: LEFT CLICK SELECT ===');
await reset();
const img = await ev(`(() => {
  const e = [...document.querySelectorAll('[data-view-id^="topic-image:"]')].find(n => n.getBoundingClientRect().width > 100);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: e.getAttribute('data-view-id'), rect: [r.x, r.y, r.width, r.height] };
})()`);
console.log('image target', JSON.stringify(img));
if (img) {
  await click(img.x, img.y);
  await wait(500);
  console.log(await ev(`JSON.stringify({
    selectionPaths: [...document.querySelectorAll('[data-view-id*="select"], [class*="selection"]')].map(e => ({ id: e.getAttribute('data-view-id'), cls: e.className?.toString().slice(0,80), rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() })).slice(0, 12),
    selectedClasses: [...document.querySelectorAll('[class*="selected"],[class*="uk-active"]')].map(e => e.className?.toString().slice(0, 90)).slice(0, 15),
    status: document.body.innerText.slice(0, 260)
  }, null, 1)`));
}

console.log('=== 3. IMAGE TOPIC: RIGHT CLICK MENU ===');
await reset();
if (img) {
  await click(img.x, img.y, 'right');
  await wait(800);
  console.log(await ev(`JSON.stringify({
    menus: [...document.querySelectorAll('[class*="menu"], [role="menu"], [class*="context"]')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 30; })
      .map(e => ({ cls: e.className?.toString().slice(0, 100), rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
        text: e.innerText?.slice(0, 500), html: e.outerHTML.slice(0, 2500) })).slice(0, 6),
    status: document.body.innerText.slice(0, 200)
  }, null, 1)`));
}
ws.close();
process.exit(0);
