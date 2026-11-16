// Capture the hamburger main-menu template from the running original app.
import { writeFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url) && /source=new/.test(t.url));
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
await new Promise((r) => ws.addEventListener('open', r));
console.log('hook', await evaluate(`(() => {
  let req; webpackChunkxmind_vana.push([[999994]], {}, (r) => { req = r; });
  const M = req(67657).Menu;
  window.__mainMenuCapture = [];
  const o = M.buildFromTemplate;
  M.buildFromTemplate = function (tpl) { try { window.__mainMenuCapture.push(tpl); } catch (e) {} return o.call(this, tpl); };
  return true;
})()`));
// Try a real mouse press on the hamburger button (native handlers may bind mousedown).
const btn = await evaluate(`(() => { const b = document.querySelector('button.main-menu-btn'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
}
await new Promise((r) => setTimeout(r, 600));
const captured = await evaluate('window.__mainMenuCapture.length');
console.log('captured templates:', captured);
if (captured > 0) {
  const tpl = await evaluate(`(() => {
    const clean = (a) => a.map((i) => {
      const o = { label: i.label, type: i.type, role: i.role, accelerator: i.accelerator,
        enabled: i.enabled, visible: i.visible, checked: i.checked, commandId: i.commandId, id: i.id };
      if (i.submenu) o.submenu = clean(i.submenu.items || i.submenu);
      return o;
    });
    return window.__mainMenuCapture.map(clean);
  })()`);
  writeFileSync('target/main-menu-template.json', JSON.stringify(tpl, null, 1));
  const walk = (a, p = '') => a.forEach((i) => { console.log(p + (i.type === 'separator' ? '---' : `${i.label || ''} [${i.accelerator || '-'}]${i.enabled === false ? ' 禁用' : ''}${i.checked ? ' ✓' : ''}`)); if (i.submenu) walk(i.submenu, p + '  '); });
  tpl.forEach((t, n) => { console.log(`--- template ${n} ---`); walk(t); });
}
ws.close();
process.exit();
