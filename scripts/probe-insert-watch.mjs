// Click 插入 and watch across all pages for up to 3s for the 标签 row to appear,
// also watching for new popup pages. Uses slow press-release and both the
// button and the chevron.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');

async function attach(p) {
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let id = 0; const pm = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pm.has(m.id)) { pm.get(m.id)(m.result); pm.delete(m.id); } });
  await new Promise((r) => ws.addEventListener('open', r));
  const ev = (expression) => new Promise((ok) => { const mid = ++id; pm.set(mid, (r) => ok(r.result?.value)); ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  return { ws, ev };
}

// Scan a single page for 标签 leaf + dropdown text, with a hard timeout wrapper.
const SCAN = `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.textContent||'').trim()==='标签').length + '|' + [...document.querySelectorAll('[class*=dropdown],[class*=menu],[uk-dropdown]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).map(e=>(e.innerText||'').trim().slice(0,120)).join(' ~ ').slice(0,300)`;
async function scanOne(p) {
  try {
    const c = await Promise.race([attach(p), sleep(2500).then(() => null)]);
    if (!c) return null;
    const v = await Promise.race([c.ev(SCAN), sleep(1500).then(() => 'TIMEOUT')]);
    c.ws.close();
    return v;
  } catch { return 'ERR'; }
}

const list = await pages();
const target = list.find((t) => /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)));
const c = await attach(target);
const send = (method, params = {}) => new Promise((ok) => { const mid = ++id; c['pm'] = c['pm'] || {}; /* noop */ ok; });
// We need raw send on same ws; extend c.
let seq = 1000; const pm2 = new Map();
c.ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pm2.has(m.id)) { pm2.get(m.id)(m.result); pm2.delete(m.id); } });
const raw = (method, params = {}) => new Promise((ok) => { const mid = ++seq; pm2.set(mid, ok); c.ws.send(JSON.stringify({ id: mid, method, params })); });

await raw('Page.bringToFront'); await sleep(200);
// Select topic.
const t = await c.ev(`(() => {const g=[...document.querySelectorAll('[data-view-id]')].filter(e=>e.getAttribute('data-view-id').indexOf('topic-node:')===0).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];const r=g.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await raw('Input.dispatchMouseEvent', { type: ty, x: t.x, y: t.y, button: ty === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
await sleep(200);

// Get button + arrow coords fresh.
const geo = await c.ev(`(() => {const root=document.querySelector('[data-id=insert]');const g=el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}};return{btn:g(root.querySelector('button')),arrow:g(root.querySelector('.uk-icon[uk-icon*=chevron-down]'))}})()`);
console.log('GEO', JSON.stringify(geo));

// Slow click on button.
await raw('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geo.btn.x, y: geo.btn.y, button: 'none' });
await sleep(200);
await raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.btn.x, y: geo.btn.y, button: 'left', clickCount: 1 });
await sleep(300);
await raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.btn.x, y: geo.btn.y, button: 'left', clickCount: 1 });

// Watch all pages for 标签.
for (let k = 0; k < 15; k++) {
  await sleep(200);
  const ps = await pages();
  const scans = await Promise.all(ps.map(scanOne));
  const hits = scans.filter((s) => s && s !== '0|' && !String(s).startsWith('0|'));
  if (k % 3 === 0 || hits.length) console.log('watch', k, 'pages', ps.length, 'hits', JSON.stringify(hits));
  if (hits.length) { writeFileSync(resolve(OUT, 'watch-hit.json'), JSON.stringify({ k, scans }, null, 1)); break; }
}
const shot = await raw('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'insert-watch.png'), Buffer.from(shot.data, 'base64'));
console.log('done');
c.ws.close();
