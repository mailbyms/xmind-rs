// Capture the shipped XMind 插入 dropdown: bring window to front, select a
// topic, click the chevron (dropdown opens on the arrow), scan DOM for the
// keyword 标签 and screenshot. Uses the page's real viewport coordinates.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)));
if (!page) throw new Error('no example editor page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => {
  const mid = ++id; pending.set(mid, ok); ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

await send('Page.bringToFront');
await sleep(300);
console.log('BODY', await ev('document.body.className'));

// Select central topic using correct selector (colon needs quoting via split).
const topic = await ev(`(() => {
  const g = [...document.querySelectorAll('[data-view-id]')]
    .filter(e => e.getAttribute('data-view-id').indexOf('topic-node:') === 0)
    .sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
})()`);
console.log('TOPIC', JSON.stringify(topic));
if (topic) await click(topic.x, topic.y);
await sleep(300);

// Locate the 插入 toolbar item, its button, and the chevron arrow.
const geo = await ev(`(() => {
  const root = document.querySelector('[data-id="insert"]');
  if (!root) return null;
  const g = (el) => { if(!el) return null; const r=el.getBoundingClientRect();
    return { x:+(r.x+r.width/2).toFixed(1), y:+(r.y+r.height/2).toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1) }; };
  return { root: g(root), btn: g(root.querySelector('button')),
    arrow: g(root.querySelector('.uk-icon[uk-icon*="chevron-down"]')),
    title: root.querySelector('button')?.title };
})()`);
console.log('GEO', JSON.stringify(geo));

// Click the arrow (dropdown trigger), with the real current coordinates.
if (geo?.arrow) { await click(geo.arrow.x, geo.arrow.y); await sleep(700); }

// Scan for 标签 keyword anywhere visible.
const scan = await ev(`(() => {
  const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
  const hits=[...document.querySelectorAll('*')].filter(vis).filter(e=>e.children.length===0&&e.textContent?.trim()==='标签')
    .map(e=>{const r=e.getBoundingClientRect();return{tag:e.tagName,cls:(e.className||'').toString().slice(0,100),rect:[Math.round(r.x),Math.round(r.y)]}});
  // Find a container whose text lists multiple insert rows.
  const keys=['笔记','标签','贴纸','插画','方程','附件','语音备注','图片','概要','外框','联系','标记','表格','网页','截图'];
  const panels=[...document.querySelectorAll('[class]')].filter(vis).filter(e=>{
    const t=(e.innerText||'').trim();return keys.filter(k=>t.includes(k)).length>=3&&t.length<600;
  }).map(e=>({cls:(e.className||'').toString().slice(0,120),text:(e.innerText||'').trim()}));
  return { labelHits: hits, panels };
})()`);
console.log('SCAN', JSON.stringify(scan, null, 1).slice(0, 3000));

writeFileSync(resolve(OUT, 'final-scan.json'), JSON.stringify({ topic, geo, scan }, null, 1));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'insert-final.png'), Buffer.from(shot.data, 'base64'));
console.log('written', OUT);
ws.close();
