// Dump the 配色方案 row (trigger + "+" + the 3x2 preview grid) on the 画布 tab.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
let page = null;
for (const t of pages) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let rid = 0; const mp = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && mp.has(m.id)) { mp.get(m.id)(m.result); mp.delete(m.id); } });
  await new Promise((r) => ws.addEventListener('open', r));
  const ev = (expr) => new Promise((r) => { const i = ++rid; mp.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
  const v = await ev('!!document.querySelector(".uk-format-panel")');
  ws.close();
  if (v.result?.value) { page = t; break; }
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await evaluate(`(() => { const a=[...document.querySelectorAll('.uk-tab a')].find(x=>x.innerText.trim()==='画布'); a&&a.click(); })()`);
await wait(500);
const dump = await evaluate(`(() => {
  const btn = document.querySelector('button[title="选择配色方案。"]');
  let row = btn.parentElement;
  const chain = [];
  for (let i = 0; i < 4 && row; i++, row = row.parentElement) {
    const r = row.getBoundingClientRect();
    chain.push({ cls: row.className.toString().slice(0, 140), rect: [Math.round(r.width), Math.round(r.height)], html: row.innerHTML.replace(/\\s+/g, ' ').slice(0, 2500) });
  }
  const imgs = [...document.querySelectorAll('img')].filter(i => /palette|thumb/i.test(i.getAttribute('src') || '')).map(i => { const r = i.getBoundingClientRect(); return { src: i.getAttribute('src').slice(0, 80), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; });
  return { chain, imgs };
})()`);
writeFileSync('research/theme-row.json', JSON.stringify(dump, null, 2));
for (const c of dump.chain) console.log(c.cls, c.rect.join('x'), '\n  ', c.html.slice(0, 900), '\n');
console.log('imgs', JSON.stringify(dump.imgs, null, 1));
ws.close();
