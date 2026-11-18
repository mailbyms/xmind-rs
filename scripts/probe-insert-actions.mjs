// Drive each 插入 menu item in the shipped XMind and capture the visual result.
// The dropdown is a Win32 native menu (no CDP target), so we open it with a
// CDP click and navigate with real OS-level keyboard input, then grab the
// whole screen with ffmpeg and dump any DOM change on the selected topic.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-actions');
mkdirSync(OUT, { recursive: true });
const ROOT = resolve('.');
const py = (...a) => execFileSync('python', [resolve(ROOT, 'scripts/os-input.py'), ...a], { encoding: 'utf8' }).trim();
const ffmpeg = (file) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '1', '-i', 'desktop', '-frames:v', '1', '-update', '1', file], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)));
if (!page) throw new Error('no example editor page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pm = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pm.has(m.id)) { pm.get(m.id)(m.result); pm.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => { const mid = ++id; pm.set(mid, ok); ws.send(JSON.stringify({ id: mid, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); return r.result?.value; };

const openMenu = async () => {
  py('focus', 'example');
  const geo = await ev(`(() => {const root=document.querySelector('[data-id=insert]');const r=root.querySelector('button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geo.x, y: geo.y, button: 'none' });
  await sleep(100);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.x, y: geo.y, button: 'left', clickCount: 1 });
  await sleep(100);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.x, y: geo.y, button: 'left', clickCount: 1 });
  await sleep(400);
};

// Menu item order (with separators ignored by keyboard navigation):
// 1 笔记 2 标签 3 链接 4 附件 5 语音备注 6 贴纸 7 插画 8 本地图片 9 方程
const ITEMS = ['note', 'label', 'link', 'attachment', 'audio', 'sticker', 'illustration', 'image', 'equation'];
const args = process.argv.slice(3);
const wanted = args.length ? args.map(Number) : [1, 2, 6, 7, 8];
const results = [];

for (const n of wanted) {
  console.log('--- item', n, ITEMS[n - 1], '---');
  // Make sure no native menu / dialog is left over, then select central topic.
  py('focus', 'example');
  py('key', 'ESC');
  await sleep(200);
  py('key', 'ESC');
  await sleep(200);
  const t = await ev(`(() => {const g=[...document.querySelectorAll('[data-view-id]')].filter(e=>e.getAttribute('data-view-id').indexOf('topic-node:')===0).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];const r=g.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const ty of ['mouseMoved','mousePressed','mouseReleased'])
    await send('Input.dispatchMouseEvent', { type: ty, x: t.x, y: t.y, button: ty==='mouseMoved'?'none':'left', clickCount: 1 });
  await sleep(250);
  await openMenu();
  // Navigate with real keyboard: DOWN n times then ENTER.
  py('key', 'DOWN', n);
  await sleep(200);
  py('key', 'ENTER');
  await sleep(900);
  const file = resolve(OUT, `${String(n).padStart(2,'0')}-${ITEMS[n-1]}.png`);
  ffmpeg(file);
  const ui = await ev(`(() => {
    const vis = e => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0; };
    const panels=[...document.querySelectorAll('[class]')].filter(vis).filter(e=>{
      const t=(e.innerText||'').trim(); return t.length>2 && t.length<400 && /笔记|标签|贴纸|插画|图片|方程|输入|添加|选择/.test(t);
    }).slice(0,8).map(e=>({cls:(e.className||'').toString().slice(0,90),text:(e.innerText||'').trim().slice(0,200)}));
    return { dialogs: document.querySelectorAll('[role=dialog],.uk-modal,[class*=dialog]').length, panels };
  })()`);
  console.log('UI', JSON.stringify(ui).slice(0, 600));
  results.push({ n, name: ITEMS[n-1], file, ui });
  writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(results, null, 1));
  // Dismiss whatever opened (Escape / close dialogs), ready for next item.
  py('key', 'ESC');
  await sleep(300);
  py('key', 'ESC');
  await sleep(300);
}
console.log('DONE', results.map((r) => r.name).join(','));
ws.close();
