// List every control on the shipped 画布 tab, so we can find the 配色方案 trigger.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const OUT = process.argv[2] || 'research/canvas-tab-buttons.json';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url)) ?? list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await wait(400);

const tabs = await evaluate(`[...document.querySelectorAll('.uk-tab a, .uk-tab li')].map(a => a.innerText.trim())`);
console.log('tabs:', JSON.stringify(tabs));

const clicked = await evaluate(`(() => {
  const a = [...document.querySelectorAll('.uk-tab a')].find(x => x.innerText.trim() === '画布');
  if (!a) return 'no tab';
  a.click();
  return 'ok';
})()`);
console.log('tab click:', clicked);
await wait(700);

const dump = await evaluate(`(() => {
  const panel = document.querySelector('.uk-format-panel');
  const out = [];
  for (const el of panel.querySelectorAll('*')) {
    const t = el.getAttribute('title');
    const cls = el.className && el.className.toString();
    if (!t && !/uk-button-popover|uk-palette|colorful|theme|scheme/i.test(cls || '')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    out.push({
      tag: el.tagName,
      title: t || '',
      cls: (cls || '').slice(0, 120),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      text: (el.innerText || '').trim().slice(0, 40),
      html: el.outerHTML.replace(/\\s+/g, ' ').slice(0, 300),
    });
  }
  return { sections: [...panel.querySelectorAll('.uk-format-panel-section')].map(s => ({ h: Math.round(s.getBoundingClientRect().height), text: s.innerText.trim().slice(0, 200) })), out };
})()`);
writeFileSync(OUT, JSON.stringify(dump, null, 2));
console.log('sections:', JSON.stringify(dump.sections, null, 1));
for (const o of dump.out) console.log(o.tag, o.rect.join(','), '|', o.title, '|', o.cls, '|', o.text);
ws.close();
