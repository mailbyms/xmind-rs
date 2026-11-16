// Probe the shipped editor for (a) how a 配色方案 is serialised into sheet.theme
// and (b) what the 3x2 quick-pick strip actually renders inside each card.
import fs from 'node:fs';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pages = list.filter((t) => /editor\.html/.test(t.url));

async function attach(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
  };
  return { ws, ev };
}

for (const t of pages) {
  const { ws, ev } = await attach(t);
  const info = await ev(`(() => ({
    title: document.title,
    fo: document.querySelectorAll('foreignObject').length,
    hasPanel: !!document.querySelector('.uk-format-panel'),
    globals: Object.keys(window).filter(k => /workbook|sheet|editor|topic|model/i.test(k)).slice(0, 30),
  }))()`);
  console.log(t.url.slice(-38), JSON.stringify(info));
  ws.close();
}
