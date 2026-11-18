// Probe the shipped XMind's in-topic decorators: exact padding, hit targets,
// marker popover and image-topic right-click menu (CDP 9222).
// Usage: node scripts/probe-orig-interact.mjs [url-substring] [--click-marker] [--right-image]
const needle = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'test.xmind';
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pages = list.filter((t) => t.type === 'page' && t.url.includes('editor.html')
  && !t.url.includes('editor-frame') && decodeURIComponent(t.url).includes(needle));
if (!pages.length) { console.error('no editor page for', needle); process.exit(1); }
const page = pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result.value;
};

console.log('=== GEOMETRY (relative to the central shape) ===');
console.log(await ev(`(() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); };
  const paths = [...document.querySelectorAll('path')].filter(p => { const r = p.getBoundingClientRect(); return r.width > 200 && r.width < 400 && r.height >= 65 && r.height < 80 && (p.getAttribute('fill') || '').length > 0; });
  // The central shape is the leftmost wide path inside the viewport; the
  // selection outline (328x74) is 2px larger and drawn on top of it.
  const shape = paths.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
  if (!shape) return JSON.stringify({ error: 'no central shape', paths: [...document.querySelectorAll('path')].map(p => R(p)).filter(r => r[2] > 100) });
  const box = R(shape);
  const rel = (e) => { const r = R(e); return { id: e.getAttribute('data-view-id') || e.tagName, rect: r, dx: Math.round((r[0] - box[0]) * 10) / 10, dy: Math.round((r[1] - box[1]) * 10) / 10, rightGap: Math.round((box[0] + box[2] - r[0] - r[2]) * 10) / 10 }; };
  const els = [...document.querySelectorAll('[data-view-id]')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.x >= box[0] - 12 && r.x <= box[0] + box[2] + 12 && r.y >= box[1] - 12 && r.y <= box[1] + box[3] + 12;
  });
  const detail = els.map(e => ({
    ...rel(e), tag: e.tagName,
    attrs: [...e.attributes].filter(a => !['href','d','style'].includes(a.name)).map(a => [a.name, a.value.slice(0, 90)]),
    cursor: getComputedStyle(e).cursor,
    pointerEvents: getComputedStyle(e).pointerEvents,
    parentTag: e.parentElement?.tagName,
    parentTransform: e.parentElement?.getAttribute('transform'),
    parentId: e.parentElement?.getAttribute('data-view-id'),
  }));
  return JSON.stringify({ box, shape: { d: (shape.getAttribute('d')||'').slice(0, 120), fill: shape.getAttribute('fill') }, elements: detail }, null, 1);
})()`));

console.log('=== ALL DECORATOR VIEW IDS ===');
console.log(await ev(`JSON.stringify([...document.querySelectorAll('[data-view-id]')]
  .filter(e => /marker|image|info|label/.test(e.getAttribute('data-view-id') || ''))
  .map(e => ({ id: e.getAttribute('data-view-id'), tag: e.tagName,
    cursor: getComputedStyle(e).cursor, pe: getComputedStyle(e).pointerEvents,
    rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() })), null, 1)`));

if (flags.includes('--click-marker')) {
  console.log('=== CLICK FIRST MARKER ===');
  const pos = await ev(`(() => {
    const e = document.querySelector('[data-view-id^="topic-marker-image:"]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })()`);
  if (pos) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos[0], y: pos[1], button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos[0], y: pos[1], button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 900));
    console.log('--- popover HTML ---');
    console.log(await ev(`(() => {
      const p = document.querySelector('.uk-popover.uk-open') || document.querySelector('[class*=uk-popover]');
      return p ? p.outerHTML.slice(0, 9000) : 'NO_POPOVER';
    })()`));
    console.log('--- overlay / newly added nodes ---');
    console.log(await ev(`JSON.stringify({
      popovers: [...document.querySelectorAll('[class*=popover],[class*=uk-pop]')]
        .map(e => ({ cls: e.className?.toString().slice(0, 110), rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(), text: e.textContent.trim().slice(0, 200), html: e.outerHTML.slice(0, 700) })).slice(-6),
      overlay: !!document.querySelector('.topic-popover-overlay'),
      buttons: [...document.querySelectorAll('.uk-popover button, [class*=popover] button')].map(b => ({ title: b.title, aria: b.getAttribute('aria-label'), html: b.outerHTML.slice(0, 260) })).slice(0, 20)
    }, null, 1)`));
  } else console.log('no marker element');
}

if (flags.includes('--right-image')) {
  console.log('=== RIGHT CLICK IMAGE TOPIC ===');
  const pos = await ev(`(() => {
    const e = [...document.querySelectorAll('[data-view-id^="topic-image:"]')][0]
      || [...document.querySelectorAll('image')].filter(i => i.getBoundingClientRect().width > 50)[0];
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2, e.getAttribute('data-view-id')];
  })()`);
  console.log('target', JSON.stringify(pos));
  if (pos) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos[0], y: pos[1], button: 'right', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos[0], y: pos[1], button: 'right', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 900));
    console.log(await ev(`JSON.stringify({
      menus: [...document.querySelectorAll('[class*=menu],[class*=context],[role=menu]')]
        .filter(e => e.getBoundingClientRect().width > 40 && e.getBoundingClientRect().height > 20)
        .map(e => ({ cls: e.className?.toString().slice(0, 80), text: e.textContent.trim().slice(0, 260),
          rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() })).slice(0, 10),
      selected: [...document.querySelectorAll('[class*=selected],[class*=active]')].map(e => e.className?.toString().slice(0, 60)).slice(0, 15)
    }, null, 1)`));
  }
}
ws.close();
process.exit(0);
