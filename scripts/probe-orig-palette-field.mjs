// Dump exactly the shipped 画布 > 配色方案 sub-section: the trigger, the six
// cards below it, and how they react to selecting a different scheme.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/palette');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((r) => {
    const mid = ++id; pending.set(mid, r);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r.result?.value;
  };
  return { ws, ready, send, ev };
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
const c = connect(page.webSocketDebuggerUrl);
await c.ready;
await c.ev(`(() => { const a=[...document.querySelectorAll('.uk-tab a, .uk-tab button')].find(x=>(x.innerText||'').trim()==='画布'); if(a)a.click(); })()`);
await wait(350);

const FIELD = `(() => {
  const btn = document.querySelector('button[title="选择配色方案。"]');
  if (!btn) return { error: 'no trigger' };
  const sub = btn.closest('.uk-format-panel-sub-section') || btn.parentElement.parentElement;
  const short = (el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: (el.className||'').toString().slice(0,130),
      title: el.getAttribute('title')||'', text: (el.innerText||'').trim().slice(0,40),
      w: Math.round(r.width), h: Math.round(r.height), kids: el.children.length };
  };
  // All clickable-looking descendants that could be one of the six cards.
  const candidates = [...sub.querySelectorAll('button, [class*="card"], [class*="cell"], [class*="item"]')]
    .filter(e => { const r=e.getBoundingClientRect(); return r.width>40 && r.width<160 && r.height>18 && r.height<90; });
  return {
    triggerText: (btn.innerText||'').trim(),
    triggerHtml: btn.outerHTML.replace(/\\s+/g,' ').slice(0,900),
    sub: short(sub),
    subText: (sub.innerText||'').trim().slice(0,300),
    candidates: candidates.slice(0,20).map(e => ({ ...short(e), html: e.outerHTML.replace(/\\s+/g,' ').slice(0,600) })),
    children: [...sub.children].map(short),
    html: sub.outerHTML.replace(/\\s+/g,' ').slice(0,7000),
  };
})()`;

const before = await c.ev(FIELD);
// Pick 活力 from the gallery.
await c.ev(`(() => { const b=document.querySelector('button[title="选择配色方案。"]'); if(b && b.getAttribute('aria-expanded')!=='true') b.click(); })()`);
await wait(550);
const picked = await c.ev(`(() => {
  const pop=[...document.querySelectorAll('.uk-pop.uk-open')].find(p=>p.querySelector('.smart-color-theme-group'));
  if(!pop) return 'no pop';
  const g=pop.querySelectorAll('.smart-color-theme-group')[1];
  const name=(g?.querySelector('.theme-name-label')?.innerText||'').trim();
  g?.querySelector('.smart-color-theme-group-cell')?.click();
  return name;
})()`);
await wait(700);
const after = await c.ev(FIELD);

const out = { picked, before, after };
writeFileSync(resolve(OUT, 'orig-palette-field.json'), JSON.stringify(out, null, 1));
console.log('picked:', picked);
console.log('trigger:', JSON.stringify(before.triggerText), '->', JSON.stringify(after.triggerText));
console.log('sub:', JSON.stringify(before.sub), JSON.stringify(before.subText));
console.log('children:', JSON.stringify(before.children));
console.log('candidates:', before.candidates?.length, JSON.stringify(before.candidates?.map(x=>({cls:x.cls,title:x.title,text:x.text,w:x.w,h:x.h}))));
console.log('after candidates:', JSON.stringify(after.candidates?.map(x=>({cls:x.cls,title:x.title,text:x.text}))));
console.log('html equal:', before.html === after.html);
console.log('--- html ---\n', (before.html||'').slice(0, 6000));
c.ws.close();
