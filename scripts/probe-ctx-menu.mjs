// Capture the original XMind's real native context menus via CDP.
// Usage: node scripts/probe-ctx-menu.mjs
import { writeFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url) && /source=new/.test(t.url))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url));
if (!page) throw new Error('no editor page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
};
const click = async (x, y, button = 'left') => {
  const buttons = button === 'right' ? 2 : 1;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
};
await new Promise((r) => ws.addEventListener('open', r));

// Hook Menu.buildFromTemplate from the webpack module cache.
console.log('hook:', await evaluate(`(() => {
  let req;
  webpackChunkxmind_vana.push([[999992], {}, (r) => { req = r; }]);
  const M = req(67657).Menu;
  window.__menuCapture = [];
  const orig = M.buildFromTemplate;
  M.buildFromTemplate = function (tpl) {
    try { window.__menuCapture.push(JSON.parse(JSON.stringify(tpl, (k, v) => typeof v === 'function' ? '[fn]' : v))); } catch (e) { window.__menuCapture.push({ error: String(e) }); }
    return orig.call(this, tpl);
  };
  window.__menuOrig = orig;
  return { hooked: true, moduleKeys: Object.keys(req(67657)).length };
})()`));

const clean = (tpl) => {
  if (!Array.isArray(tpl)) return tpl;
  return tpl.map((i) => {
    const o = { label: i.label, type: i.type, role: i.role, accelerator: i.accelerator, enabled: i.enabled, visible: i.visible, checked: i.checked, commandId: i.commandId, id: i.id };
    if (i.submenu) o.submenu = clean(i.submenu);
    return o;
  });
};

// 1) blank canvas right click
await evaluate('window.__menuCapture = []');
await click(160, 200, 'right');
await wait(500);
const blank = await evaluate('window.__menuCapture.map((t) => t)');
await key('Escape', 'Escape', 27);
await wait(200);

// 2) topic right click (select first, then right click the same spot)
await evaluate('window.__menuCapture = []');
await click(571, 424, 'left');
await wait(250);
await click(571, 424, 'right');
await wait(500);
const topic = await evaluate('window.__menuCapture.map((t) => t)');
await key('Escape', 'Escape', 27);
await wait(200);

// 3) right click on a main branch topic
await evaluate('window.__menuCapture = []');
await click(770, 359, 'left');
await wait(200);
await click(770, 359, 'right');
await wait(500);
const branch = await evaluate('window.__menuCapture.map((t) => t)');
await key('Escape', 'Escape', 27);

const result = { page: page.url.slice(-110), blank, topic, branch };
writeFileSync('target/ctx-menus.json', JSON.stringify(result, null, 1));
const fmt = (tpls) => tpls.map((tpl, k) => `--- template ${k} ---\n` + (Array.isArray(tpl) ? tpl.map((i) => `${i.type === 'separator' ? '---' : `${i.label || ''} [${i.accelerator || '-'}]${i.enabled === false ? ' 禁用' : ''}${i.checked ? ' ✓' : ''}${i.submenu ? ' >' + i.submenu.length : ''}`}`).join('\n') : JSON.stringify(tpl))).join('\n');
console.log('=== BLANK ===\n' + fmt(result.blank));
console.log('=== TOPIC ===\n' + fmt(result.topic));
console.log('=== BRANCH ===\n' + fmt(result.branch));
ws.close();
process.exit();
