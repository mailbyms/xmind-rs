// Background watcher: polls every CDP target for the insert dropdown rows
// (keyword 标签) and for new popup targets. Once found, dumps the full dropdown
// DOM/text and screenshots the matching target. Run this, then open the 插入
// dropdown in the shipped XMind with a real mouse and leave it open.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Strong insert-only words that never appear as canvas topic titles.
const KEYWORDS = ['贴纸', '插画', '方程', '附件', '语音备注', '网页链接', '本地图片', '本地文件'];
const SCAN = `(() => {
  const vis = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; };
  const kw = ${JSON.stringify(KEYWORDS)};
  const panels = [...document.querySelectorAll('*')].filter(vis).filter(e => {
    if (e.tagName === 'HTML' || e.tagName === 'BODY') return false;
    const r = e.getBoundingClientRect();
    if (r.width > 600 || r.height > 780) return false; // a dropdown is a small floating layer
    const t=(e.innerText||'').trim();
    return t.length>10 && t.length<2500 && kw.filter(k=>t.includes(k)).length>=2;
  }).map(e => ({ tag:e.tagName, cls:(e.className||'').toString().slice(0,140),
    rect:[Math.round(e.getBoundingClientRect().x),Math.round(e.getBoundingClientRect().y),Math.round(e.getBoundingClientRect().width),Math.round(e.getBoundingClientRect().height)],
    text:(e.innerText||'').trim().slice(0,1500) }));
  const labelLeaves = [...document.querySelectorAll('*')].filter(vis).filter(e=>e.children.length===0 && (e.textContent||'').trim()==='标签').length;
  return { panels, labelLeaves };
})()`;

async function attach(p) {
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let id = 0; const pm = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pm.has(m.id)) { pm.get(m.id)(m.result); pm.delete(m.id); } });
  await Promise.race([new Promise((r) => ws.addEventListener('open', r)), sleep(2500)]);
  return {
    ws,
    send: (method, params = {}) => new Promise((ok) => { const mid = ++id; pm.set(mid, ok); ws.send(JSON.stringify({ id: mid, method, params })); }),
    ev: async (expression) => { const r = await new Promise((ok) => { const mid = ++id; pm.set(mid, ok); ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); }); return r.result?.value; },
  };
}

const listTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');

console.log('WATCHER STARTED — open the 插入 dropdown in XMind now. Timeout 180s.');
const deadline = Date.now() + 180000;
let lastCount = -1;
while (Date.now() < deadline) {
  const targets = await listTargets();
  if (targets.length !== lastCount) { console.log('targets', targets.length); lastCount = targets.length; }
  for (const p of targets) {
    try {
      const c = await attach(p);
      const scan = await Promise.race([c.ev(SCAN), sleep(1200).then(() => null)]);
      if (scan && (scan.labelLeaves > 0 || scan.panels.length)) {
        console.log('HIT on', p.url.split('?')[0].split('/').pop(), 'labelLeaves', scan.labelLeaves, 'panels', scan.panels.length);
        writeFileSync(resolve(OUT, 'popup-found.json'), JSON.stringify({ url: p.url, scan }, null, 1));
        const shot = await c.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(resolve(OUT, 'popup-found.png'), Buffer.from(shot.data, 'base64'));
        console.log('SAVED popup-found.json / popup-found.png');
        c.ws.close();
        process.exit(0);
      }
      c.ws.close();
    } catch {}
  }
  await sleep(400);
}
console.log('TIMEOUT — dropdown not found. Please keep it open and retry.');
