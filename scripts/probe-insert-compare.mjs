// Compare: click 标记 (known-working) vs 插入, using the exact technique from
// the successful marker-layout probe. Verifies whether CDP clicks register at all.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pm = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pm.has(m.id)) { pm.get(m.id)(m.result); pm.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => { const mid = ++id; pm.set(mid, ok); ws.send(JSON.stringify({ id: mid, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); return r.result?.value; };
const click = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
};
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(OUT, name), Buffer.from(s.data, 'base64')); };

// Select central topic.
const t = await ev(`(() => {const g=[...document.querySelectorAll('[data-view-id]')].filter(e=>e.getAttribute('data-view-id').indexOf('topic-node:')===0).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];const r=g.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
await click(t.x, t.y); await sleep(300);

// Click 标记 button using title regex (same as working probe).
const marker = await ev(`(() => {const b=[...document.querySelectorAll('button')].find(x=>/标记/.test(x.title||''));return b?(()=>{const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,title:b.title}})():null})()`);
console.log('MARKER BTN', JSON.stringify(marker));
await click(marker.x, marker.y); await sleep(600);
const markerPanel = await ev(`(() => {const e=document.querySelector('.marker-module .icon-image-item');return !!e})()`);
console.log('MARKER PANEL OPEN?', markerPanel);
await shot('compare-marker.png');
// Close marker panel by clicking button again.
await click(marker.x, marker.y); await sleep(300);

// Click 插入 button by title.
const insert = await ev(`(() => {const b=[...document.querySelectorAll('button')].find(x=>/其他元素|插入/.test(x.title||''));return b?(()=>{const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,title:b.title}})():null})()`);
console.log('INSERT BTN', JSON.stringify(insert));
await click(insert.x, insert.y); await sleep(700);
const scan = await ev(`(() => {const hits=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent?.trim()==='标签').map(e=>e.className?.toString?.().slice(0,80));return{hits:hits.slice(0,10),dropdowns:[...document.querySelectorAll('[uk-dropdown],[class*=dropdown]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({cls:e.className?.toString?.().slice(0,100),text:(e.innerText||'').trim().slice(0,300)}))}})()`);
console.log('INSERT SCAN', JSON.stringify(scan, null, 1));
await shot('compare-insert.png');
ws.close();
