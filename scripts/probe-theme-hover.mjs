// Hover a 配色方案 swatch and dump the overlay / switch styling that appears.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
let target = null;
for (const t of pages) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let i = 0; const p = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
  await new Promise((r) => ws.addEventListener('open', r));
  const ev = (x) => new Promise((r) => { const id = ++i; p.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: x, returnByValue: true } })); });
  const v = await ev('!!document.querySelector(".uk-format-panel")');
  ws.close();
  if (v.result?.value) { target = t; break; }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let i = 0; const p = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((r) => { const id = ++i; p.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result.value;
};
await ev(`(() => { const a = [...document.querySelectorAll('.uk-tab a')].find(x => x.innerText.trim() === '画布'); a && a.click(); })()`);
await new Promise((r) => setTimeout(r, 350));
await ev(`(() => { const b = document.querySelector('button[title="选择配色方案。"]'); b.scrollIntoView({ block: 'center' }); if (b.getAttribute('aria-expanded') !== 'true') b.click(); })()`);
await new Promise((r) => setTimeout(r, 700));
const box = await ev(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  const g = pop.querySelectorAll('.smart-color-theme-group')[1];
  const r = g.querySelector('.smart-color-theme-group-cell').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
await new Promise((r) => setTimeout(r, 400));
const out = await ev(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  const g = pop.querySelectorAll('.smart-color-theme-group')[1];
  const ov = g.querySelector('.smart-color-theme-group-cell-overlay');
  const sw = g.querySelector('.smart-color-theme-group-cell-switch');
  const info = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { cls: el.className.toString(), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, opacity: cs.opacity, display: cs.display, color: cs.color, fontSize: cs.fontSize, radius: cs.borderRadius, text: (el.innerText || '').trim().slice(0, 20) };
  };
  return { overlay: info(ov), sw: info(sw), cell: info(g.querySelector('.smart-color-theme-group-cell')), switchHtml: sw ? sw.outerHTML.replace(/\\s+/g, ' ').slice(0, 700) : null };
})()`);
writeFileSync('research/theme-hover.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('target/theme-hover.png', Buffer.from(shot.data, 'base64'));
ws.close();
