// Dump the shipped XMind canvas SVG structure (CDP 9222).
// Usage: node scripts/probe-orig-svg.mjs <url-substring>
const needle = process.argv[2] || 'test.xmind';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('editor.html')
  && !t.url.includes('editor-frame') && decodeURIComponent(t.url).includes(needle));
if (!page) { console.error('no page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result.value;
};
console.log(await ev(`(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const svgs = [...document.querySelectorAll('svg')].slice(0, 8).map((s) => ({ cls: s.getAttribute('class'), id: s.getAttribute('id'), rect: (() => { const r = s.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() }));
  const fos = [...document.querySelectorAll('foreignObject')].slice(0, 10).map((f) => ({
    attrs: [...f.attributes].map((a) => [a.name, a.value]).slice(0, 10),
    text: f.textContent.trim().slice(0, 30),
    parent: f.parentElement?.getAttribute('class') || f.parentElement?.getAttribute('id'),
    rect: (() => { const r = f.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
  }));
  const imgs = [...document.querySelectorAll('image')].slice(0, 10).map((i) => ({
    attrs: [...i.attributes].map((a) => [a.name, a.value]).slice(0, 12),
    rect: (() => { const r = i.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
  }));
  const classes = {};
  for (const g of document.querySelectorAll('g')) {
    const c = g.getAttribute('class') || '(none)';
    classes[c] = (classes[c] || 0) + 1;
  }
  return JSON.stringify({ counts: { svg: q('svg'), g: q('g'), fo: q('foreignObject'), image: q('image'), path: q('path'), topicClass: q('[class*=topic]') }, classes: Object.entries(classes).slice(0, 30), svgs, fos, imgs }, null, 1);
})()`));
ws.close();
process.exit(0);
