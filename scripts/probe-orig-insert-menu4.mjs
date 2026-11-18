// Try multiple ways to open the 插入 dropdown and detect popups across ALL
// CDP pages (XMind may render the dropdown in a separate BrowserWindow).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  };
  return { ws, send, ev };
}

const allPages = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
  .filter((t) => t.type === 'page');

const list = await allPages();
const page = list.find((t) => /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)))
  || list.find((t) => /editor\.html\?/.test(t.url));
const { send, ev } = await connect(page);
await send('Page.bringToFront');
await sleep(300);

// Find the arrow's exact rect.
const geo = await ev(`(() => {
  const root = document.querySelector('[data-id="insert"]');
  const arrow = root?.querySelector('.uk-icon[uk-icon*="chevron-down"]');
  const btn = root?.querySelector('button');
  const g = (e)=>{const r=e.getBoundingClientRect();return{x:+(r.x+r.width/2).toFixed(1),y:+(r.y+r.height/2).toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}};
  return { root: g(root), btn: g(btn), arrow: arrow?g(arrow):null,
    rootHTML: root?.outerHTML.slice(0,400) };
})()`);
console.log('GEO', JSON.stringify(geo, null, 1));

const clickNative = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

// Select topic first.
if (geo.root) {
  const t = await ev(`(() => {const g=[...document.querySelectorAll('[data-view-id^="topic-node:"]')].sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];const r=g.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await clickNative(t.x, t.y);
  await sleep(250);
}

const scanAll = async () => {
  const pages = await allPages();
  const out = [];
  for (const p of pages) {
    try {
      const c = await connect(p);
      const txt = await c.ev(`(() => {
        const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
        const keys=['笔记','标签','贴纸','插画','方程','附件','语音备注','图片','概要','外框','联系','标记','截图','表格','网页'];
        return [...document.querySelectorAll('[class],li,[role=menuitem]')].filter(vis).filter((e)=>{
          const t=(e.innerText||'').trim(); return keys.filter(k=>t.includes(k)).length>=3 && t.length<800;
        }).map(e=>({cls:(typeof e.className==='string'?e.className:'').slice(0,120),text:(e.innerText||'').trim().slice(0,600)}));
      })()`);
      if (txt && txt.length) out.push({ url: p.url.slice(0,90), panels: txt.slice(0,6) });
      c.ws.close();
    } catch {}
  }
  return out;
};

// Attempt 1: click arrow via native coords.
console.log('--- attempt: arrow native ---');
await clickNative(geo.arrow.x, geo.arrow.y);
await sleep(700);
let found = await scanAll();
console.log('FOUND1', JSON.stringify(found, null, 1).slice(0, 2000));

// Attempt 2: click whole button.
if (!found.length) {
  console.log('--- attempt: button native ---');
  await clickNative(geo.btn.x, geo.btn.y);
  await sleep(700);
  found = await scanAll();
  console.log('FOUND2', JSON.stringify(found, null, 1).slice(0, 2000));
}

// Attempt 3: hover then click arrow.
if (!found.length) {
  console.log('--- attempt: hover + click ---');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geo.btn.x, y: geo.btn.y, button: 'none' });
  await sleep(600);
  await clickNative(geo.arrow.x, geo.arrow.y);
  await sleep(700);
  found = await scanAll();
  console.log('FOUND3', JSON.stringify(found, null, 1).slice(0, 2000));
}

writeFileSync(resolve(OUT, 'menu4.json'), JSON.stringify({ geo, found }, null, 1));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'insert-dropdown4.png'), Buffer.from(shot.data, 'base64'));
console.log('written', OUT, 'found', found.length);
