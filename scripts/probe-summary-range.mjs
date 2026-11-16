// Probe selection outlines, Ctrl+click, and 概要 built from a multi-selection.
import { writeFileSync } from 'node:fs';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url) && /source=new/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = async (type, x, y, buttons = 0, modifiers = 0) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, modifiers });
await new Promise((r) => ws.addEventListener('open', r));

const pos = await evaluate(`(() => {
  const fos = [...document.querySelectorAll('foreignObject')];
  return Object.fromEntries(['中心主题','分支主题 1','分支主题 2','分支主题 3','分支主题 4'].map((t) => {
    const e = fos.find((f) => (f.textContent || '').trim() === t);
    const r = e?.getBoundingClientRect();
    return [t, r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] } : null];
  }));
})()`);
console.log('positions', JSON.stringify(pos));

const outlineInfo = async () => evaluate(`(() => {
  const paths = [...document.querySelectorAll('.sheet-viewer [data-view-id^="topic-outline"]')].map((p) => ({
    id: p.getAttribute('data-view-id'), d: p.getAttribute('d'),
    stroke: p.getAttribute('stroke'), sw: p.getAttribute('stroke-width'),
    r: (() => { const b = p.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })(),
  }));
  const box = document.querySelector('.sheet-viewer [data-view-id="multi-selection-box"]');
  return { paths, box: box ? { d: box.getAttribute('d'), fill: box.getAttribute('fill'), stroke: box.getAttribute('stroke') } : null,
    status: [...document.querySelectorAll('.workbench-status-bar *')].map((e) => (e.innerText || '').trim()).filter((t) => /^主题: /.test(t))[0] || '' };
})()`);

// 1) rubber-band select branches 1 and 2
const a = pos['分支主题 1'].box, b = pos['分支主题 2'].box;
const x0 = Math.min(a[0], b[0]) - 45, y0 = Math.min(a[1], b[1]) - 45;
const x1 = Math.max(a[0] + a[2], b[0] + b[2]) + 45, y1 = Math.max(a[1] + a[3], b[1] + b[3]) + 45;
await mouse('mouseMoved', x0, y0, 0);
await mouse('mousePressed', x0, y0, 1);
for (const [x, y] of [[x0 + 35, y0 + 35], [(x0 + x1) / 2, (y0 + y1) / 2], [x1 - 20, y1 - 20], [x1, y1]]) {
  await mouse('mouseMoved', x, y, 1); await wait(90);
}
const during = await outlineInfo();
await mouse('mouseReleased', x1, y1, 0);
await wait(300);
const selected2 = await outlineInfo();

// 2) click 概要 with two consecutive siblings selected
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /为选中的主题添加概要/.test(e.getAttribute('title') || '')); if (!b) return 'missing'; b.click(); return 'clicked'; })()`);
await wait(500);
const afterSummary = await outlineInfo();
const summaryDom = await evaluate(`(() => {
  const fos = [...document.querySelectorAll('foreignObject')].map((e) => ({ t: (e.textContent || '').trim().slice(0, 30), r: (() => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })() }));
  const ids = [...document.querySelectorAll('.sheet-viewer [data-view-id]')].map((e) => e.getAttribute('data-view-id')).filter((v) => /summary|boundary|outline|select/i.test(v));
  return { fos, ids: ids.slice(0, 40), status: [...document.querySelectorAll('.workbench-status-bar *')].map((e) => (e.innerText || '').trim()).filter((t) => /^主题: /.test(t))[0] || '' };
})()`);

// 3) Ctrl+click a left-side branch to add to selection
await mouse('mousePressed', pos['分支主题 3'].x, pos['分支主题 3'].y, 1, 2);
await mouse('mouseReleased', pos['分支主题 3'].x, pos['分支主题 3'].y, 0, 2);
await wait(250);
const afterCtrl = await outlineInfo();

const out = { during, selected2, afterSummary, summaryDom, afterCtrl };
writeFileSync('target/summary-selection-probe.json', JSON.stringify(out, null, 1));
console.log('DURING', JSON.stringify(during, null, 1));
console.log('SELECTED2', JSON.stringify(selected2, null, 1));
console.log('AFTER SUMMARY', JSON.stringify(summaryDom, null, 1));
console.log('AFTER CTRL', JSON.stringify(afterCtrl, null, 1));
ws.close();
process.exit();
