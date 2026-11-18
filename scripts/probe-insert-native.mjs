// The 插入 dropdown is an Electron native/always-on-top popup: it has no CDP
// target and closes when the window loses focus. So: bring XMind to front,
// click via CDP Input (real OS-level input), then take a FULL-SCREEN ffmpeg
// grab from within this same process while the window is still active.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)));
if (!page) throw new Error('no example editor page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pm = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pm.has(m.id)) { pm.get(m.id)(m.result); pm.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => { const mid = ++id; pm.set(mid, ok); ws.send(JSON.stringify({ id: mid, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); return r.result?.value; };
const shot = (name) => {
  const p = resolve(OUT, name);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '1', '-i', 'desktop', '-frames:v', '1', '-update', '1', p], { stdio: 'ignore' });
  return p;
};

// Activate the XMind window (native menus need an active owner window).
await send('Page.bringToFront');
await sleep(400);

// Select central topic.
const t = await ev(`(() => {const g=[...document.querySelectorAll('[data-view-id]')].filter(e=>e.getAttribute('data-view-id').indexOf('topic-node:')===0).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];const r=g.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
for (const ty of ['mouseMoved','mousePressed','mouseReleased'])
  await send('Input.dispatchMouseEvent', { type: ty, x: t.x, y: t.y, button: ty==='mouseMoved'?'none':'left', clickCount: 1 });
await sleep(300);

const geo = await ev(`(() => {const root=document.querySelector('[data-id=insert]');const g=el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}};return{btn:g(root.querySelector('button')),arrow:g(root.querySelector('.uk-icon[uk-icon*=chevron-down]'))}})()`);
console.log('GEO', JSON.stringify(geo));

// Try the chevron first, then the button; screenshot after each.
for (const [label, pt] of [['arrow', geo.arrow], ['button', geo.btn]]) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(500);
  const file = shot(`native-${label}.png`);
  // Check targets + DOM for a native popup too.
  const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((x) => x.type === 'page');
  const labelHits = await ev(`[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.textContent||'').trim()==='标签').length`);
  console.log(label, 'saved', file, 'targets', targets.length, 'labelHits', labelHits);
}
ws.close();
