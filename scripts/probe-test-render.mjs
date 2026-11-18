// Probe the shipped XMind DOM for one open document (CDP 9222).
// Usage: node scripts/probe-test-render.mjs <url-substring> [out.json]
import { writeFileSync } from 'node:fs';

const needle = process.argv[2] || 'test.xmind';
const out = process.argv[3] || '';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('editor.html')
  && !t.url.includes('editor-frame') && decodeURIComponent(t.url).includes(needle));
if (!page) { console.error('no page for', needle); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result.value;
};

const data = await ev(`(() => {
  const viewer = document.querySelector('.sheet-viewer.active') || document.querySelector('.sheet-viewer');
  const cs = viewer ? getComputedStyle(viewer) : null;
  const groups = [...document.querySelectorAll('[data-topic-id]')];
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const topics = groups.slice(0, 12).map((g) => {
    const fo = g.querySelector(':scope > foreignObject') || g.querySelector('foreignObject');
    const img = g.querySelector('image');
    const path = g.querySelector('path');
    const tx = fo?.textContent?.trim().slice(0, 40) ?? g.textContent?.trim().slice(0, 40);
    return {
      id: g.getAttribute('data-topic-id')?.slice(0, 8),
      cls: g.getAttribute('class'),
      text: tx,
      group: rect(g),
      fo: rect(fo),
      img: rect(img),
      imgHref: img?.getAttribute('xlink:href') || img?.getAttribute('href') || null,
      path: rect(path),
      pathFill: path?.getAttribute('fill'),
      pathD: path?.getAttribute('d')?.slice(0, 90),
      foStyle: fo ? (() => { const d = fo.querySelector('div'); const s = d ? getComputedStyle(d) : null; return s ? { color: s.color, fontSize: s.fontSize, fontFamily: s.fontFamily, fontWeight: s.fontWeight, textAlign: s.textAlign } : null; })() : null,
      html: g.outerHTML.slice(0, 500),
    };
  });
  return JSON.stringify({
    viewport: [innerWidth, innerHeight],
    viewerBg: cs ? cs.backgroundColor : null,
    viewerHtmlBg: viewer?.getAttribute('style')?.slice(0, 200),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    topicCount: groups.length,
    topics,
  });
})()`);
console.log(data.slice(0, 20000));
if (out) writeFileSync(out, data);
ws.close();
process.exit(0);
