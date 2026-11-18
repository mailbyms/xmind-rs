// Click the shipped XMind 插入 button using the exact same technique that
// worked for the marker panel: first editor.html page, native coordinates,
// Input.dispatchMouseEvent, no device-metrics override.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
if (!page) throw new Error('no editor page');
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
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok, rej) => {
  const mid = ++id;
  pending.set(mid, { resolve: ok, reject: rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
};

// Bring this editor window to front so XMind treats it as active.
await send('Page.bringToFront');
await sleep(400);
console.log('BODY CLASS', await ev(`document.body.className.slice(0,160)`));

// Select central topic.
const topic = await ev(`(() => {
  const g = [...document.querySelectorAll('[data-view-id^="topic-node:"]')]
    .sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];
  const r = g.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
})()`);
console.log('TOPIC', JSON.stringify(topic));
await click(topic.x, topic.y);
await sleep(300);

// Click the 插入 toolbar button (the whole tile; XMind opens dropdown on the
// button, same as marker panel did).
const btn = await ev(`(() => {
  const b = document.querySelector('[data-id="insert"] button') || document.querySelector('[data-id="insert"]');
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
})()`);
console.log('BUTTON', JSON.stringify(btn));
await click(btn.x, btn.y);
await sleep(700);

// Dump all visible elements that look like a dropdown with insert rows.
const dump = await ev(`(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; };
  const keys = ['笔记','标签','贴纸','插画','方程','附件','语音备注','图片','概要','外框','联系','标记','截图','表格'];
  const panels = [...document.querySelectorAll('[class]')].filter(vis).filter((e) => {
    const t = (e.innerText||'').trim();
    return keys.filter((k)=>t.includes(k)).length>=3 && t.length<1200;
  }).map((e) => {
    const r = e.getBoundingClientRect();
    return { cls: (typeof e.className==='string'?e.className:'').slice(0,160),
      tag:e.tagName,
      text: (e.innerText||'').trim().slice(0,900),
      rect: [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] };
  });
  return panels;
})()`);
console.log('=== PANELS ===', JSON.stringify(dump, null, 1));

// Also dump any element with dropdown/menu-ish class that appeared.
const menus = await ev(`(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; };
  return [...document.querySelectorAll('[class*="dropdown"],[class*="menu"],[class*="popover"],[class*="panel"],[uk-dropdown]')]
    .filter(vis).map((e)=>{const r=e.getBoundingClientRect();return {cls:(typeof e.className==='string'?e.className:'').slice(0,140),text:(e.innerText||'').trim().slice(0,400),rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]}});
})()`);
console.log('=== MENUS ===', JSON.stringify(menus, null, 1));
writeFileSync(resolve(OUT, 'menu3.json'), JSON.stringify({ topic, btn, panels: dump, menus }, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'insert-dropdown3.png'), Buffer.from(shot.data, 'base64'));
console.log('written', OUT);
ws.close();
