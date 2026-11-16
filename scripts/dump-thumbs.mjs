// Extract the shipped palette/bone thumbnail artwork from the original XMind
// (rendered as data:image/svg+xml <img> sources) into public/thumbs/*.svg.
// Usage: node scripts/dump-thumbs.mjs [port] [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.argv[2] || 9222;
const OUT = resolve(process.argv[3] || 'public/thumbs');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url))
  ?? list.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: ok, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : ok(m.result);
  }
});
const send = (method, params = {}) => new Promise((ok, no) => {
  const mid = ++id;
  pending.set(mid, { resolve: ok, reject: no });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));

const expr = `(() => {
  const panel = document.querySelector('.uk-format-panel');
  const form = panel && panel.querySelector('form');
  const cards = form ? [...form.querySelectorAll('img')].map((img) => ({
    src: img.getAttribute('src'),
    w: Math.round(img.getBoundingClientRect().width),
    h: Math.round(img.getBoundingClientRect().height),
    card: img.parentElement.className,
  })) : [];
  const boneBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('思维导图'));
  const bone = boneBtn ? boneBtn.querySelector('img') : null;
  return JSON.stringify({
    cards,
    bone: bone ? { src: bone.getAttribute('src'), w: Math.round(bone.getBoundingClientRect().width), h: Math.round(bone.getBoundingClientRect().height) } : null,
  });
})()`;
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
const data = JSON.parse(res.result.value);

const decode = (src) => decodeURIComponent(src.replace(/^data:image\/svg\+xml,/, ''));
const save = (name, src) => {
  const svg = decode(src);
  writeFileSync(resolve(OUT, name), svg, 'utf8');
  return { name, bytes: Buffer.byteLength(svg), head: svg.slice(0, 120) };
};

const out = [];
data.cards.forEach((card, i) => out.push(save(`palette-${i + 1}.svg`, card.src)));
if (data.bone) out.push(save('bone-map.svg', data.bone.src));
console.log(JSON.stringify({ out, sizes: data.cards.map((c) => [c.w, c.h]), boneSize: data.bone && [data.bone.w, data.bone.h] }, null, 1));
ws.close();
process.exit();
