// Read the visual tokens of the 配色方案 panel: capsule tabs, group headings,
// swatch cells (incl. the selected ring), scroll container.
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await ev(`(() => { const a = [...document.querySelectorAll('.uk-tab a')].find(x => x.innerText.trim() === '画布'); a && a.click(); })()`);
await new Promise((r) => setTimeout(r, 400));
await ev(`(() => { const b = document.querySelector('button[title="选择配色方案。"]'); b.scrollIntoView({ block: 'center' }); if (b.getAttribute('aria-expanded') !== 'true') b.click(); })()`);
await new Promise((r) => setTimeout(r, 800));

const out = await ev(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  if (!pop) return { error: 'no panel', open: [...document.querySelectorAll('.uk-pop.uk-open')].map((x) => x.className.toString()) };
  const pr = pop.getBoundingClientRect();
  const cs = getComputedStyle(pop);
  const groups = [...pop.querySelectorAll('.smart-color-theme-group')].slice(0, 3).map((g) => {
    const cell = g.querySelector('.smart-color-theme-group-cell');
    const cc = getComputedStyle(cell);
    const h = g.querySelector('h5');
    const hc = getComputedStyle(h);
    return {
      name: h.innerText.trim(),
      cls: cell.className.toString(),
      radius: cc.borderRadius,
      border: cc.border,
      shadow: cc.boxShadow.slice(0, 140),
      h5: { size: hc.fontSize, weight: hc.fontWeight, color: hc.color, h: Math.round(h.getBoundingClientRect().height) },
    };
  });
  const tabA = [...pop.querySelectorAll('.uk-tab a')].map((a) => {
    const ac = getComputedStyle(a);
    const li = a.closest('li');
    return {
      label: a.innerText.trim(), active: /uk-active/.test(li.className), bg: ac.backgroundColor,
      color: ac.color, fs: ac.fontSize, fw: ac.fontWeight, r: ac.borderRadius,
      h: Math.round(a.getBoundingClientRect().height), w: Math.round(a.getBoundingClientRect().width),
      liCls: li.className.toString(),
    };
  });
  const scroll = [...pop.querySelectorAll('*')].filter((e) => {
    const s = getComputedStyle(e);
    return /auto|scroll/.test(s.overflowY) && e.getBoundingClientRect().height > 100;
  }).map((e) => ({
    cls: e.className.toString().slice(0, 70), h: Math.round(e.getBoundingClientRect().height),
    w: Math.round(e.getBoundingClientRect().width), sh: e.scrollHeight, pad: getComputedStyle(e).padding,
  }));
  const ul = pop.querySelector('ul.uk-tab');
  const ulc = ul ? getComputedStyle(ul) : null;
  return {
    pop: { w: Math.round(pr.width), h: Math.round(pr.height), radius: cs.borderRadius, bg: cs.backgroundColor, shadow: cs.boxShadow.slice(0, 220), pad: cs.padding },
    groups, tabA,
    tab: ul ? { bg: ulc.backgroundColor, pad: ulc.padding, h: Math.round(ul.getBoundingClientRect().height), pos: ulc.position } : null,
    scroll,
  };
})()`);
writeFileSync('research/theme-styles.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await ev(`(() => { for (const t of ['keyDown','keyUp']) {} })()`);
ws.close();
