// Read exact topic geometry from the shipped XMind canvas (CDP 9222).
const needle = process.argv[2] || 'test.xmind';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('editor.html')
  && !t.url.includes('editor-frame') && decodeURIComponent(t.url).includes(needle));
if (!page) { console.error('no page'); process.exit(1); }
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
console.log(await ev(`(() => {
  const anchors = [...document.querySelectorAll('[data-view-id^="topic-title:"]')];
  const out = anchors.map((fo) => {
    const id = fo.getAttribute('data-view-id').slice(12);
    // climb to the topic group: the closest <g> that also holds a shape path
    let g = fo.parentElement;
    while (g && g.tagName.toLowerCase() !== 'g') g = g.parentElement;
    const shapes = [...document.querySelectorAll('path')].filter((p) => {
      const d = p.getAttribute('d') || '';
      return d.length > 20 && p.getBoundingClientRect().width > 20;
    });
    const bb = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    const imgs = [...document.querySelectorAll('[data-view-id^="topic-image:"]')].map((i) => ({ id: i.getAttribute('data-view-id').slice(12, 20), w: i.getAttribute('width'), h: i.getAttribute('height'), rect: bb(i) }));
    return { id: id.slice(0, 8), title: fo.textContent.trim().slice(0, 24), fo: bb(fo), gCls: g?.getAttribute('class'), gAttrs: g ? [...g.attributes].slice(0, 8).map(a => [a.name, a.value]) : null };
  });
  const paths = [...document.querySelectorAll('path')].map((p) => ({ d: (p.getAttribute('d')||'').slice(0, 60), fill: p.getAttribute('fill'), stroke: p.getAttribute('stroke'), sw: p.getAttribute('stroke-width'), rect: (() => { const r = p.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() })).filter((p) => p.rect[2] > 30 && p.rect[3] > 20).slice(0, 20);
  return JSON.stringify({ topics: out, paths }, null, 1);
})()`));
ws.close();
process.exit(0);
